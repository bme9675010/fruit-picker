// 從 app.js / sw.js 取出實際程式碼，在模擬環境裡測試邏輯（不需要瀏覽器）。
// 用法：cd tools && npm test
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/');
const app = await readFile(root + 'app.js', 'utf8');
const grab = (name) => {
  const start = app.indexOf(`function ${name}(`);
  let depth = 0, i = app.indexOf('{', start);
  for (; i < app.length; i++) { if (app[i] === '{') depth++; if (app[i] === '}' && --depth === 0) break; }
  return app.slice(start, i + 1);
};
let ok = 0, fail = 0;
const check = (label, cond, extra = '') => { cond ? ok++ : fail++; console.log(`${cond ? '✓' : '✗'} ${label}${extra ? '：' + extra : ''}`); };

// ---- 1. 教過的畫面：壓縮與還原 ----
const codec = new Function(`${grab('encodeVec')}\n${grab('decodeVec')}\nreturn { encodeVec, decodeVec };`)();
const v = Float32Array.from({ length: 512 }, () => (Math.random() - 0.5) * 0.2);
const n = Math.hypot(...v); for (let i = 0; i < 512; i++) v[i] /= n;
const enc = codec.encodeVec(v), dec = codec.decodeVec(enc);
let cos = 0; for (let i = 0; i < 512; i++) cos += v[i] * dec[i];
check('壓縮後還原，與原向量的相似度 > 0.999', cos > 0.999, cos.toFixed(5));
const oldSize = JSON.stringify(Array.from(v, (x) => +x.toFixed(4))).length;
check('壓縮後體積明顯變小', enc.length < oldSize / 3, `${oldSize} → ${enc.length} 字元`);
check('舊格式（小數陣列）也能讀', codec.decodeVec([0.1, -0.2])[1] === Float32Array.from([-0.2])[0]);

// ---- 1b. 外觀判斷：校準值會讓「腐爛」更保守 ----
const judgeSrc = grab('judgeQuality');
const makeJudge = (bias) => new Function('qualityData', 'LOGIT_SCALE', `${judgeSrc}\nreturn judgeQuality;`)(
  { bias, items: { x: { kind: 'general', states: [{ key: 'fresh', v: [1, 0] }, { key: 'rotten', v: [0, 1] }] } } }, 100);
const img = [0.7, 0.714]; // 介於新鮮與腐爛之間、稍微偏腐爛的畫面
const raw = makeJudge({})('x', img), calibrated = makeJudge({ rotten: 3 })('x', img);
check('機率總和為 1', Math.abs(raw[0] + raw[1] - 1) < 1e-9);
check('沒校準時偏向腐爛、校準後改判新鮮', raw[1] > raw[0] && calibrated[0] > calibrated[1], `腐爛 ${raw[1].toFixed(2)} → ${calibrated[1].toFixed(2)}`);
check('不認識的品項不判斷', makeJudge({})('nope', img) === null);
const rotScore = new Function('qualityData', `${grab('rotScore')}\nreturn rotScore;`);
const rs = rotScore({ rot: { w: [1, 0], b: -0.5, threshold: 2 } });
check('「爛了沒」分數：越像腐爛方向分數越高', rs([0.9, 0.1]) > 2 && rs([0.2, 0.9]) < 2 && rotScore(null)([1, 0]) === null, `${rs([0.9, 0.1]).toFixed(1)} / ${rs([0.2, 0.9]).toFixed(1)}`);

// ---- 2. 清單搜尋 ----
const { FRUITS, VEGETABLES, PROTEINS, GROUPS } = await import(new URL('../fruits.js', import.meta.url));
const mk = (tagName, extra = {}) => ({ tagName, hidden: false, dataset: {}, textContent: '', ...extra });
const children = [['水果', FRUITS], ['蔬菜', VEGETABLES], ['魚、海鮮、肉、蛋、豆製品', PROTEINS]].flatMap(([t, items]) => [mk('H4', { textContent: t }), ...items.map((f) => mk('BUTTON', { value: f.id, dataset: { name: f.name } }))]);
const nodes = { searchEmpty: mk('DIV'), searchTerm: mk('B'), searchWeb: mk('A', { href: '' }) };
const filterList = new Function('els', '$', `${grab('filterList')}\nreturn filterList;`)({ grid: { children } }, (id) => nodes[id]);
const visible = () => children.filter((c) => c.tagName === 'BUTTON' && !c.hidden).map((c) => c.dataset.name);
const heads = () => children.filter((c) => c.tagName === 'H4' && !c.hidden).map((c) => c.textContent);
filterList('芭');
check('搜尋「芭」', visible().join() === '芭樂,香蕉／芭蕉' && heads().join() === '水果', `${visible().join('、')}｜${heads().join('、')}`);
filterList('菇');
check('搜尋「菇」只顯示蔬菜分類', heads().join() === '蔬菜' && visible().length >= 6, visible().join('、'));
filterList('蝦');
check('搜尋「蝦」只顯示生鮮分類', heads().join() === '魚、海鮮、肉、蛋、豆製品' && visible().join() === '白蝦,草蝦／明蝦', visible().join('、'));
filterList('羽衣甘藍');
check('找不到時顯示「上網查」', !nodes.searchEmpty.hidden && visible().length === 0 && heads().length === 0);
check('上網查的連結', nodes.searchWeb.href === 'https://www.google.com/search?q=' + encodeURIComponent('羽衣甘藍 怎麼挑'), decodeURIComponent(nodes.searchWeb.href));
filterList('');
check('清空搜尋恢復全部', visible().length === FRUITS.length + VEGETABLES.length + PROTEINS.length && nodes.searchEmpty.hidden, `${visible().length} 種`);

// ---- 2b. 生鮮資料完整 ----
const allIds = [...FRUITS, ...VEGETABLES, ...PROTEINS].map((f) => f.id);
check('品項 id 不重複', new Set(allIds).size === allIds.length);
check('每個生鮮品項都有大類、檢查清單與外觀重點', PROTEINS.every((f) => GROUPS[f.group] && f.checklist?.length && f.cue && f.kind));

// ---- 2c. 卡片要顯示什麼：一般品項、生鮮大類、二選一 ----
const consts = app.match(/^const (SHOW_AT|DROP_AT|SURE_AT|ASK_MARGIN|ASK_MIN2) = [\d.]+;/gm).join('\n');
const fruitById = Object.fromEntries([...FRUITS, ...VEGETABLES, ...PROTEINS].map((f) => [f.id, f]));
const groupSize = (g) => PROTEINS.filter((f) => f.group === g).length;
const decideView = new Function('fruitById', 'groupSize', `${consts}
${grab('decideView')}
return decideView;`)(fruitById, groupSize);
const R = (pairs) => pairs.map(([id, p]) => ({ id, p }));
let d = decideView(R([['whole_chicken', 0.45], ['chicken_thigh', 0.38], ['chicken_breast', 0.11], ['apple', 0.06]]), null);
check('雞肉不確定時顯示大類', d.kind === 'group' && d.group === 'chicken' && d.members[0].id === 'whole_chicken' && d.shown === null, d.kind);
d = decideView(R([['whole_chicken', 0.8], ['chicken_thigh', 0.1], ['apple', 0.1]]), null);
check('雞肉很確定時直接顯示品項', d.kind === 'fruit' && d.shown === 'whole_chicken');
d = decideView(R([['egg', 0.5], ['apple', 0.1], ['banana', 0.05]]), null);
check('只有一種的大類（雞蛋）不顯示大類', d.kind === 'fruit' && d.shown === 'egg', d.kind);
d = decideView(R([['tilapia', 0.3], ['apple', 0.3], ['milkfish', 0.1]]), null);
check('同類加起來不夠高時不顯示大類', d.kind !== 'group', d.kind);
d = decideView(R([['mango', 0.5], ['papaya', 0.4], ['apple', 0.1]]), null);
check('前兩名接近時二選一', d.kind === 'ask' && d.a === 'mango' && d.b === 'papaya');
d = decideView(R([['papaya', 0.4], ['mango', 0.35], ['apple', 0.25]]), 'mango');
check('目前顯示的還夠高就不換（遲滯）', d.shown === 'mango', d.shown);
d = decideView(R([['pork_belly', 0.4], ['pork_loin', 0.3], ['apple', 0.3]]), 'apple');
check('正在顯示蔬果時不切到生鮮大類', d.kind !== 'group' && d.shown === 'apple', `${d.kind} ${d.shown}`);
d = decideView(R([['apple', 0.2], ['banana', 0.05], ['mango', 0.03]]), null);
check('都不夠高時顯示「找不到」', d.kind === 'search');

// ---- 2d. 產季判斷 ----
const seasonWords = app.match(/^const SEASON_WORDS = .*;$/m)[0];
const inSeason = new Function(`${seasonWords}\n${grab('inSeason')}\nreturn inSeason;`)();
const S = [['5–8 月', 6, true], ['5–8 月', 9, false], ['11–3 月', 1, true], ['11–3 月', 4, false], ['全年', 6, false],
  ['全年（冬季最甜）', 1, true], ['全年（冬季最甜）', 7, false], ['全年（秋冬盛產）', 10, true], ['全年（7–9 月盛產）', 8, true],
  ['6–8 月、11–1 月', 12, true], ['嫩薑 6–9 月、老薑全年', 3, false], ['全年（進口）', 5, false], ['9–12 月（秋蟹最肥）', 10, true]];
const badSeason = S.filter(([t, m, want]) => inSeason(t, m) !== want);
check('產季判斷', !badSeason.length, badSeason.map(([t, m]) => `${t}@${m}月`).join('、'));
const peakNow = [...FRUITS, ...VEGETABLES, ...PROTEINS].filter((f) => inSeason(f.season, 11)).length;
check('11 月有當季品項、但不是全部', peakNow > 10 && peakNow < 100, `${peakNow} 種`);

// ---- 2e. 從文字辨識結果找包裝日期 ----
const findDates = new Function(`${grab('findDates')}\nreturn findDates;`)();
const today = new Date(2026, 10, 28);
const ds = (t) => findDates(t, today).map((d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`).join(',');
check('西元年 2026.11.30', ds('EXP 2026.11.30') === '2026-11-30', ds('EXP 2026.11.30'));
check('民國年 115/12/02 與兩位數年 26-11-25', ds('115/12/02 26-11-25') === '2026-11-25,2026-12-2', ds('115/12/02 26-11-25'));
check('連寫 20261205、忽略不合理的日期與條碼', ds('20261205 4712345678901 2026.13.40 1234') === '2026-12-5', ds('20261205 4712345678901 2026.13.40 1234'));

// ---- 3. Service worker：路由與離線 ----
const sw = await readFile(root + 'sw.js', 'utf8');
const store = new Map(); // key: url（忽略 query）
let online = true, netCalls = [];
const keyOf = (req) => (typeof req === 'string' ? req : req.url).split('?')[0];
const res = (body) => ({ ok: true, body, clone() { return res(body); } });
const cache = {
  match: async (req) => store.get(keyOf(req)),
  put: async (req, r) => { store.set(keyOf(req), r); },
  addAll: async (list) => list.forEach((u) => store.set('https://x.test/app/' + (u === './' ? '' : u), res('pre:' + u))),
};
const handlers = {};
const ctx = {
  self: { addEventListener: (t, f) => (handlers[t] = f), skipWaiting: () => {}, clients: { claim: () => {} } },
  caches: { open: async () => cache, keys: async () => [], delete: async () => {} },
  location: { origin: 'https://x.test' },
  fetch: async (req) => { netCalls.push(keyOf(req)); if (!online) throw new TypeError('offline'); return res('net:' + keyOf(req)); },
  URL, Promise, setTimeout, console,
};
ctx.self.addEventListener = (t, f) => (handlers[t] = f);
vm.runInNewContext(sw.replace(/self\.addEventListener/g, 'self.addEventListener'), { ...ctx, addEventListener: ctx.self.addEventListener });
await new Promise((r) => handlers.install({ waitUntil: (p) => p.then(r) }));
const get = async (path) => {
  let out; handlers.fetch({ request: { method: 'GET', url: 'https://x.test/app/' + path }, respondWith: (p) => (out = p) });
  return out ? (await out).body : '(未攔截)';
};
check('安裝時預存輕量模型資料', store.has('https://x.test/app/embeddings.json') && store.has('https://x.test/app/refs.bin'));
netCalls = [];
const m1 = await get('models/Xenova/mobileclip_s1/onnx/vision_model_fp16.onnx');
const m2 = await get('models/Xenova/mobileclip_s1/onnx/vision_model_fp16.onnx');
check('模型第一次從網路抓、之後用快取', m1.startsWith('net:') && m2 === m1 && netCalls.length === 1, `網路請求 ${netCalls.length} 次`);
online = false;
check('離線時模型仍可從快取取得', (await get('models/Xenova/mobileclip_s1/onnx/vision_model_fp16.onnx')).startsWith('net:'));
check('離線時網頁本體用預存的版本', (await get('index.html')) === 'pre:index.html');
check('離線時輕量模型資料可用', (await get('embeddings.json?x=1')) === 'pre:embeddings.json');
online = true;
check('有網路時網頁本體抓最新版', (await get('app.js')) === 'net:https://x.test/app/app.js');
check('tools/ 不經過快取', (await get('tools/photos/a.jpg')) === '(未攔截)');

console.log(`\n${ok} 項通過，${fail} 項失敗`);
