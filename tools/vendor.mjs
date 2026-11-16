// 把 Transformers.js 與 ONNX Runtime 的 wasm 複製到網站裡（vendor/），網頁就不用再連 jsDelivr。
// 用法：cd tools && npm install && node vendor.mjs
//       node vendor.mjs --models  另外把模型檔複製到 models/（自己託管模型用；MobileCLIP 權重授權只限研究用途，
//                                 公開散布前請先確認授權，並依條款附上授權文件；見 README「授權與資料來源」）
// （模型檔取自 Transformers.js 在 Node 端的快取；沒有的話先跑一次 build-embeddings / embed-photos）
import { copyFile, mkdir, readFile, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const exists = (p) => access(p).then(() => true, () => false);

const tf = JSON.parse(await readFile(here('./node_modules/@huggingface/transformers/package.json'), 'utf8'));
const ort = JSON.parse(await readFile(here('./node_modules/onnxruntime-web/package.json'), 'utf8'));

const files = [
  [`./node_modules/@huggingface/transformers/dist/transformers.min.js`, `../vendor/transformers-${tf.version}.min.js`],
  // asyncify 是預設版本；Safari 26 以下又沒有 WebGPU 時用一般版本（與 Transformers.js 的判斷相同）
  ...['.asyncify', ''].flatMap((variant) => ['mjs', 'wasm'].map((ext) => [
    `./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded${variant}.${ext}`,
    `../vendor/ort-${ort.version}/ort-wasm-simd-threaded${variant}.${ext}`,
  ])),
  // 主模型（S1）與輕量模型（S0）的影像模型，只需要 fp16 版本（加上 --models 才複製）
  ...(process.argv.includes('--models') ? ['mobileclip_s1', 'mobileclip_s0'] : []).flatMap((m) => ['config.json', 'preprocessor_config.json', 'onnx/vision_model_fp16.onnx'].map((f) => [
    `./node_modules/@huggingface/transformers/.cache/Xenova/${m}/${f}`,
    `../models/Xenova/${m}/${f}`,
  ])),
];

for (const [from, to] of files) {
  if (!(await exists(here(from)))) throw new Error(`找不到 ${from}`);
  await mkdir(dirname(here(to)), { recursive: true });
  await copyFile(here(from), here(to));
  console.log(to.replace('../', ''));
}
console.log(`\nTransformers.js ${tf.version}／ONNX Runtime ${ort.version}`);
