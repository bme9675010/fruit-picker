// 用參考照片改善辨識。比較幾種做法，挑驗證集最好的：
//   text  ：只用文字特徵
//   probe ：從文字特徵出發、用照片微調的線性分類器
//   +tip  ：再加上參考樣本比對（Tip-Adapter）
// 照片依檔名雜湊固定分成 訓練 50%／驗證 20%／測試 30%，測試集只用來報告最後結果。
// 每張照片另有「中央 70% 裁切」版本（App 只看對準框裡的畫面），訓練時當成額外資料，評估時兩種都算。
// 也會拿同一個模型目前的檔案（線上版本）在同一批測試照片上比較。
// 用法：node train.mjs           只比較、印出結果
//       node train.mjs --write   測試集比線上版本好時，寫入 ../embeddings.json 與 ../refs.bin
//       node train.mjs --quick   跳過參數搜尋，直接用上次選出的設定
//       --force                  不跟線上版本比較就寫入（輕量備援模型用）
//       MODEL=s1 node train.mjs  改用較大的 s1 模型（輸出 ../embeddings-s1.json、../refs-s1.bin）
// 哪些照片算有效、怎麼分組，一律用 s0 判斷，所以不同模型是在同一批測試照片上比較。
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { badTitle, MERGED } from './photo-rules.mjs';
import { SFX } from './model.mjs';

const WRITE = process.argv.includes('--write');
const SCALE = 100;
const exists = (p) => access(new URL(p, import.meta.url)).then(() => true, () => false);
const load = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
const baseText = await load('./text-embeddings.json');
const text = SFX ? await load(`./text-embeddings${SFX}.json`) : baseText;
const index = await load('./photos/index.json');
const baseFeats = await load('./photos/features.json');
const feats = SFX ? await load(`./photos/features${SFX}.json`) : baseFeats;

const ids = text.classes.map((c) => c.id);
const D = text.classes[0].embedding.length;
const T = text.classes.map((c) => Float32Array.from(c.embedding));
if (baseText.classes.map((c) => c.id).join() !== ids.join()) throw new Error('text-embeddings 的類別不一致，請重新執行 build-embeddings');
const dot = (a, b) => { let s = 0; for (let i = 0; i < D; i++) s += a[i] * b[i]; return s; };
const softmax = (z) => { const m = Math.max(...z); const e = z.map((x) => Math.exp(x - m)); const s = e.reduce((a, b) => a + b); return e.map((x) => x / s); };
const argmax = (a) => a.reduce((bi, x, i) => (x > a[bi] ? i : bi), 0);
const splitOf = (title) => {
  const h = parseInt(createHash('sha1').update(title).digest('hex').slice(0, 8), 16) % 10;
  return h < 3 ? 'test' : h < 5 ? 'val' : 'train';
};

// ---------- 評分器：給一個影像特徵，回傳各類別分數 ----------
function scorer(classIds, W, refs = [], alpha = 0, beta = 0) {
  const bg = classIds.map((id) => id.startsWith('bg_'));
  const fn = (v) => {
    const z = W.map((w) => SCALE * dot(w, v));
    if (alpha && refs.length) {
      const a = new Float64Array(classIds.length);
      for (const r of refs) { const b = Math.exp(-beta * (1 - dot(r.v, v))); if (b > a[r.c]) a[r.c] = b; }
      for (let c = 0; c < z.length; c++) z[c] += alpha * a[c];
    }
    return z;
  };
  return Object.assign(fn, { ids: classIds, bg });
}

// ---------- 整理資料 ----------
const textScore = scorer(ids, T);
const baseScore = scorer(ids, baseText.classes.map((c) => Float32Array.from(c.embedding)));
const vec = (f) => (f ? Float32Array.from(f) : null);
const pos = [], neg = [];
let dropped = 0;
for (const [photoId, entries] of Object.entries(index)) {
  const id = MERGED[photoId] ?? photoId;
  const y = ids.indexOf(id);
  if (y < 0) continue; // 已從清單移除的品項
  for (const e of entries) {
    if (!feats[e.file] || !baseFeats[e.file]) continue;
    // v／vc：受測模型的特徵；v0／vc0：s0 的特徵（篩選照片與評估線上版本用）
    const sample = {
      id, y, title: e.title, split: splitOf(e.title),
      v: vec(feats[e.file]), vc: vec(feats[`${e.file}#c`]), v0: vec(baseFeats[e.file]), vc0: vec(baseFeats[`${e.file}#c`]),
    };
    const z = baseScore(sample.v0);
    const bad = badTitle(id, e.title); // 標題看起來不是蔬果本身（畫作、植株、菜餚…），當成「非蔬果」的負樣本
    if (bad || baseScore.bg[argmax(z)]) { neg.push(sample); continue; }
    if (z.filter((x) => x > z[y]).length >= 10) { dropped++; continue; } // 多半是搜尋到不相干的圖
    pos.push(sample);
  }
}
const part = (arr, s) => arr.filter((x) => x.split === s);
// 驗證／測試集排除跟訓練照片幾乎一樣的圖（同一系列連拍），避免高估
const trainPos = part(pos, 'train');
const notDup = (x) => !trainPos.some((t) => dot(t.v0, x.v0) >= 0.95);
const data = {
  train: trainPos, val: part(pos, 'val').filter(notDup), test: part(pos, 'test').filter(notDup),
  negTrain: part(neg, 'train'), negVal: part(neg, 'val'), negTest: part(neg, 'test'),
};
console.log(`照片：正樣本 train ${data.train.length} / val ${data.val.length} / test ${data.test.length}，`
  + `負樣本 ${neg.length}，丟棄（不相干）${dropped}`);

// ---------- 評估：原圖、中央裁切，以及兩者特徵平均（多角度）都算 ----------
const normalize = (v) => { const n = Math.hypot(...v); return v.map((x) => x / n); };
// base：評估線上版本（s0）時改用 s0 的特徵
const view = (s, mode, base = false) => {
  const [v, vc] = base ? [s.v0, s.vc0] : [s.v, s.vc];
  if (mode === 'crop') return vc;
  if (mode === 'multi') return vc && normalize(v.map((x, i) => x + vc[i]));
  return v;
};
function evaluate(score, set, negSet, mode = 'orig') {
  let top1 = 0, top2 = 0, bgMiss = 0, negOk = 0, n = 0;
  for (const s of set) {
    const v = view(s, mode, score.base);
    if (!v) continue;
    n++;
    const z = score(v);
    const order = z.map((x, i) => [x, i]).filter(([, i]) => !score.bg[i]).sort((a, b) => b[0] - a[0]);
    if (score.ids[order[0][1]] === s.id) top1++;
    if (score.ids[order[0][1]] === s.id || score.ids[order[1][1]] === s.id) top2++;
    if (score.bg[argmax(z)]) bgMiss++;
  }
  let m = 0;
  for (const s of negSet) { const v = view(s, mode, score.base); if (!v) continue; m++; if (score.bg[argmax(score(v))]) negOk++; }
  return { top1: top1 / n, top2: top2 / n, bgMiss: bgMiss / n, negOk: m ? negOk / m : NaN, n };
}
const both = (score, set, negSet) => {
  const a = evaluate(score, set, negSet), b = evaluate(score, set, negSet, 'crop');
  return { orig: a, crop: b, top1: (a.top1 + b.top1) / 2, negOk: (a.negOk + b.negOk) / 2 };
};
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const fmt = (r) => `原圖 top1 ${pct(r.orig.top1)} top2 ${pct(r.orig.top2)} ｜ 裁切 top1 ${pct(r.crop.top1)} top2 ${pct(r.crop.top2)} ｜ 誤判非蔬果 ${pct(r.orig.bgMiss)} ｜ 非蔬果拒絕 ${pct(r.negOk)}`;
const fmtMulti = (score, set, negSet) => {
  const r = evaluate(score, set, negSet, 'multi');
  return `多角度 top1 ${pct(r.top1)} top2 ${pct(r.top2)} ｜ 非蔬果拒絕 ${pct(r.negOk)}`;
};

// ---------- 線性分類器（從文字特徵出發，L2 拉回文字特徵避免過度擬合） ----------
const isBg = textScore.bg;
function trainProbe(samples, negs, lambda, steps, snapshots = []) {
  const C = ids.length;
  const W = T.map((t) => Float32Array.from(t));
  const m = W.map(() => new Float32Array(D)), v2 = W.map(() => new Float32Array(D));
  const lr = 5e-4, b1 = 0.9, b2 = 0.999;
  const all = [...samples.map((s) => ({ ...s, neg: false })), ...negs.map((s) => ({ ...s, neg: true }))];
  const out = {};
  for (let step = 1; step <= steps; step++) {
    const G = W.map(() => new Float32Array(D));
    for (const s of all) {
      const p = softmax(W.map((w) => SCALE * dot(w, s.v)));
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
// 加入中央裁切版本當額外訓練資料
const withCrops = (arr) => arr.flatMap((s) => (s.vc ? [s, { ...s, v: s.vc }] : [s]));
// 參考樣本只用原圖（加裁切版幾乎沒幫助、檔案卻加倍）；cap 限制每類數量以控制 refs.bin 大小
const toRefs = (arr, cap = Infinity) => {
  const count = {};
  return arr.filter((s) => (count[s.y] = (count[s.y] ?? 0) + 1) <= cap).map((s) => ({ c: s.y, v: s.v }));
};

// ---------- 用驗證集挑參數 ----------
const base = both(textScore, data.val, data.negVal);
console.log(`\n[驗證] 只用文字\n  ${fmt(base)}`);
// 綜合分數：準確度為主，「非蔬果」拒絕率也算一點（每 1% 拒絕率約等於 0.1% 準確度），
// 且拒絕率不能比只用文字差超過 5%
const merit = (r) => r.top1 + 0.1 * r.negOk;
let best = { name: 'text', r: base };
const consider = (name, r, cfg) => {
  console.log(`[驗證] ${name}\n  ${fmt(r)}`);
  if (merit(r) > merit(best.r) && r.negOk >= base.negOk - 0.05) best = { name, r, ...cfg };
};

const QUICK = process.argv.includes('--quick'); // 跳過參數搜尋，直接用上次選出的設定
const SNAP = [50, 100];
if (QUICK) best = { name: 'probe+裁切 λ0.1 s50 + 樣本 α10（--quick）', aug: true, lambda: 0.1, step: 50, alpha: 10, beta: 5.5, cap: Infinity };
else for (const lambda of [0.1, 0.3]) {
  const snaps = trainProbe(withCrops(data.train), withCrops(data.negTrain), lambda, 100, SNAP);
  for (const step of SNAP) {
    for (const alpha of [10, 20]) {
      for (const cap of [30, Infinity]) {
        consider(`probe+裁切 λ${lambda} s${step} + 樣本(每類≤${cap}) α${alpha}`,
          both(scorer(ids, snaps[step], toRefs(data.train, cap), alpha, 5.5), data.val, data.negVal),
          { aug: true, lambda, step, alpha, beta: 5.5, cap });
      }
    }
  }
}
console.log(`\n最佳：${best.name}`);

// ---------- 用訓練＋驗證集重新訓練，在測試集與線上版本比較 ----------
const fitSet = [...data.train, ...data.val];
const fitNeg = [...data.negTrain, ...data.negVal];
let W = T, refs = [];
if (best.lambda !== undefined) {
  W = trainProbe(best.aug ? withCrops(fitSet) : fitSet, best.aug ? withCrops(fitNeg) : fitNeg, best.lambda, best.step);
  // 訓練＋驗證集合併後照片較多，cap 依比例放大（50% → 70%）
  refs = toRefs(fitSet, best.cap === Infinity ? Infinity : Math.round(best.cap * 1.4));
}
// 參考樣本以 int8 存放（每個向量一個縮放係數），體積約為 float32 的 1/4
const quantize = (v) => { const scale = Math.max(...v.map(Math.abs)) / 127; return { q: Int8Array.from(v, (x) => Math.round(x / scale)), scale }; };
const qrefs = refs.map((r) => ({ c: r.c, ...quantize(r.v) }));
const finalScore = scorer(ids, W, qrefs.map((r) => ({ c: r.c, v: Float32Array.from(r.q, (x) => x * r.scale) })), best.alpha ?? 0, best.beta ?? 0);

// 線上版本
let current = null;
// 跟同一個模型目前的檔案比較（s1 → ../embeddings-s1.json；s0 → ../embeddings.json）
if (await exists(`../embeddings${SFX}.json`)) {
  const cur = await load(`../embeddings${SFX}.json`);
  const curIds = cur.classes.map((c) => c.id);
  let curRefs = [];
  if (cur.refs && (await exists(`../${cur.refs.file}`))) {
    const bin = new Int8Array(await readFile(new URL(`../${cur.refs.file}`, import.meta.url)));
    curRefs = cur.refs.labels.map((c, i) => ({ c, v: Float32Array.from(bin.subarray(i * D, (i + 1) * D), (x) => x * cur.refs.scales[i]) }));
  }
  current = scorer(curIds, cur.classes.map((c) => Float32Array.from(c.embedding)), curRefs, cur.refs?.alpha ?? 0, cur.refs?.beta ?? 0);
}
const curSet = current ? new Set(current.ids) : new Set();
const oldTest = data.test.filter((s) => curSet.has(s.id)), newTest = data.test.filter((s) => !curSet.has(s.id));
const oldNeg = data.negTest;

console.log(`\n[測試・原有 ${curSet.size ? [...curSet].filter((x) => !x.startsWith('bg_')).length : 0} 種，${oldTest.length} 張]`);
console.log(`  只用文字    ${fmt(both(textScore, oldTest, oldNeg))}`);
const curR = current && both(current, oldTest, oldNeg);
if (current) console.log(`  線上版本    ${fmt(curR)}`);
const newR = both(finalScore, oldTest, oldNeg);
console.log(`  新版本      ${fmt(newR)}`);
if (current) console.log(`  線上版本    ${fmtMulti(current, oldTest, oldNeg)}`);
console.log(`  新版本      ${fmtMulti(finalScore, oldTest, oldNeg)}`);
if (newTest.length) {
  console.log(`[測試・新增品項 ${newTest.length} 張]`);
  console.log(`  只用文字    ${fmt(both(textScore, newTest, []))}`);
  console.log(`  新版本      ${fmt(both(finalScore, newTest, []))}`);
}

// 各類別（測試集原圖，文字 → 線上 → 新）
const pick = (score, v) => score.ids[argmax(score(v).map((x, i) => (score.bg[i] ? -Infinity : x)))];
const perClass = {};
const stolen = {}; // 原有品項：線上版本認對、新版本卻被認成「新增品項」的照片數
for (const s of data.test) {
  const r = (perClass[s.id] ??= { n: 0, t: 0, c: 0, b: 0 });
  r.n++;
  if (pick(textScore, s.v) === s.id) r.t++;
  const curOk = current && curSet.has(s.id) && pick(current, s.v) === s.id;
  if (curOk) r.c++;
  const p = pick(finalScore, s.v);
  if (p === s.id) r.b++;
  else if (curOk && !curSet.has(p)) (stolen[p] ??= []).push(s.id);
}
console.log('\n各類別 測試集（文字 → 線上 → 新）：');
console.log(Object.entries(perClass).map(([id, r]) => `${id} ${r.t}→${curSet.has(id) ? r.c : '-'}→${r.b}/${r.n}`).join('  '));
console.log('\n新增品項 測試集準確度（以及從原有品項搶走幾張原本認對的照片）：');
for (const id of ids.filter((x) => !x.startsWith('bg_') && !curSet.has(x))) {
  const r = perClass[id];
  const st = stolen[id] ?? [];
  console.log(`  ${id}: ${r ? `${r.b}/${r.n}` : '沒有測試照片'}　搶走 ${st.length}${st.length ? `（${st.join(', ')}）` : ''}`);
}

// 二選一規則：前兩名都夠高且差距小時，請使用者選
console.log('\n二選一規則（測試集原圖）：');
for (const [margin, min2] of [[0.2, 0.15], [0.3, 0.1]]) {
  let direct = 0, asked = 0, askedOk = 0, wrong = 0;
  for (const s of data.test) {
    const p = softmax(finalScore(s.v));
    const order = p.map((x, i) => [x, i]).filter(([, i]) => !finalScore.bg[i]).sort((a, b) => b[0] - a[0]);
    const [[p1, c1], [p2, c2]] = order;
    const hit = (c) => ids[c] === s.id;
    if (p2 >= min2 && p1 - p2 < margin) { asked++; if (hit(c1) || hit(c2)) askedOk++; }
    else if (hit(c1)) direct++;
    else wrong++;
  }
  const n = data.test.length, pc = (x) => pct(x / n);
  console.log(`  差距<${margin} 且第二名≥${min2}：直接答對 ${pc(direct)}、詢問 ${pc(asked)}（其中選項含正確 ${pc(askedOk)}）、直接答錯 ${pc(wrong)}`);
}

// --force：不跟線上版本比較就寫入（用於輕量備援模型，它只要跟主模型的品項一致即可）
if (WRITE) {
  if (curR && newR.top1 <= curR.top1 && !process.argv.includes('--force')) {
    console.log('\n原有品項的測試準確度沒有比線上版本好，不寫入。');
  } else {
    const classes = ids.map((id, c) => ({ id, embedding: Array.from(W[c], (x) => +x.toFixed(5)) }));
    const out = { model: text.model, method: best.name, classes };
    if (qrefs.length) {
      // refs.bin：每個參考樣本 D 個 int8；類別與縮放係數放在 JSON
      const bin = new Int8Array(qrefs.length * D);
      qrefs.forEach((r, i) => bin.set(r.q, i * D));
      await writeFile(new URL(`../refs${SFX}.bin`, import.meta.url), bin);
      out.refs = {
        file: `refs${SFX}.bin`, dim: D, alpha: best.alpha, beta: best.beta,
        labels: qrefs.map((r) => r.c), scales: qrefs.map((r) => +r.scale.toPrecision(6)),
      };
    }
    await writeFile(new URL(`../embeddings${SFX}.json`, import.meta.url), JSON.stringify(out));
    console.log(`\n已寫入 ../embeddings${SFX}.json${qrefs.length ? ` 與 ../refs${SFX}.bin（${qrefs.length} 個參考樣本）` : ''}（${best.name}）`);
  }
}
