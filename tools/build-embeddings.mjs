// 事先算好每種水果的 CLIP 文字特徵，手機端就只需要下載影像模型。
// 用法：cd tools && npm install && node build-embeddings.mjs
import { writeFile } from 'node:fs/promises';
import { AutoTokenizer, CLIPTextModelWithProjection } from '@huggingface/transformers';
import { FRUITS, BACKGROUNDS } from '../fruits.js';

const MODEL_ID = 'Xenova/mobileclip_s0';
const TEMPLATES = [
  'a photo of {}.',
  'a photo of {}, a type of fruit.',
  'a close-up photo of {}.',
  'a photo of {} at a fruit market.',
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
for (const fruit of FRUITS) {
  const texts = fruit.names.flatMap((n) => TEMPLATES.map((t) => t.replace('{}', n)));
  classes.push({ id: fruit.id, embedding: meanNormalized(await embed(texts)) });
}
for (const [i, text] of BACKGROUNDS.entries()) {
  classes.push({ id: `bg_${i}`, embedding: meanNormalized(await embed([text])) });
}

await writeFile(new URL('../embeddings.json', import.meta.url), JSON.stringify({ model: MODEL_ID, classes }));
console.log(`wrote ${classes.length} classes`);
