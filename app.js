import {
  env,
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
import { FRUITS, VEGETABLES, TIP_LABELS } from './fruits.js';

env.allowLocalModels = false;

const FAST_MS = 300;         // 還在找蔬果時，兩次辨識之間的間隔
const SLOW_MS = 1200;        // 結果穩定後放慢，減少手機發熱與耗電
const STABLE_TICKS = 4;      // 連續幾次都是同一種就算穩定
// sessionStorage：網頁被手機瀏覽器關掉重開時，用來自動恢復相機
const LIVE_KEY = 'fp-live';
const CLEAN_KEY = 'fp-clean';
const CPU_KEY = 'fp-cpu';
const EMA = 0.45;            // 新結果的權重，越小畫面越穩定
const SHOW_AT = 0.45;        // 機率超過這個值才顯示為辨識結果
const DROP_AT = 0.25;        // 目前顯示的水果低於這個值才換掉
const LOGIT_SCALE = 100;
// 使用者教過的畫面（手動選水果時記下的影像特徵），用 Tip-Adapter 的方式加分
const PROTO_KEY = 'fruit-protos-v1';
const PROTO_MAX = 15;        // 每種水果最多記幾張
const PROTO_ALPHA = 10;
const PROTO_BETA = 5.5;

const $ = (id) => document.getElementById(id);
const els = {
  video: $('cam'), still: $('still'), reticle: $('reticle'), grab: $('grab'),
  status: $('status'), intro: $('intro'), startBtn: $('startBtn'), introMsg: $('introMsg'),
  loadBar: $('loadBar'), sheet: $('sheet'), handle: $('sheetHandle'),
  emoji: $('fruitEmoji'), name: $('fruitName'), meta: $('fruitMeta'),
  chips: $('candidates'), tips: $('tips'), pauseBtn: $('pauseBtn'),
  listBtn: $('listBtn'), dialog: $('listDialog'), grid: $('fruitGrid'),
};
const fruitById = Object.fromEntries([...FRUITS, ...VEGETABLES].map((f) => [f.id, f]));

let processor, vision, classes, textMatrix, modelId;
let stream = null;
let paused = false;
let pinned = null;          // 使用者手動選的水果 id，有值時不再自動辨識
let shown = null;           // 目前卡片顯示的水果 id
let ema = null;
let loopTimer = null;
let busy = false;
let lastEmbedding = null;   // 最近一次辨識的影像特徵，手動選水果時用來「教」它
let protos = loadProtos();
let photoRequest = 0;       // 照片模式的請求編號，用來丟掉過期的結果
let stableTicks = 0;
let errorTicks = 0;
let device = null;          // 'webgpu' 或 'wasm'

function session(key, value) {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    return null;
  }
}

function loadProtos() {
  try {
    return JSON.parse(localStorage.getItem(PROTO_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveProtos() {
  try {
    localStorage.setItem(PROTO_KEY, JSON.stringify(protos));
  } catch (err) {
    console.warn('無法儲存教過的資料', err);
  }
}

function learn(id) {
  if (!lastEmbedding) return false;
  const list = (protos[id] ??= []);
  list.push(Array.from(lastEmbedding, (x) => +x.toFixed(4)));
  if (list.length > PROTO_MAX) list.shift();
  saveProtos();
  return true;
}

// ---------- 模型 ----------

let modelPromise = null;
function loadModel() {
  modelPromise ??= (async () => {
    setStatus('下載模型中…');
    els.loadBar.hidden = false;
    const data = await fetch('embeddings.json').then((r) => r.json());
    classes = data.classes.map((c) => c.id);
    textMatrix = data.classes.map((c) => Float32Array.from(c.embedding));

    const progress_callback = (p) => {
      if (p.status === 'progress' && p.file?.endsWith('.onnx')) {
        els.loadBar.firstElementChild.style.width = `${p.progress.toFixed(0)}%`;
        setStatus(`下載模型 ${p.progress.toFixed(0)}%`);
      }
    };
    modelId = data.model;
    processor = await AutoProcessor.from_pretrained(modelId);
    vision = await loadVision(modelId, progress_callback);
    els.loadBar.hidden = true;
    setStatus('辨識中');
  })();
  return modelPromise;
}

// 有 WebGPU 先用 WebGPU，不行就退回 WASM（CPU）。
// 如果之前用 WebGPU 時網頁異常結束，這次直接用 WASM（較省記憶體）。
// 注意：這個模型的 q8 量化版本辨識結果是錯的，所以用 fp16。
async function loadVision(modelId, progress_callback) {
  const warmup = new RawImage(new Uint8ClampedArray(64 * 64 * 3).fill(128), 64, 64, 3);
  if ('gpu' in navigator && !session(CPU_KEY)) {
    try {
      const m = await CLIPVisionModelWithProjection.from_pretrained(modelId, { device: 'webgpu', dtype: 'fp16', progress_callback });
      await m(await processor(warmup));
      device = 'webgpu';
      return m;
    } catch (err) {
      console.warn('WebGPU 無法使用，改用 WASM', err);
    }
  }
  const m = await CLIPVisionModelWithProjection.from_pretrained(modelId, { device: 'wasm', dtype: 'fp16', progress_callback });
  await m(await processor(warmup));
  device = 'wasm';
  return m;
}

// WebGPU 連續出錯（例如 GPU 被系統回收）時，改用 WASM 重新載入
async function fallbackToCpu() {
  session(CPU_KEY, '1');
  setStatus('切換到 CPU 模式…');
  const old = vision;
  vision = null;
  await old?.dispose?.().catch(() => {});
  vision = await loadVision(modelId);
  setStatus('辨識中');
}

async function classify(image) {
  const { image_embeds } = await vision(await processor(image));
  const v = image_embeds.normalize(2, -1).data;
  lastEmbedding = v;
  const dot = (a) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * v[i];
    return s;
  };
  const logits = textMatrix.map((t, c) => {
    let boost = 0;
    for (const p of protos[classes[c]] ?? []) boost = Math.max(boost, Math.exp(-PROTO_BETA * (1 - dot(p))));
    return dot(t) * LOGIT_SCALE + PROTO_ALPHA * boost;
  });
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

// ---------- 相機 ----------

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(window.isSecureContext ? '這個瀏覽器不支援相機' : '需要用 https 網址開啟才能使用相機');
  }
  stream?.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  els.video.srcObject = stream;
  await els.video.play();
  session(LIVE_KEY, '1');
}

// 切到別的 App 再回來時，相機可能已被系統停掉，自動重開
async function ensureCamera() {
  if (!stream || document.hidden) return;
  const track = stream.getVideoTracks()[0];
  if (track?.readyState === 'live' && !track.muted && (paused || !els.video.paused)) return;
  try {
    await startCamera();
    if (paused) els.video.pause();
  } catch (err) {
    console.error(err);
    setStatus('相機中斷，請重新整理');
  }
}

// 只裁切對準框裡的畫面送去辨識（影片是 object-fit: cover，要換算座標）
function grabReticle() {
  const v = els.video;
  const vw = v.videoWidth, vh = v.videoHeight;
  if (!vw || !vh) return null;
  const box = v.getBoundingClientRect();
  const r = els.reticle.getBoundingClientRect();
  const scale = Math.max(box.width / vw, box.height / vh);
  const offX = (box.width - vw * scale) / 2 + box.left;
  const offY = (box.height - vh * scale) / 2 + box.top;
  const sx = (r.left - offX) / scale, sy = (r.top - offY) / scale;
  const size = r.width / scale;
  const ctx = els.grab.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(v, sx, sy, size, size, 0, 0, els.grab.width, els.grab.height);
  return RawImage.fromCanvas(els.grab);
}

function scheduleLoop(delay = FAST_MS) {
  clearTimeout(loopTimer);
  loopTimer = setTimeout(tick, delay);
}

async function tick() {
  if (paused || pinned || busy || document.hidden || !vision || els.still.hidden === false) return scheduleLoop();
  busy = true;
  try {
    const image = grabReticle();
    if (image) {
      const before = shown;
      const probs = await classify(image);
      ema = ema ? ema.map((p, i) => p * (1 - EMA) + probs[i] * EMA) : probs;
      render(ema, true);
      stableTicks = shown && shown === before ? stableTicks + 1 : 0;
      errorTicks = 0;
    }
  } catch (err) {
    console.error(err);
    setStatus('辨識發生錯誤');
    if (++errorTicks >= 3 && device === 'webgpu') {
      errorTicks = 0;
      await fallbackToCpu().catch((e) => console.error(e));
    }
  } finally {
    busy = false;
    scheduleLoop(stableTicks >= STABLE_TICKS ? SLOW_MS : FAST_MS);
  }
}

// ---------- 畫面 ----------

function setStatus(text) { els.status.textContent = text; }

function rankFruits(probs) {
  return classes
    .map((id, i) => ({ id, p: probs[i] }))
    .filter((c) => fruitById[c.id])
    .sort((a, b) => b.p - a.p);
}

function render(probs, live) {
  const ranked = rankFruits(probs);
  const prob = Object.fromEntries(ranked.map((c) => [c.id, c.p]));
  const top = ranked[0];

  // 遲滯：目前顯示的水果還夠高就不換，避免畫面跳來跳去
  if (shown && prob[shown] >= DROP_AT && !(top.id !== shown && top.p >= SHOW_AT && top.p > prob[shown] + 0.15)) {
    // 保持不變
  } else if (top.p >= SHOW_AT) {
    shown = top.id;
  } else {
    shown = null;
  }

  document.body.classList.toggle('found', !!shown);
  if (shown) {
    showFruit(shown, `${live ? '即時辨識' : '照片辨識'}・信心 <b>${Math.round(prob[shown] * 100)}%</b>`);
  } else {
    showSearching(live);
  }
  renderChips(ranked.filter((c) => c.p >= 0.05).slice(0, 4));
}

let tipsFor = null;
function showFruit(id, metaHtml) {
  const f = fruitById[id];
  els.emoji.textContent = f.emoji;
  els.name.textContent = f.name;
  els.meta.innerHTML = `${metaHtml}・產季 ${f.season}`;
  if (tipsFor === id) return;
  tipsFor = id;
  els.tips.replaceChildren(
    ...Object.entries(TIP_LABELS)
      .filter(([key]) => f.tips[key]?.length)
      .map(([key, label]) => {
        const group = document.createElement('div');
        group.className = `tip-group ${key}`;
        const h = document.createElement('h4');
        h.textContent = label;
        const ul = document.createElement('ul');
        for (const t of f.tips[key]) {
          const li = document.createElement('li');
          li.textContent = t;
          ul.append(li);
        }
        group.append(h, ul);
        return group;
      }),
  );
}

function showSearching(live) {
  tipsFor = null;
  els.emoji.textContent = '🔍';
  els.name.textContent = live ? '把蔬果放進框框裡' : '認不太出來';
  els.meta.textContent = live ? '對準一種蔬果、光線充足會更準' : '可以點下方候選，或手動選蔬果';
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = '小提醒：一次對準一種蔬果，盡量讓它佔滿框框。認錯的話，點上面的候選或「手動選蔬果」。';
  els.tips.replaceChildren(p);
}

function renderChips(cands) {
  const chips = cands.map((c) => {
    const b = document.createElement('button');
    b.className = 'chip' + (c.id === shown ? ' active' : '');
    b.textContent = `${fruitById[c.id].emoji} ${fruitById[c.id].name} ${Math.round(c.p * 100)}%`;
    b.onclick = () => pin(c.id);
    return b;
  });
  els.chips.replaceChildren(...chips);
}

function pin(id) {
  pinned = id;
  shown = id;
  document.body.classList.add('found');
  showFruit(id, learn(id) ? '手動選擇・已記住這個畫面，下次會更準' : '手動選擇');
  const back = document.createElement('button');
  back.className = 'chip';
  back.textContent = '↺ 重新辨識';
  back.onclick = unpin;
  els.chips.replaceChildren(back);
  els.sheet.classList.remove('collapsed');
}

function unpin() {
  pinned = null;
  shown = null;
  ema = null;
  if (!els.still.hidden) return backToCamera();
  showSearching(true);
  els.chips.replaceChildren();
  scheduleLoop();
}

function setPaused(value) {
  paused = value;
  els.pauseBtn.textContent = paused ? '▶ 繼續' : '⏸ 暫停';
  if (paused) els.video.pause(); else els.video.play();
  setStatus(paused ? '已暫停' : '辨識中');
}

function backToCamera() {
  photoRequest++;
  els.still.hidden = true;
  URL.revokeObjectURL(els.still.src);
  pinned = null;
  shown = null;
  ema = null;
  document.body.classList.toggle('live', !!stream);
  if (!stream) {
    els.sheet.hidden = true;
    els.intro.hidden = false;
    return;
  }
  setPaused(false);
  showSearching(true);
  els.chips.replaceChildren();
  scheduleLoop();
}

async function analyzeFile(file) {
  if (!file) return;
  els.intro.hidden = true;
  els.sheet.hidden = false;
  document.body.classList.remove('live');
  // 連續選照片時，只採用最後一張的結果
  const req = ++photoRequest;
  const url = URL.createObjectURL(file);
  if (els.still.src) URL.revokeObjectURL(els.still.src);
  els.still.src = url;
  els.still.hidden = false;
  els.pauseBtn.textContent = stream ? '📷 回到相機' : '↩ 返回';
  pinned = null;
  shown = null;
  els.name.textContent = '分析照片中…';
  els.meta.textContent = '';
  try {
    await loadModel();
    if (req !== photoRequest) return;
    const probs = await classify(await RawImage.read(url));
    if (req !== photoRequest) return;
    render(probs, false);
    setStatus('照片模式');
  } catch (err) {
    if (req !== photoRequest) return;
    console.error(err);
    els.name.textContent = '照片分析失敗';
    els.meta.textContent = err.message;
  }
}

// ---------- 事件 ----------

// resumed：網頁被瀏覽器強制關掉後重開，自動恢復
async function startLive(resumed = false) {
  els.startBtn.disabled = true;
  els.introMsg.textContent = resumed ? '正在恢復相機…' : '';
  try {
    await startCamera();
    els.introMsg.textContent = '相機已開啟，正在準備辨識模型…';
    await loadModel();
    els.intro.hidden = true;
    els.sheet.hidden = false;
    document.body.classList.add('live');
    showSearching(true);
    if (resumed) els.meta.textContent = '剛剛被瀏覽器中斷，已自動恢復';
    scheduleLoop();
  } catch (err) {
    console.error(err);
    session(LIVE_KEY, null);
    els.startBtn.disabled = false;
    els.introMsg.textContent = err.name === 'NotAllowedError'
      ? (resumed ? '請按「開啟相機」繼續。' : '相機權限被拒絕了，請到瀏覽器設定允許相機，或改用「從相簿選照片」。')
      : `無法開始：${err.message}`;
    setStatus('未啟動');
  }
}

els.startBtn.onclick = () => startLive();

for (const input of [$('fileInput'), $('fileInput2')]) {
  input.onchange = () => { analyzeFile(input.files[0]); input.value = ''; };
}

els.pauseBtn.onclick = () => {
  if (!els.still.hidden) return backToCamera();
  setPaused(!paused);
};

els.handle.onclick = () => els.sheet.classList.toggle('collapsed');

els.listBtn.onclick = () => els.dialog.showModal();
els.grid.replaceChildren(...[['水果', FRUITS], ['蔬菜', VEGETABLES]].flatMap(([title, items]) => {
  const h = document.createElement('h4');
  h.textContent = title;
  return [h, ...items.map((f) => {
    const b = document.createElement('button');
    b.value = f.id;
    b.innerHTML = `<span>${f.emoji}</span>${f.name}`;
    return b;
  })];
}));
els.dialog.addEventListener('close', () => {
  const value = els.dialog.returnValue;
  if (fruitById[value]) pin(value);
  if (value === 'reset' && confirm('要清除所有教過的畫面嗎？')) {
    protos = {};
    saveProtos();
  }
  els.dialog.returnValue = '';
});

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  await ensureCamera();
  scheduleLoop();
});

// 正常離開（重新整理、關閉分頁）會觸發 pagehide；被手機瀏覽器強制關掉則不會。
addEventListener('pagehide', () => session(CLEAN_KEY, '1'));
addEventListener('pageshow', () => session(CLEAN_KEY, null));

setStatus('準備中');

// 上次相機還開著就自動恢復；若是異常結束（多半是記憶體不足），改用較省資源的 CPU 模式
if (session(LIVE_KEY)) {
  const crashed = !session(CLEAN_KEY);
  if (crashed) session(CPU_KEY, '1');
  session(CLEAN_KEY, null);
  startLive(crashed);
}
