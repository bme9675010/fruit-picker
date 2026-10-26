// 從維基共享資源收集每種蔬果的公開照片，作為參考樣本與測試資料。
// 照片只存在本機 tools/photos/（不進 git），App 只會用到算好的特徵。
// 用法：node collect-photos.mjs
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FRUITS, VEGETABLES } from '../fruits.js';
import { searchExclude } from './photo-rules.mjs';

const UA = 'fruit-picker/0.1 (https://github.com/bme9675010/fruit-picker)';
const PER_CLASS = 80;
const ENOUGH = 60;        // 已有這麼多張就不再搜尋
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

async function search(query, id, offset = 0) {
  const api = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6'
    + `&gsrlimit=30&gsroffset=${offset}&prop=imageinfo&iiprop=url|mime&iiurlwidth=336&gsrsearch=`
    + encodeURIComponent(`${query} ${searchExclude(id)} filetype:bitmap`);
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
  kumquat: ['kumquat', 'Citrus japonica fruit'], oriental_melon: ['Cucumis melo makuwa', 'oriental melon'],
  green_plum: ['Prunus mume fruit', 'ume'], dates: ['date fruit', 'Phoenix dactylifera fruit'], european_pear: ['Pyrus communis fruit'],
  blackberry: ['Rubus fruticosus fruit'], water_spinach: ['Ipomoea aquatica', 'kangkong'], chives: ['Allium tuberosum'],
  basil: ['Ocimum basilicum', 'Thai basil'], cilantro: ['Coriandrum sativum leaves', 'coriander'], bok_choy: ['bok choy', 'pak choi'],
  lettuce: ['lettuce', 'Lactuca sativa'], spinach: ['Spinacia oleracea'], kohlrabi: ['kohlrabi'], radish: ['Raphanus sativus radish'],
  oyster_mushroom: ['Pleurotus ostreatus'], shimeji: ['Hypsizygus tessellatus', 'bunashimeji'], yardlong_bean: ['Vigna unguiculata sesquipedalis'],
  lima_bean: ['Phaseolus lunatus'], shallot: ['shallot'],
  chestnut: ['Castanea fruit', 'chestnuts'], peanut: ['Arachis hypogaea pods', 'peanuts'],
  bird_nest_fern: ['Asplenium nidus', 'pako fern vegetable'], fiddlehead: ['Diplazium esculentum', 'fiddlehead'],
  chayote_shoots: ['chayote shoots', 'Sechium edule shoots', 'Sechium edule leaves', 'chayote tips', '龍鬚菜', '佛手瓜苗'],
  daylily: ['Hemerocallis fulva buds', 'daylily bud', 'Hemerocallis fulva', 'Hemerocallis citrina', '金針花', 'daylily'],
  maitake: ['Grifola frondosa', 'maitake'], red_amaranth: ['Amaranthus tricolor', 'red amaranth'],
  sweet_potato_leaves: ['Ipomoea batatas leaves', 'sweet potato leaves'], gai_lan: ['Brassica oleracea alboglabra', 'kai lan'],
  pea_shoots: ['pea shoots', 'pea tendrils'], leek: ['leek', 'Allium ampeloprasum'],
};
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

// 同時搜尋 3 種蔬果
const todo = [...FRUITS.map((item) => [item, 'fruit']), ...VEGETABLES.map((item) => [item, 'vegetable'])]
  .filter(([item]) => !(index[item.id]?.length >= ENOUGH));
async function searcher() {
  for (let next = todo.shift(); next; next = todo.shift()) {
    const [item, kind] = next;
    const seen = new Map((index[item.id] ?? []).map((h) => [h.title, h]));
    const plain = (n) => n.replace(/^(a|an) /, '');
    const queries = [
      ...item.names.slice(0, 3).map((n) => `${plain(n)} ${kind}`),
      ...(EXTRA_QUERIES[item.id] ?? []),
      plain(item.names[0]), `${plain(item.names[0])} market`,
    ];
    search: for (const q of queries) {
      for (const offset of [0, 30]) {
        for (const hit of await search(q, item.id, offset)) seen.set(hit.title, hit);
        if (seen.size >= PER_CLASS) break search;
      }
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
await Promise.all([searcher(), searcher(), searcher()]);
searching = false;
await Promise.all(workers);
console.log(`done ${done}, failed ${failed}`);
