# 挑水果

用手機鏡頭對準水果或蔬菜，即時辨識是哪一種，並顯示挑選技巧。辨識全部在手機瀏覽器內完成（MobileCLIP-S0 + Transformers.js），不需要付費 API，也不會上傳照片。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html`、`style.css`、`app.js` | 網頁本體 |
| `fruits.js` | 25 種水果、20 種蔬菜的挑選技巧與給 CLIP 比對的英文描述 |
| `embeddings.json` | 事先算好的文字特徵（由 `tools/build-embeddings.mjs` 產生） |
| `tools/eval.mjs` | 用維基百科照片檢查辨識準確度 |

## 本機預覽

```bash
python -m http.server 8765
```

電腦開 http://localhost:8765 即可。手機要開相機，網址必須是 **https**，所以要部署到 GitHub Pages、Cloudflare Pages、Vercel 或 Netlify 這類免費的靜態網站服務（把整個資料夾上傳即可，不需要 `tools/`）。

## 新增或修改蔬果

1. 編輯 `fruits.js`（水果放 `FRUITS`、蔬菜放 `VEGETABLES`；`names` 用英文描述外觀，越具體越好）
2. 重新產生特徵：

   ```bash
   cd tools && npm install && node build-embeddings.mjs
   ```

## 備註

- 這個模型的 q8／uint8 量化版本辨識結果是錯的，所以影像模型改用 fp16（約 23MB，第一次開啟時下載，之後由瀏覽器快取）。
- 認錯時，點候選或用「手動選蔬果」選正確答案，App 會把當下畫面記在這支手機的 localStorage，之後遇到類似畫面會更準。
- 用維基百科／維基共享資源照片測試：水果 22/23、蔬菜 48/60 正確。
- 比較容易混淆的組合：蓮霧、蜜棗、柑橘類；苦瓜和絲瓜；地瓜和馬鈴薯；大番茄和小番茄。香蕉、芒果、鳳梨、青花菜、茄子、洋蔥這類很穩定。
- 葉菜類（菠菜、空心菜等）刻意沒有加入：外觀太相近，辨識不可靠。
