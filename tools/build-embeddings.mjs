// 事先算好每種水果的 CLIP 文字特徵，手機端就只需要下載影像模型。
// 用法：cd tools && npm install && node build-embeddings.mjs && node train.mjs
import { writeFile } from 'node:fs/promises';
import { AutoTokenizer, CLIPTextModelWithProjection } from '@huggingface/transformers';
import { FRUITS, VEGETABLES, BACKGROUNDS } from '../fruits.js';

const MODEL_ID = 'Xenova/mobileclip_s0';
const templates = (kind) => [
  'a photo of {}.',
  `a photo of {}, a type of ${kind}.`,
  'a close-up photo of {}.',
  `a photo of {} at a ${kind} market.`,
];

const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
const textModel = await CLIPTextModelWithProjection.from_pretrained(MODEL_ID, { dtype: 'fp32' });

async function embed(texts) {
  const inputs = tokenizer(texts, { padding: 'max_length', truncation: true });
  const { text_embeds } = await textModel(inputs);
  return text_embeds.normalize(2, -1).tolist();
}

// 同一類的多個描述取平均再正規化（prompt ensembling）
function meanNormalized(vectors) {
  const out = new Array(vectors[0].length).fill(0);
  for (const v of vectors) v.forEach((x, i) => (out[i] += x));
  const norm = Math.hypot(...out);
  return out.map((x) => +(x / norm).toFixed(5));
}

const classes = [];
for (const [items, kind] of [[FRUITS, 'fruit'], [VEGETABLES, 'vegetable']]) {
  for (const item of items) {
    const texts = item.names.flatMap((n) => templates(kind).map((t) => t.replace('{}', n)));
    classes.push({ id: item.id, embedding: meanNormalized(await embed(texts)) });
  }
}
for (const [i, text] of BACKGROUNDS.entries()) {
  classes.push({ id: `bg_${i}`, embedding: meanNormalized(await embed([text])) });
}

// 中間檔：train.mjs 會再用參考照片調整，產出 App 用的 ../embeddings.json
await writeFile(new URL('./text-embeddings.json', import.meta.url), JSON.stringify({ model: MODEL_ID, classes }));
console.log(`wrote ${classes.length} classes`);
