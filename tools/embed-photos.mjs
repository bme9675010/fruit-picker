// 計算 tools/photos/ 裡每張照片的影像特徵（與 App 相同的 fp16 模型），結果快取在 photos/features.json（其他模型為 features-s1.json 等）。
// 用法：node embed-photos.mjs（較大模型：MODEL=s1 node embed-photos.mjs）
import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AutoProcessor, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers';
import { MODEL_ID, SFX } from './model.mjs';

const dir = new URL('./photos/', import.meta.url);
const exists = (p) => access(p).then(() => true, () => false);
const model = MODEL_ID;
const index = JSON.parse(await readFile(new URL('index.json', dir), 'utf8'));
const featFile = new URL(`features${SFX}.json`, dir);
const feats = (await exists(featFile)) ? JSON.parse(await readFile(featFile, 'utf8')) : {};

const processor = await AutoProcessor.from_pretrained(model);
const vision = await CLIPVisionModelWithProjection.from_pretrained(model, { dtype: 'fp16' });

const embed = async (image) => {
  const { image_embeds } = await vision(await processor(image));
  return Array.from(image_embeds.normalize(2, -1).data, (x) => +x.toFixed(5));
};
// App 只辨識對準框裡的畫面，所以另外算一份「中央 70% 正方形裁切」當訓練資料（key 後面加 #c）
const centerCrop = (image) => {
  const s = Math.round(Math.min(image.width, image.height) * 0.7);
  const x = Math.round((image.width - s) / 2), y = Math.round((image.height - s) / 2);
  return image.crop([x, y, x + s - 1, y + s - 1]);
};

let added = 0, failed = 0;
for (const entry of Object.values(index).flat()) {
  if (feats[entry.file] && feats[`${entry.file}#c`]) continue;
  const path = new URL(entry.file, dir);
  if (!(await exists(path))) continue;
  try {
    const image = await RawImage.read(fileURLToPath(path));
    feats[entry.file] ??= await embed(image);
    feats[`${entry.file}#c`] = await embed(await centerCrop(image));
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
