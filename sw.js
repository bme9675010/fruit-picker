// 離線快取：開過一次之後，市場裡訊號差或沒網路也能用。
// - 網頁本體與辨識資料：先試網路（拿到最新版），連不上或太慢就用快取
// - vendor/（程式庫、ONNX Runtime）與 models/（模型）：檔名或路徑含版本，內容不會變，一律優先用快取
// 主模型的資料先預存；輕量模型的資料也預存，離線時被降級成輕量模式才不會失敗。
// 模型與 wasm 很大（數十 MB），不預存，第一次用到時才存。
const CACHE = 'fruit-picker-v4';
const SHELL = [
  './', 'index.html', 'app.js', 'fruits.js', 'style.css', 'manifest.webmanifest',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
  'vendor/transformers-4.3.1.min.js',
  'embeddings-s1.json', 'refs-s1.bin', 'embeddings.json', 'refs.bin',
  'quality-s1.json', 'quality.json',
];
const NETWORK_TIMEOUT_MS = 4000; // 有快取時，網路超過這個時間就先用快取

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fruit-picker-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/tools/')) return; // 本機開發用的訓練資料，不快取
  if (url.pathname.includes('/vendor/') || url.pathname.includes('/models/')) event.respondWith(cacheFirst(req));
  else event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  if (!cached) return network;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NETWORK_TIMEOUT_MS));
  return Promise.race([network.catch(() => cached), timeout]);
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
