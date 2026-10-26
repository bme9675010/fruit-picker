// 用參考照片改善辨識。比較三種做法，挑驗證集最好的：
//   text  ：只用文字特徵（原本的做法）
//   tip   ：文字 + 參考樣本比對（Tip-Adapter，不需訓練）
//   probe ：從文字特徵出發、用照片微調的線性分類器（App 端程式不用改）
// 照片依檔名雜湊固定分成 訓練 50%／驗證 20%／測試 30%，測試集只用來報告最後結果。
// 用法：node train.mjs           只比較、印出結果
//       node train.mjs --write   另外把最佳做法寫入 ../embeddings.json
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const WRITE = process.argv.includes('--write');
const SCALE = 100;
// 標題含這些字的多半不是蔬果本身（畫作、植株、菜餚…），當成「非蔬果」的負樣本
const BAD_TITLE = /\b(paintings?|drawings?|illustrations?|engraving|lithograph|flowers?|blossoms?|trees?|seedlings?|leaf|leaves|plants?|field|farm|harvest(ing)?|garden|dish(es)?|soup|salad|cake|pie|recipe|cooked|fried|stew|curry|juice|dried|jam|pickled?|stamp|map|logo|poster|book|insects?|butterfly|moth|caterpillar|beetle|bird|herbarium|specimen|pollen|karyotype|diagram|chart|statue|monument|sculpture)\b/i;

const load = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const text = await load('./text-embeddings.json');
const index = await load('./photos/index.json');
const feats = await load('./photos/features.json');

const ids = text.classes.map((c) => c.id);
const C = ids.length, D = text.classes[0].embedding.length;
const isBg = ids.map((id) => id.startsWith('bg_'));
const T = text.classes.map((c) => Float32Array.from(c.embedding));
const dot = (a, b) => { let s = 0; for (let i = 0; i < D; i++) s += a[i] * b[i]; return s; };
const softmax = (z) => { const m = Math.max(...z); const e = z.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b); return e.map((x) => x / s); };
const argmax = (a) => a.reduce((bi, x, i) => (x > a[bi] ? i : bi), 0);
const splitOf = (title) => {
  const h = parseInt(createHash('sha1').update(title).digest('hex').slice(0, 8), 16) % 10;
  return h < 3 ? 'test' : h < 5 ? 'val' : 'train';
};

// ---------- 整理資料 ----------
const pos = [], neg = [];
let dropped = 0;
for (const [id, entries] of Object.entries(index)) {
  const y = ids.indexOf(id);
  if (y < 0) continue; // 已從清單移除的品項
  for (const e of entries) {
    const f = feats[e.file];
    if (!f) continue;
    const v = Float32Array.from(f);
    const z = T.map((t) => SCALE * dot(t, v));
    const top = argmax(z);
    const sample = { y, v, title: e.title, split: splitOf(e.title) };
    if (BAD_TITLE.test(e.title.replace(/[_\-.()]/g, ' ')) || isBg[top]) { neg.push(sample); continue; }
    const rank = z.filter((x) => x > z[y]).length;
    if (rank >= 10) { dropped++; continue; } // 多半是搜尋到不相干的圖
    pos.push(sample);
  }
}
const part = (arr, s) => arr.filter((x) => x.split === s);
// 驗證／測試集排除跟訓練照片幾乎一樣的圖（同一系列連拍），避免高估
const trainPos = part(pos, 'train');
const notDup = (x) => !trainPos.some((t) => dot(t.v, x.v) >= 0.95);
const data = {
  train: trainPos, val: part(pos, 'val').filter(notDup), test: part(pos, 'test').filter(notDup),
  negTrain: part(neg, 'train'), negVal: part(neg, 'val'), negTest: part(neg, 'test'),
};
console.log(`照片：正樣本 train ${data.train.length} / val ${data.val.length} / test ${data.test.length}，`
  + `負樣本 ${neg.length}，丟棄（不相干）${dropped}`);

// ---------- 評分方式 ----------
const textLogits = (v) => T.map((t) => SCALE * dot(t, v));

function tipLogits(W, cache, alpha, beta) {
  return (v) => {
    const z = W.map((w) => SCALE * dot(w, v));
    if (!alpha) return z;
    const a = new Float64Array(C);
    for (const k of cache) a[k.y] = Math.max(a[k.y], Math.exp(-beta * (1 - dot(k.v, v))));
    return z.map((x, c) => x + alpha * a[c]);
  };
}

function evaluate(score, set, negSet) {
  let top1 = 0, top2 = 0, bgMiss = 0, negOk = 0;
  for (const s of set) {
    const z = score(s.v);
    const order = z.map((x, i) => [x, i]).filter(([, i]) => !isBg[i]).sort((a, b) => b[0] - a[0]);
    if (order[0][1] === s.y) top1++;
    if (order[0][1] === s.y || order[1][1] === s.y) top2++;
    if (isBg[argmax(z)]) bgMiss++;
  }
  for (const s of negSet) if (isBg[argmax(score(s.v))]) negOk++;
  return { top1: top1 / set.length, top2: top2 / set.length, bgMiss: bgMiss / set.length, negOk: negSet.length ? negOk / negSet.length : NaN };
}
const fmt = (r) => `top1 ${(r.top1 * 100).toFixed(1)}%  top2 ${(r.top2 * 100).toFixed(1)}%  誤判為非蔬果 ${(r.bgMiss * 100).toFixed(1)}%  非蔬果正確拒絕 ${(r.negOk * 100).toFixed(1)}%`;

// ---------- 線性分類器（從文字特徵出發，L2 拉回文字特徵避免過度擬合） ----------
function trainProbe(samples, negs, lambda, steps, snapshots = []) {
  const W = T.map((t) => Float32Array.from(t));
  const m = W.map(() => new Float32Array(D)), v2 = W.map(() => new Float32Array(D));
  const lr = 5e-4, b1 = 0.9, b2 = 0.999;
  const all = [...samples.map((s) => ({ ...s, neg: false })), ...negs.map((s) => ({ ...s, neg: true }))];
  const out = {};
  for (let step = 1; step <= steps; step++) {
    const G = W.map(() => new Float32Array(D));
    for (const s of all) {
      const p = softmax(W.map((w) => SCALE * dot(w, s.v)));
      let pBg = 0;
      if (s.neg) for (let c = 0; c < C; c++) if (isBg[c]) pBg += p[c];
      for (let c = 0; c < C; c++) {
        if (isBg[c]) continue; // 非蔬果類別沒有正樣本，固定不動
        const g = s.neg ? p[c] : p[c] - (c === s.y ? 1 : 0);
        if (Math.abs(g) < 1e-6) continue;
        const k = (SCALE * g) / all.length;
        for (let i = 0; i < D; i++) G[c][i] += k * s.v[i];
      }
    }
    for (let c = 0; c < C; c++) {
      if (isBg[c]) continue;
      for (let i = 0; i < D; i++) {
        const g = G[c][i] + 2 * lambda * (W[c][i] - T[c][i]);
        m[c][i] = b1 * m[c][i] + (1 - b1) * g;
        v2[c][i] = b2 * v2[c][i] + (1 - b2) * g * g;
        W[c][i] -= (lr * (m[c][i] / (1 - b1 ** step))) / (Math.sqrt(v2[c][i] / (1 - b2 ** step)) + 1e-8);
      }
    }
    if (snapshots.includes(step)) out[step] = W.map((w) => Float32Array.from(w));
  }
  return snapshots.length ? out : W;
}

// ---------- 用驗證集挑參數 ----------
const base = evaluate(textLogits, data.val, data.negVal);
console.log(`\n[驗證] 只用文字       ${fmt(base)}`);

let best = { name: 'text', r: base };
const consider = (name, r, cfg) => {
  console.log(`[驗證] ${name.padEnd(14)} ${fmt(r)}`);
  // 準確度要更好，且不能讓「非蔬果」的拒絕能力明顯變差
  if (r.top1 > best.r.top1 && r.negOk >= base.negOk - 0.05) best = { name, r, ...cfg };
};

for (const alpha of [2, 5, 10, 20]) {
  for (const beta of [3, 5.5, 8]) {
    consider(`tip α${alpha} β${beta}`, evaluate(tipLogits(T, data.train, alpha, beta), data.val, data.negVal), { kind: 'tip', alpha, beta });
  }
}
const SNAP = [50, 100, 200];
for (const lambda of [0.01, 0.1, 1]) {
  const snaps = trainProbe(data.train, data.negTrain, lambda, 200, SNAP);
  for (const step of SNAP) {
    const W = snaps[step];
    consider(`probe λ${lambda} s${step}`, evaluate(tipLogits(W, [], 0, 0), data.val, data.negVal), { kind: 'probe', lambda, step });
    for (const alpha of [5, 10]) {
      consider(`probe+tip λ${lambda} s${step} α${alpha}`, evaluate(tipLogits(W, data.train, alpha, 5.5), data.val, data.negVal),
        { kind: 'probe+tip', lambda, step, alpha, beta: 5.5 });
    }
  }
}
console.log(`\n最佳：${best.name}`);

// ---------- 用訓練＋驗證集重新訓練，在測試集報告 ----------
const fitSet = [...data.train, ...data.val];
const fitNeg = [...data.negTrain, ...data.negVal];
let W = T;
if (best.kind === 'probe' || best.kind === 'probe+tip') W = trainProbe(fitSet, fitNeg, best.lambda, best.step);
// 參考樣本以 int8 存放（每個向量一個縮放係數），體積約為 float32 的 1/4
const quantize = (v) => {
  const scale = Math.max(...v.map(Math.abs)) / 127;
  return { q: Int8Array.from(v, (x) => Math.round(x / scale)), scale };
};
const refs = (best.kind === 'tip' || best.kind === 'probe+tip' ? fitSet : []).map((s) => ({ y: s.y, ...quantize(s.v) }));
const cache = refs.map((r) => ({ y: r.y, v: Float32Array.from(r.q, (x) => x * r.scale) }));
const finalScore = tipLogits(W, cache, best.alpha ?? 0, best.beta ?? 0);
const testBase = evaluate(textLogits, data.test, data.negTest);
const testBest = evaluate(finalScore, data.test, data.negTest);
console.log(`\n[測試] 只用文字  ${fmt(testBase)}`);
console.log(`[測試] ${best.name}  ${fmt(testBest)}`);

// 各類別在測試集的變化
const perClass = {};
for (const s of data.test) {
  const r = (perClass[ids[s.y]] ??= { n: 0, a: 0, b: 0 });
  const pick = (score) => { const z = score(s.v); return argmax(z.map((x, i) => (isBg[i] ? -Infinity : x))); };
  r.n++; if (pick(textLogits) === s.y) r.a++; if (pick(finalScore) === s.y) r.b++;
}
console.log('\n各類別 測試集 (文字 → 新)：');
console.log(Object.entries(perClass).map(([id, r]) => `${id} ${r.a}/${r.n}→${r.b}/${r.n}`).join('  '));

// 二選一規則：前兩名都夠高且差距小時，請使用者選
console.log('\n二選一規則（測試集，單張照片）：');
for (const [margin, min2] of [[0.2, 0.15], [0.3, 0.1], [0.4, 0.1]]) {
  let direct = 0, asked = 0, askedOk = 0, wrong = 0;
  for (const s of data.test) {
    const p = softmax(finalScore(s.v));
    const order = p.map((x, i) => [x, i]).filter(([, i]) => !isBg[i]).sort((a, b) => b[0] - a[0]);
    const [[p1, c1], [p2, c2]] = order;
    if (p2 >= min2 && p1 - p2 < margin) { asked++; if (c1 === s.y || c2 === s.y) askedOk++; }
    else if (c1 === s.y) direct++;
    else wrong++;
  }
  const n = data.test.length, pc = (x) => `${((x / n) * 100).toFixed(1)}%`;
  console.log(`  差距<${margin} 且第二名≥${min2}：直接答對 ${pc(direct)}、詢問 ${pc(asked)}（其中選項含正確 ${pc(askedOk)}）、直接答錯 ${pc(wrong)}`);
}

if (WRITE) {
  if (testBest.top1 <= testBase.top1) {
    console.log('\n測試集沒有變好，不寫入。');
  } else {
    const classes = ids.map((id, c) => ({ id, embedding: Array.from(W[c], (x) => +x.toFixed(5)) }));
    const out = { model: text.model, method: best.name, classes };
    if (refs.length) {
      // refs.bin：每個參考樣本 D 個 int8；類別與縮放係數放在 JSON
      const bin = new Int8Array(refs.length * D);
      refs.forEach((r, i) => bin.set(r.q, i * D));
      await writeFile(new URL('../refs.bin', import.meta.url), bin);
      out.refs = {
        file: 'refs.bin', dim: D, alpha: best.alpha, beta: best.beta,
        labels: refs.map((r) => r.y), scales: refs.map((r) => +r.scale.toPrecision(6)),
      };
    }
    await writeFile(new URL('../embeddings.json', import.meta.url), JSON.stringify(out));
    console.log(`\n已寫入 ../embeddings.json${refs.length ? ` 與 ../refs.bin（${refs.length} 個參考樣本）` : ''}（${best.name}）`);
  }
}
