// 計算 tools/photos/ 裡每張照片的影像特徵（與 App 相同的 fp16 模型），結果快取在 photos/features.json。
// 用法：node embed-photos.mjs
import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';

const dir = new URL('./photos/', import.meta.url);
const exists = (p) => access(p).then(() => true, () => false);
const { model } = JSON.parse(await readFile(new URL('./text-embeddings.json', import.meta.url), 'utf8'));
const index = JSON.parse(await readFile(new URL('index.json', dir), 'utf8'));
const featFile = new URL('features.json', dir);
const feats = (await exists(featFile)) ? JSON.parse(await readFile(featFile, 'utf8')) : {};

const processor = await AutoProcessor.from_pretrained(model);
const vision = await CLIPVisionModelWithProjection.from_pretrained(model, { dtype: 'fp16' });

let added = 0, failed = 0;
for (const entry of Object.values(index).flat()) {
  if (feats[entry.file]) continue;
  const path = new URL(entry.file, dir);
  if (!(await exists(path))) continue;
  try {
    const image = await RawImage.read(fileURLToPath(path));
    const { image_embeds } = await vision(await processor(image));
    feats[entry.file] = Array.from(image_embeds.normalize(2, -1).data, (x) => +x.toFixed(5));
    if (++added % 200 === 0) {
      await writeFile(featFile, JSON.stringify(feats));
      console.log(`embedded ${added}`);
    }
  } catch (err) {
    failed++;
  }
}
await writeFile(featFile, JSON.stringify(feats));
console.log(`total ${Object.keys(feats).length}, added ${added}, failed ${failed}`);
