// 選用的 MobileCLIP 模型：預設 s0；用環境變數 MODEL=s1 改用較大的 s1。
// s0 的檔案沒有後綴（text-embeddings.json），其他模型加上 -s1 之類的後綴。
const MODELS = { s0: 'Xenova/mobileclip_s0', s1: 'Xenova/mobileclip_s1', s2: 'Xenova/mobileclip_s2' };
export const MODEL = process.env.MODEL ?? 's0';
if (!MODELS[MODEL]) throw new Error(`未知的 MODEL：${MODEL}（可用：${Object.keys(MODELS).join(', ')}）`);
export const MODEL_ID = MODELS[MODEL];
export const SFX = MODEL === 's0' ? '' : `-${MODEL}`;
