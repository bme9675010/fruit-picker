// 產生外觀判斷用的文字特徵：每種蔬果的「新鮮／碰傷／腐爛」或「生／熟／過熟／腐爛」。
// 輸出 ../quality{後綴}.json，每個向量以 int8＋base64 存（與 App 的 decodeVec 相同格式）。
// 用法：node build-quality.mjs && MODEL=s1 node build-quality.mjs
import { writeFile } from 'node:fs/promises';
import { AutoTokenizer, CLIPTextModelWithProjection } from '@huggingface/transformers';
import { FRUITS, VEGETABLES, QUALITY } from '../fruits.js';
import { LEAFY } from './photo-rules.mjs';
import { MODEL_ID, SFX } from './model.mjs';

// 葉菜類與包葉類用「萎黃」而不是「碰傷」
const LEAFY_LIKE = new Set([...LEAFY, 'cabbage', 'napa_cabbage', 'red_cabbage']);

// 校準值（由 eval-quality.mjs 實測決定）：「碰傷」「腐爛」分數各減掉 bias，最高狀態機率 ≥ threshold 才顯示。
// 目標是讓新鮮蔬果被誤判成壞掉的比例約 5% 以下。
const CALIBRATION = {
  s1: { bias: { damaged: 4, rotten: 3 }, threshold: 0.6 },
  s0: { bias: { damaged: 4, rotten: 3 }, threshold: 0.6 },
};

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32' });

async function embedMean(texts) {
  const { text_embeds } = await textModel(tokenizer(texts, { padding: 'max_length', truncation: true }));
  const rows = text_embeds.normalize(2, -1).tolist();
  const out = rows[0].map((_, i) => rows.reduce((s, r) => s + r[i], 0));
  const n = Math.hypot(...out);
  return out.map((x) => x / n);
}

function encodeVec(v) {
  const max = Math.max(...v.map(Math.abs));
  const scale = max / 127 || 1;
  const bytes = Buffer.from(Int8Array.from(v, (x) => Math.round(x / scale)).buffer);
  return `${scale.toPrecision(6)}:${bytes.toString('base64')}`;
}

// App 依 kind 找到對應的狀態說明：ripeness → QUALITY.ripeness[id]，其餘 → QUALITY[kind]
const kindOf = (id) => (QUALITY.ripeness[id] ? 'ripeness' : LEAFY_LIKE.has(id) ? 'leafy' : 'general');
const statesFor = (id) => (kindOf(id) === 'ripeness' ? QUALITY.ripeness[id] : QUALITY[kindOf(id)]);

const items = {};
for (const item of [...FRUITS, ...VEGETABLES]) {
  const names = item.names.slice(0, 2).map((n) => n.replace(/^(a|an) /, ''));
  const states = [];
  for (const state of statesFor(item.id)) {
    const texts = names.flatMap((n) => state.prompts.map((p) => `a photo of ${p.replace('{}', n)}.`));
    states.push({ key: state.key, v: encodeVec(await embedMean(texts)) });
  }
  items[item.id] = { kind: kindOf(item.id), states };
}
const cal = CALIBRATION[SFX.replace('-', '') || 's0'];
await writeFile(new URL(`../quality${SFX}.json`, import.meta.url), JSON.stringify({ model: MODEL_ID, ...cal, items }));
console.log(`wrote quality${SFX}.json：${Object.keys(items).length} 種蔬果`);
