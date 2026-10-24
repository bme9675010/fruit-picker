import {
  env,
  AutoProcessor,
  CLIPVisionModelWithProjection,
  RawImage,
} from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
import { FRUITS, TIP_LABELS } from './fruits.js';

env.allowLocalModels = false;

const INTERVAL_MS = 250;     // 兩次辨識之間的間隔
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
const fruitById = Object.fromEntries(FRUITS.map((f) => [f.id, f]));

let processor, vision, classes, textMatrix;
let stream = null;
let paused = false;
let pinned = null;          // 使用者手動選的水果 id，有值時不再自動辨識
let shown = null;           // 目前卡片顯示的水果 id
let ema = null;
let loopTimer = null;
let busy = false;
let lastEmbedding = null;   // 最近一次辨識的影像特徵，手動選水果時用來「教」它
let protos = loadProtos();

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
    processor = await AutoProcessor.from_pretrained(data.model);
    vision = await loadVision(data.model, progress_callback);
    els.loadBar.hidden = true;
    setStatus('辨識中');
  })();
  return modelPromise;
}

// 有 WebGPU 先用 WebGPU，不行就退回 WASM（CPU）。
// 注意：這個模型的 q8 量化版本辨識結果是錯的，所以用 fp16。
async function loadVision(modelId, progress_callback) {
  const warmup = new RawImage(new Uint8ClampedArray(64 * 64 * 3).fill(128), 64, 64, 3);
  if ('gpu' in navigator) {
    try {
      const m = await CLIPVisionModelWithProjection.from_pretrained(modelId, { device: 'webgpu', dtype: 'fp16', progress_callback });
      await m(await processor(warmup));
      return m;
    } catch (err) {
      console.warn('WebGPU 無法使用，改用 WASM', err);
    }
  }
  const m = await CLIPVisionModelWithProjection.from_pretrained(modelId, { device: 'wasm', dtype: 'fp16', progress_callback });
  await m(await processor(warmup));
  return m;
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
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  els.video.srcObject = stream;
  await els.video.play();
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

function scheduleLoop() {
  clearTimeout(loopTimer);
  loopTimer = setTimeout(tick, INTERVAL_MS);
}

async function tick() {
  if (paused || pinned || busy || document.hidden || !vision || els.still.hidden === false) return scheduleLoop();
  busy = true;
  try {
    const image = grabReticle();
    if (image) {
      const probs = await classify(image);
      ema = ema ? ema.map((p, i) => p * (1 - EMA) + probs[i] * EMA) : probs;
      render(ema, true);
    }
  } catch (err) {
    console.error(err);
    setStatus('辨識發生錯誤');
  } finally {
    busy = false;
    scheduleLoop();
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
  els.name.textContent = live ? '把水果放進框框裡' : '認不太出來';
  els.meta.textContent = live ? '對準一種水果、光線充足會更準' : '可以點下方候選，或手動選水果';
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = '小提醒：一次對準一種水果，盡量讓它佔滿框框。認錯的話，點上面的候選或「手動選水果」。';
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
  els.still.src = URL.createObjectURL(file);
  els.still.hidden = false;
  els.pauseBtn.textContent = stream ? '📷 回到相機' : '↩ 返回';
  pinned = null;
  shown = null;
  els.name.textContent = '分析照片中…';
  els.meta.textContent = '';
  try {
    await loadModel();
    await els.still.decode();
    const probs = await classify(await RawImage.read(els.still.src));
    render(probs, false);
    setStatus('照片模式');
  } catch (err) {
    console.error(err);
    els.name.textContent = '照片分析失敗';
    els.meta.textContent = err.message;
  }
}

// ---------- 事件 ----------

els.startBtn.onclick = async () => {
  els.startBtn.disabled = true;
  els.introMsg.textContent = '';
  try {
    await startCamera();
    els.introMsg.textContent = '相機已開啟，正在準備辨識模型…';
    await loadModel();
    els.intro.hidden = true;
    els.sheet.hidden = false;
    document.body.classList.add('live');
    showSearching(true);
    scheduleLoop();
  } catch (err) {
    console.error(err);
    els.startBtn.disabled = false;
    els.introMsg.textContent = err.name === 'NotAllowedError'
      ? '相機權限被拒絕了，請到瀏覽器設定允許相機，或改用「從相簿選照片」。'
      : `無法開始：${err.message}`;
    setStatus('未啟動');
  }
};

for (const input of [$('fileInput'), $('fileInput2')]) {
  input.onchange = () => { analyzeFile(input.files[0]); input.value = ''; };
}

els.pauseBtn.onclick = () => {
  if (!els.still.hidden) return backToCamera();
  setPaused(!paused);
};

els.handle.onclick = () => els.sheet.classList.toggle('collapsed');

els.listBtn.onclick = () => els.dialog.showModal();
els.grid.replaceChildren(...FRUITS.map((f) => {
  const b = document.createElement('button');
  b.value = f.id;
  b.innerHTML = `<span>${f.emoji}</span>${f.name}`;
  return b;
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

document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleLoop(); });

setStatus('準備中');
