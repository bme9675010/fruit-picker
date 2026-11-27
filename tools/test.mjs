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

// ---- 2. 清單搜尋 ----
const { FRUITS, VEGETABLES, PROTEINS, GROUPS } = await import(new URL('../fruits.js', import.meta.url));
const mk = (tagName, extra = {}) => ({ tagName, hidden: false, dataset: {}, textContent: '', ...extra });
const children = [['水果', FRUITS], ['蔬菜', VEGETABLES], ['魚、海鮮、肉、蛋', PROTEINS]].flatMap(([t, items]) => [mk('H4', { textContent: t }), ...items.map((f) => mk('BUTTON', { value: f.id, dataset: { name: f.name } }))]);
const nodes = { searchEmpty: mk('DIV'), searchTerm: mk('B'), searchWeb: mk('A', { href: '' }) };
const filterList = new Function('els', '$', `${grab('filterList')}\nreturn filterList;`)({ grid: { children } }, (id) => nodes[id]);
const visible = () => children.filter((c) => c.tagName === 'BUTTON' && !c.hidden).map((c) => c.dataset.name);
const heads = () => children.filter((c) => c.tagName === 'H4' && !c.hidden).map((c) => c.textContent);
filterList('芭');
check('搜尋「芭」', visible().join() === '芭樂,香蕉／芭蕉' && heads().join() === '水果', `${visible().join('、')}｜${heads().join('、')}`);
filterList('菇');
check('搜尋「菇」只顯示蔬菜分類', heads().join() === '蔬菜' && visible().length >= 6, visible().join('、'));
filterList('蝦');
check('搜尋「蝦」只顯示生鮮分類', heads().join() === '魚、海鮮、肉、蛋' && visible().join() === '白蝦,草蝦／明蝦', visible().join('、'));
filterList('羽衣甘藍');
check('找不到時顯示「上網查」', !nodes.searchEmpty.hidden && visible().length === 0 && heads().length === 0);
check('上網查的連結', nodes.searchWeb.href === 'https://www.google.com/search?q=' + encodeURIComponent('羽衣甘藍 怎麼挑'), decodeURIComponent(nodes.searchWeb.href));
filterList('');
check('清空搜尋恢復全部', visible().length === FRUITS.length + VEGETABLES.length + PROTEINS.length && nodes.searchEmpty.hidden, `${visible().length} 種`);

// ---- 2b. 生鮮資料完整 ----
const allIds = [...FRUITS, ...VEGETABLES, ...PROTEINS].map((f) => f.id);
check('品項 id 不重複', new Set(allIds).size === allIds.length);
check('每個生鮮品項都有大類、檢查清單與外觀重點', PROTEINS.every((f) => GROUPS[f.group] && f.checklist?.length && f.cue && f.kind));

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
