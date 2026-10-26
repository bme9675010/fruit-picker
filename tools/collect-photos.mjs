// 從維基共享資源收集每種蔬果的公開照片，作為參考樣本與測試資料。
// 照片只存在本機 tools/photos/（不進 git），App 只會用到算好的特徵。
// 用法：node collect-photos.mjs
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FRUITS, VEGETABLES } from '../fruits.js';

const UA = 'fruit-picker/0.1 (https://github.com/bme9675010/fruit-picker)';
const PER_CLASS = 40;
const EXCLUDE = '-painting -drawing -illustration -engraving -flower -flowers -blossom -tree -seedling -leaf -dish -soup -salad -cake -recipe -map -stamp -logo';
const dir = new URL('./photos/', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, as = 'json') {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 || res.status >= 500) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return as === 'json' ? res.json() : Buffer.from(await res.arrayBuffer());
  }
  throw new Error(`gave up ${url}`);
}

async function search(query) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6'
    + '&gsrlimit=30&prop=imageinfo&iiprop=url|mime&iiurlwidth=336&gsrsearch='
    + encodeURIComponent(`${query} ${EXCLUDE} filetype:bitmap`);
  const data = await get(api);
  return Object.values(data.query?.pages ?? {})
    .filter((p) => /jpeg|png|webp/.test(p.imageinfo?.[0]?.mime ?? ''))
    .map((p) => ({ title: p.title, url: p.imageinfo[0].thumburl }));
}

// 用英文描述搜不太到照片的品項，補上學名或常見名稱（不加 fruit／vegetable）
const EXTRA_QUERIES = {
  roselle: ['roselle', 'Hibiscus sabdariffa calyx'], water_bamboo: ['Zizania latifolia', 'jiaobai'],
  water_caltrop: ['water caltrop', 'Trapa bicornis', 'Trapa natans nut'], wood_ear: ['wood ear mushroom', 'Auricularia heimuer'],
  enoki: ['enokitake', 'enoki'], edamame: ['edamame', 'green soybeans pods'], winter_melon: ['wax gourd', 'Benincasa hispida'],
  king_oyster: ['Pleurotus eryngii', 'king oyster mushroom'], chinese_yam: ['Dioscorea polystachya tuber', 'nagaimo'],
  garlic: ['garlic bulbs', 'garlic heads'], burdock: ['burdock root', 'gobo'], baby_corn: ['baby corn', 'young corn'],
  button_mushroom: ['Agaricus bisporus', 'button mushrooms'], snow_peas: ['snow peas', 'sugar snap peas', 'mangetout'],
  jujube: ['Ziziphus mauritiana fruit', 'Indian jujube'], shiitake: ['shiitake', 'Lentinula edodes'],
  bamboo_shoot: ['bamboo shoots', 'takenoko'], asparagus: ['asparagus', 'asparagus spears'],
  sugarcane: ['sugarcane', 'Saccharum officinarum stalks'], ginger: ['ginger rhizome', 'ginger root'], lotus_root: ['lotus root', 'renkon'],
};
const MIN_PER_CLASS = 20;
const exists = (p) => access(p).then(() => true, () => false);
const indexFile = new URL('index.json', dir);
const index = (await exists(indexFile)) ? JSON.parse(await readFile(indexFile, 'utf8')) : {};

// 下載與搜尋同時進行：搜尋 API 一次只發一個請求，圖片用 4 個下載器
const jobs = Object.values(index).flat();
let searching = true, done = 0, failed = 0;
async function worker() {
  while (jobs.length || searching) {
    const job = jobs.shift();
    if (!job) { await sleep(500); continue; }
    const path = new URL(job.file, dir);
    if (!(await exists(path))) {
      try {
        await mkdir(new URL('.', path), { recursive: true });
        await writeFile(path, await get(job.url, 'buffer'));
        await sleep(200);
      } catch (err) {
        failed++;
        console.warn(`skip ${job.title}: ${err.message}`);
      }
    }
    if (++done % 200 === 0) console.log(`downloaded ${done}`);
  }
}
const workers = [worker(), worker(), worker(), worker()];

for (const [items, kind] of [[FRUITS, 'fruit'], [VEGETABLES, 'vegetable']]) {
  for (const item of items) {
    if (index[item.id]?.length >= MIN_PER_CLASS || (index[item.id]?.length && !EXTRA_QUERIES[item.id])) continue;
    const seen = new Map((index[item.id] ?? []).map((h) => [h.title, h]));
    const queries = [
      ...(index[item.id] ? [] : item.names.slice(0, 3).map((n) => `${n.replace(/^(a|an) /, '')} ${kind}`)),
      ...(EXTRA_QUERIES[item.id] ?? []),
    ];
    for (const q of queries) {
      for (const hit of await search(q)) seen.set(hit.title, hit);
      if (seen.size >= PER_CLASS) break;
    }
    index[item.id] = [...seen.values()].slice(0, PER_CLASS).map((h) => ({
      ...h,
      file: `${item.id}/${createHash('sha1').update(h.title).digest('hex').slice(0, 12)}.jpg`,
    }));
    jobs.push(...index[item.id]);
    console.log(`${item.id}: ${index[item.id].length}`);
    await writeFile(indexFile, JSON.stringify(index, null, 1));
  }
}
searching = false;
await Promise.all(workers);
console.log(`done ${done}, failed ${failed}`);
