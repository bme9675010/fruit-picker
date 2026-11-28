// 「爛了沒」影像分類器：用維基共享資源上腐爛、發霉蔬果的照片，對比訓練用的新鮮照片，
// 學一個「腐爛方向」的線性分類器（比只用文字描述「a rotten {}」準）。
// 照片依標題雜湊固定分成訓練 70%／測試 30%（與 train.mjs 的測試集一致）；門檻選在「測試集新鮮照片誤報約 3%」。
// 用法：MODEL=s1 node rot-detector.mjs [--write]   --write 會把結果加進 ../quality{後綴}.json（要先跑 build-quality）
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';
import { MODEL_ID, SFX } from './model.mjs';
import { badTitle } from './photo-rules.mjs';
import { PROTEINS } from '../fruits.js';

const UA = 'fruit-picker/0.1 (https://github.com/bme9675010/fruit-picker)';
const dir = new URL('./photos/rot/', import.meta.url);
const qdir = new URL('./photos/quality/', import.meta.url);
const exists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = async (p) => JSON.parse(await readFile(p, 'utf8'));
const hash = (t) => parseInt(createHash('sha1').update(t).digest('hex').slice(0, 8), 16) % 10;
const FA_TARGET = 0.03;

const QUERIES = ['rotten fruit', 'rotting fruit', 'moldy fruit', 'mouldy fruit', 'rotten vegetables', 'rotting vegetables', 'moldy vegetables',
  'decaying fruit', 'spoiled fruit', 'fruit mold', 'Penicillium on fruit', 'Botrytis cinerea fruit', 'rotten apple', 'rotten banana',
  'rotten tomato', 'rotten orange', 'rotten potato', 'rotten onion', 'moldy strawberries', 'rotten grapes', 'rotten pear', 'rotten peach',
  'rotten mango', 'rotten lemon', 'moldy bread fruit bowl', 'rotten cabbage', 'rotten carrot', 'rotten pumpkin', 'moldy citrus', 'fruit rot disease'];

async function get(url, as = 'json') {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 || res.status >= 500) { await sleep(4000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status}`);
    return as === 'json' ? res.json() : Buffer.from(await res.arrayBuffer());
  }
  throw new Error('gave up');
}

// 1. 下載腐爛照片（已下載的沿用）
await mkdir(dir, { recursive: true });
const indexFile = new URL('index.json', dir);
const index = (await exists(indexFile)) ? await load(indexFile) : {};
for (const q of QUERIES) {
  if (index[q]) continue;
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6'
    + '&gsrlimit=40&prop=imageinfo&iiprop=url|mime&iiurlwidth=336&gsrsearch='
    + encodeURIComponent(`${q} -painting -drawing -illustration -microscope -micrograph -culture -petri filetype:bitmap`);
  const pages = Object.values((await get(api)).query?.pages ?? {}).filter((p) => /jpeg|png/.test(p.imageinfo?.[0]?.mime ?? ''));
  index[q] = [];
  for (const p of pages) {
    const file = `${createHash('sha1').update(p.title).digest('hex').slice(0, 12)}.jpg`;
    try {
      if (!(await exists(new URL(file, dir)))) await writeFile(new URL(file, dir), await get(p.imageinfo[0].thumburl, 'buffer'));
      index[q].push({ title: p.title, file });
    } catch {}
    await sleep(150);
  }
  await writeFile(indexFile, JSON.stringify(index, null, 1));
  console.log(`${q}: ${index[q].length}`);
}

// 2. 影像特徵（原圖與中央 70% 平均，與 App 照片模式相同），快取在 photos/rot/features{後綴}.json
const processor = await AutoProcessor.from_pretrained(MODEL_ID);
const vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp16' });
const embed = async (img) => (await vision(await processor(img))).image_embeds.normalize(2, -1).data;
const normalize = (v) => { const n = Math.hypot(...v); return v.map((t) => t / n); };
async function multiView(path) {
  const img = await RawImage.read(fileURLToPath(path));
  const s = Math.round(Math.min(img.width, img.height) * 0.7);
  const x = Math.round((img.width - s) / 2), y = Math.round((img.height - s) / 2);
  const a = await embed(img), b = await embed(await img.crop([x, y, x + s - 1, y + s - 1]));
  return normalize(Array.from(a, (t, i) => t + b[i]));
}
const featFile = new URL(`features${SFX}.json`, dir);
const feats = (await exists(featFile)) ? await load(featFile) : {};
const rotten = new Map(); // title → { v, src }
const qIndex = (await exists(new URL('index.json', qdir))) ? await load(new URL('index.json', qdir)) : {};
const sources = [
  ...Object.values(index).flat().map((e) => ({ ...e, path: new URL(e.file, dir), src: 'generic' })),
  // eval-quality.mjs 標了「腐爛」的照片也拿來用（照樣依標題分訓練／測試）
  ...Object.entries(qIndex).filter(([k]) => k.split('|')[1] === 'rotten').flatMap(([, list]) => list.map((e) => ({ ...e, path: new URL(e.file, qdir), src: 'labeled' }))),
];
for (const e of sources) {
  if (rotten.has(e.title) || /\b(painting|drawing|illustration|microscop|culture|petri|bread|cheese|meat)\b/i.test(e.title)) continue;
  const key = `${e.src}/${e.file}`;
  if (!feats[key]) {
    try { feats[key] = (await multiView(e.path)).map((t) => +t.toFixed(5)); } catch { continue; }
  }
  rotten.set(e.title, { v: feats[key], src: e.src, split: hash(e.title) < 3 ? 'test' : 'train' });
}
await writeFile(featFile, JSON.stringify(feats));

// 新鮮照片：訓練用的蔬果照片（不含生鮮）
const photoIndex = await load(new URL('./photos/index.json', import.meta.url));
const pf = await load(new URL(`./photos/features${SFX}.json`, import.meta.url));
const proteinIds = new Set(PROTEINS.map((p) => p.id));
const fresh = [];
for (const [id, entries] of Object.entries(photoIndex)) {
  if (proteinIds.has(id)) continue;
  for (const e of entries) {
    if (badTitle(id, e.title) || !pf[e.file] || !pf[`${e.file}#c`] || /rott|mold|mould|decay|spoil/i.test(e.title)) continue;
    fresh.push({ v: normalize(pf[e.file].map((t, i) => t + pf[`${e.file}#c`][i])), split: hash(e.title) < 3 ? 'test' : 'train' });
  }
}
const rot = [...rotten.values()];
console.log(`腐爛照片 ${rot.length} 張（訓練 ${rot.filter((r) => r.split === 'train').length}），新鮮照片 ${fresh.length} 張`);

// 3. 邏輯迴歸（兩類各佔一半權重，L2 正則化）
const D = rot[0].v.length;
const dot = (a, b) => { let s = 0; for (let i = 0; i < D; i++) s += a[i] * b[i]; return s; };
const sig = (x) => 1 / (1 + Math.exp(-x));
function train(pos, neg, lambda = 1e-3, steps = 400) {
  const w = new Float64Array(D); let b = 0;
  const m = new Float64Array(D + 1), v2 = new Float64Array(D + 1);
  const all = [...pos.map((s) => [s.v, 1, 0.5 / pos.length]), ...neg.map((s) => [s.v, 0, 0.5 / neg.length])];
  for (let t = 1; t <= steps; t++) {
    const g = new Float64Array(D + 1);
    for (const [x, y, wt] of all) {
      const e = (sig(20 * (dot(w, x) + b)) - y) * wt * 20;
      for (let i = 0; i < D; i++) g[i] += e * x[i];
      g[D] += e;
    }
    for (let i = 0; i <= D; i++) {
      const gi = g[i] + (i < D ? 2 * lambda * w[i] : 0);
      m[i] = 0.9 * m[i] + 0.1 * gi; v2[i] = 0.999 * v2[i] + 0.001 * gi * gi;
      const step = (0.01 * (m[i] / (1 - 0.9 ** t))) / (Math.sqrt(v2[i] / (1 - 0.999 ** t)) + 1e-8);
      if (i < D) w[i] -= step; else b -= step;
    }
  }
  return { w, b, score: (x) => 20 * (dot(w, x) + b) };
}
const part = (arr, s) => arr.filter((x) => x.split === s);
const det = train(part(rot, 'train'), part(fresh, 'train'));

// 4. 門檻：測試集新鮮照片的誤報約 FA_TARGET
const freshScores = part(fresh, 'test').map((s) => det.score(s.v)).sort((a, b) => b - a);
const threshold = freshScores[Math.floor(freshScores.length * FA_TARGET)];
const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log('\n測試集：');
for (const fa of [0.01, 0.02, 0.03, 0.05]) {
  const th = freshScores[Math.floor(freshScores.length * fa)];
  const hit = (src) => { const set = part(rot, 'test').filter((r) => !src || r.src === src); return `${set.filter((r) => det.score(r.v) >= th).length}/${set.length}`; };
  console.log(`  新鮮誤報 ${pct(fa)}：腐爛抓到 全部 ${hit()}｜一般搜尋 ${hit('generic')}｜品項標示 ${hit('labeled')}`);
}

if (process.argv.includes('--write')) {
  const file = new URL(`../quality${SFX}.json`, import.meta.url);
  const q = await load(file);
  const max = Math.max(...det.w.map(Math.abs)); const scale = max / 127;
  const bytes = Buffer.from(Int8Array.from(det.w, (x) => Math.round(x / scale)).buffer);
  // App：score = 20 × (w·v + b)，≥ threshold 就判為腐爛（int8 量化後重新算門檻，避免誤差）
  const wq = Float64Array.from(Int8Array.from(det.w, (x) => Math.round(x / scale)), (x) => x * scale);
  const qs = part(fresh, 'test').map((s) => 20 * (dot(wq, s.v) + det.b)).sort((a, b) => b - a);
  q.rot = { w: `${scale.toPrecision(6)}:${bytes.toString('base64')}`, b: +det.b.toFixed(6), threshold: +qs[Math.floor(qs.length * FA_TARGET)].toFixed(4) };
  await writeFile(file, JSON.stringify(q));
  console.log(`\n已寫入 quality${SFX}.json 的 rot（門檻 ${q.rot.threshold}，threshold 原值 ${threshold.toFixed(4)}）`);
}
