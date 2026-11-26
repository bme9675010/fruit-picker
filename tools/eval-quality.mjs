// 實測外觀判斷：用維基共享資源上標了「腐爛／未熟／萎黃…」的照片，以及訓練用的新鮮照片（看誤判率）。
// 用法：MODEL=s1 node eval-quality.mjs
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';
import { MODEL_ID, SFX } from './model.mjs';
import { badTitle } from './photo-rules.mjs';

const UA = 'fruit-picker/0.1 (https://github.com/bme9675010/fruit-picker)';
const dir = new URL('./photos/quality/', import.meta.url);
const exists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const load = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));

// [品項, 預期狀態, 搜尋字]
const CASES = [
  ['banana', 'unripe', 'green unripe bananas'], ['banana', 'ripe', 'ripe bananas'], ['banana', 'overripe', 'overripe bananas'], ['banana', 'rotten', 'rotten bananas'],
  ['mango', 'unripe', 'unripe green mango'], ['mango', 'ripe', 'ripe mangoes'], ['mango', 'rotten', 'rotten mango'],
  ['papaya', 'unripe', 'green papaya fruit'], ['papaya', 'ripe', 'ripe papaya'],
  ['tomato', 'unripe', 'green tomatoes'], ['tomato', 'ripe', 'ripe red tomatoes'], ['tomato', 'rotten', 'rotten tomato'],
  ['strawberry', 'unripe', 'unripe strawberries'], ['strawberry', 'ripe', 'ripe strawberries'], ['strawberry', 'rotten', 'moldy strawberries'],
  ['pineapple', 'unripe', 'unripe pineapple'], ['pineapple', 'ripe', 'ripe pineapple'],
  ['apple', 'damaged', 'bruised apple'], ['apple', 'rotten', 'rotten apple'], ['pear', 'damaged', 'bruised pear'],
  ['citrus', 'rotten', 'moldy orange fruit'], ['potato', 'rotten', 'rotten potatoes'], ['grape', 'rotten', 'rotten grapes'],
  ['peach', 'rotten', 'rotten peach'], ['onion', 'rotten', 'rotten onion'], ['carrot', 'rotten', 'rotten carrots'],
  ['lettuce', 'damaged', 'wilted lettuce'], ['celery', 'damaged', 'wilted celery'], ['bok_choy', 'damaged', 'wilted bok choy'],
];
const PER_CASE = 12;

async function get(url, as = 'json') {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 || res.status >= 500) { await sleep(4000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${res.status}`);
    return as === 'json' ? res.json() : Buffer.from(await res.arrayBuffer());
  }
  throw new Error('gave up');
}

// 下載測試照片（已下載的沿用）
const index = (await exists(new URL('index.json', dir))) ? await load('./photos/quality/index.json') : {};
await mkdir(dir, { recursive: true });
for (const [id, state, q] of CASES) {
  const key = `${id}|${state}|${q}`;
  if (index[key]) continue;
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6'
    + `&gsrlimit=${PER_CASE}&prop=imageinfo&iiprop=url|mime&iiurlwidth=336&gsrsearch=` + encodeURIComponent(`${q} -painting -drawing -illustration filetype:bitmap`);
  const pages = Object.values((await get(api)).query?.pages ?? {}).filter((p) => /jpeg|png/.test(p.imageinfo?.[0]?.mime ?? ''));
  index[key] = [];
  for (const p of pages) {
    const file = `${createHash('sha1').update(p.title).digest('hex').slice(0, 12)}.jpg`;
    try {
      if (!(await exists(new URL(file, dir)))) await writeFile(new URL(file, dir), await get(p.imageinfo[0].thumburl, 'buffer'));
      index[key].push({ title: p.title, file });
    } catch {}
    await sleep(150);
  }
  await writeFile(new URL('index.json', dir), JSON.stringify(index, null, 1));
}

// 計算特徵（原圖與中央 70% 平均，與 App 照片模式相同）
const processor = await AutoProcessor.from_pretrained(MODEL_ID);
const vision = await CLIPVisionModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp16' });
const embed = async (img) => (await vision(await processor(img))).image_embeds.normalize(2, -1).data;
async function multiView(path) {
  const img = await RawImage.read(fileURLToPath(path));
  const s = Math.round(Math.min(img.width, img.height) * 0.7);
  const x = Math.round((img.width - s) / 2), y = Math.round((img.height - s) / 2);
  const a = await embed(img), b = await embed(await img.crop([x, y, x + s - 1, y + s - 1]));
  const v = a.map((t, i) => t + b[i]); const n = Math.hypot(...v);
  return v.map((t) => t / n);
}

const quality = await load(`../quality${SFX}.json`);
const decode = (e) => { const [sc, b64] = e.split(':'); const b = Buffer.from(b64, 'base64'); return Float32Array.from(new Int8Array(b.buffer, b.byteOffset, b.length), (x) => x * Number(sc)); };
const states = Object.fromEntries(Object.entries(quality.items).map(([id, it]) => [id, it.states.map((s) => ({ key: s.key, v: decode(s.v) }))]));
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
// 校準：「碰傷」「腐爛」的分數各減掉 bias，壓低把新鮮蔬果誤判成壞掉的比例
let bias = { damaged: 0, rotten: 0 };
const judge = (id, v) => {
  const z = states[id].map((s) => 100 * dot(s.v, v) - (bias[s.key] ?? 0)); const m = Math.max(...z);
  const e = z.map((x) => Math.exp(x - m)); const sum = e.reduce((a, b) => a + b);
  return states[id].map((s, i) => ({ key: s.key, p: e[i] / sum })).sort((a, b) => b.p - a.p);
};

// 1. 標了狀態的照片
const results = [];
for (const [id, state, q] of CASES) {
  for (const { title, file } of index[`${id}|${state}|${q}`] ?? []) {
    if (badTitle(id, title)) continue;
    try { const v = await multiView(new URL(file, dir)); results.push({ id, state, q, title, v, r: judge(id, v) }); } catch {}
  }
}
console.log('\n各狀態（標示照片，搜尋結果可能夾雜不相干的圖）：');
for (const [id, state, q] of CASES) {
  const rs = results.filter((r) => r.q === q);
  const hit = rs.filter((r) => r.r[0].key === state).length;
  console.log(`  ${id.padEnd(11)} ${state.padEnd(8)} ${hit}/${rs.length}　${rs.map((r) => r.r[0].key[0]).join('')}`);
}

// 2. 訓練用的新鮮照片（測試集）：被說成碰傷／腐爛的比例
const photoIndex = await load('./photos/index.json');
const feats = await load(`./photos/features${SFX}.json`);
const split = (t) => parseInt(createHash('sha1').update(t).digest('hex').slice(0, 8), 16) % 10 < 3;
const fresh = [];
for (const [id, entries] of Object.entries(photoIndex)) {
  if (!states[id]) continue;
  for (const e of entries) {
    if (!split(e.title) || badTitle(id, e.title) || !feats[e.file] || !feats[`${e.file}#c`]) continue;
    const v = feats[e.file].map((t, i) => t + feats[`${e.file}#c`][i]); const n = Math.hypot(...v);
    const vn = v.map((t) => t / n); fresh.push({ id, v: vn, r: judge(id, vn) });
  }
}
const bad = (r) => ['damaged', 'rotten'].includes(r.r[0].key);
console.log(`\n新鮮照片（${fresh.length} 張）被判成碰傷／腐爛：${(fresh.filter(bad).length / fresh.length * 100).toFixed(1)}%`);

// 3. 門檻：只在最高狀態的機率 ≥ T 時才顯示
console.log('\n顯示門檻（標示照片的準確度／會顯示的比例；新鮮照片的誤報率）：');
for (const T of [0, 0.5, 0.6, 0.7, 0.8]) {
  const shown = results.filter((r) => r.r[0].p >= T);
  const acc = shown.filter((r) => r.r[0].key === r.state).length / (shown.length || 1);
  const falseAlarm = fresh.filter((r) => bad(r) && r.r[0].p >= T).length / fresh.length;
  console.log(`  T=${T}：準確 ${(acc * 100).toFixed(1)}%（顯示 ${(shown.length / results.length * 100).toFixed(0)}%）　誤報 ${(falseAlarm * 100).toFixed(1)}%`);
}

// 4. 校準 bias：新鮮照片誤報 vs 抓到真正壞掉的比例（腐爛、碰傷分開看）
console.log('\n校準（bias 越大越保守）：');
for (const b of [0, 2, 3, 4, 5, 6, 8]) {
  for (const T of [0.5, 0.6]) {
    bias = { damaged: b + 1, rotten: b };
    const rj = (r) => judge(r.id, r.v)[0];
    const fa = fresh.filter((r) => { const t = rj(r); return ['damaged', 'rotten'].includes(t.key) && t.p >= T; }).length / fresh.length;
    const rot = results.filter((r) => r.state === 'rotten'), dmg = results.filter((r) => r.state === 'damaged');
    const rotHit = rot.filter((r) => { const t = rj(r); return t.key === 'rotten' && t.p >= T; }).length;
    const rotAny = rot.filter((r) => { const t = rj(r); return ['rotten', 'damaged'].includes(t.key) && t.p >= T; }).length;
    const dmgHit = dmg.filter((r) => { const t = rj(r); return ['rotten', 'damaged'].includes(t.key) && t.p >= T; }).length;
    const rip = results.filter((r) => ['unripe', 'ripe', 'overripe'].includes(r.state));
    const ripHit = rip.filter((r) => { const t = rj(r); return t.key === r.state && t.p >= T; }).length;
    const ripShown = rip.filter((r) => rj(r).p >= T).length;
    console.log(`  bias ${b}/${b + 1} T=${T}：新鮮誤報 ${(fa * 100).toFixed(1)}%｜腐爛抓到 ${rotHit}/${rot.length}（含碰傷 ${rotAny}）｜碰傷抓到 ${dmgHit}/${dmg.length}｜熟度 對 ${ripHit}/顯示 ${ripShown}/共 ${rip.length}`);
  }
}
