// 用維基百科的水果照片快速檢查辨識準確度。
// 用法：node eval.mjs
import { readFile } from 'node:fs/promises';
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';

const WIKI_TITLES = {
  mango: 'Mango', guava: 'Common_guava', wax_apple: 'Syzygium_samarangense', sugar_apple: 'Annona_squamosa',
  dragon_fruit: 'Pitaya', papaya: 'Papaya', banana: 'Banana', pineapple: 'Pineapple', watermelon: 'Watermelon',
  lychee: 'Lychee', longan: 'Longan', grape: 'Grape', strawberry: 'Strawberry', apple: 'Apple', citrus: 'Orange_(fruit)',
  pomelo: 'Pomelo', persimmon: 'Persimmon', starfruit: 'Carambola', passion_fruit: 'Passiflora_edulis', kiwi: 'Kiwifruit',
  avocado: 'Avocado', jujube: 'Ziziphus_mauritiana', pear: 'Pyrus_pyrifolia', melon: 'Cantaloupe', cherry_tomato: 'Cherry_tomato',
};

const { model, classes } = JSON.parse(await readFile(new URL('../embeddings.json', import.meta.url), 'utf8'));
const processor = await AutoProcessor.from_pretrained(model);
const vision = await CLIPVisionModelWithProjection.from_pretrained(model, { dtype: 'fp16' });

// 一次查完所有條目的代表圖，避免被維基百科 API 限流
const titles = Object.values(WIKI_TITLES).join('|');
const api = `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&pithumbsize=400&format=json&redirects=1&titles=${encodeURIComponent(titles)}`;
const res = await fetch(api, { headers: { 'User-Agent': 'fruit-picker-eval/0.1' } }).then((r) => r.json());
const alias = {};
for (const { from, to } of [...(res.query.normalized ?? []), ...(res.query.redirects ?? [])]) alias[from] = to;
const thumbs = Object.fromEntries(Object.values(res.query.pages).map((p) => [p.title, p.thumbnail?.source]));
const resolve = (t) => { let x = t.replace(/_/g, ' '); while (alias[x]) x = alias[x]; return thumbs[x]; };

let correct = 0;
for (const [id, title] of Object.entries(WIKI_TITLES)) {
  const url = resolve(title);
  if (!url) { console.log(`${id}: no image`); continue; }
  await new Promise((r) => setTimeout(r, 500));
  const image = await RawImage.read(url);
  const { image_embeds } = await vision(await processor(image));
  const v = image_embeds.normalize(2, -1).tolist()[0];
  const logits = classes.map((c) => 100 * c.embedding.reduce((s, x, i) => s + x * v[i], 0));
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b);
  const ranked = classes.map((c, i) => [c.id, exps[i] / sum]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (ranked[0][0] === id) correct++;
  console.log(`${ranked[0][0] === id ? '✓' : '✗'} ${id.padEnd(14)} → ${ranked.map(([c, p]) => `${c} ${(p * 100).toFixed(0)}%`).join(', ')}`);
}
console.log(`top-1: ${correct}/${Object.keys(WIKI_TITLES).length}`);
