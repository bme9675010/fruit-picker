# 挑食材（原「挑水果」）

用手機鏡頭對準水果、蔬菜、魚、海鮮、肉或蛋，即時辨識是哪一種，並顯示挑選技巧。辨識全部在手機瀏覽器內完成（MobileCLIP + Transformers.js），不需要付費 API，也不會上傳照片。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html`、`style.css`、`app.js` | 網頁本體 |
| `fruits.js` | 52 種水果、69 種蔬菜、25 種魚肉蛋豆製品（`PROTEINS`，另有大類 `GROUPS` 與檢查清單 `checklist`）的挑選技巧與給 CLIP 比對的英文描述 |
| `embeddings-s1.json`、`refs-s1.bin` | 主模型（MobileCLIP-S1）的分類向量與參考樣本（約 4,400 張真實照片的影像特徵，int8 約 2.3MB） |
| `embeddings.json`、`refs.bin` | 輕量備援模型（MobileCLIP-S0）的同類檔案，網頁曾被瀏覽器強制關掉時改用 |
| `quality-s1.json`、`quality.json` | 外觀判斷（新鮮／碰傷／腐爛、生／熟）用的文字特徵與校準值（由 `tools/build-quality.mjs` 產生），以及「爛了沒」影像分類器（`tools/rot-detector.mjs`） |
| `sw.js` | 離線快取（開過一次之後，沒網路也能用） |
| `vendor/` | Transformers.js 與 ONNX Runtime 的 wasm，以及讀包裝日期用的 Tesseract.js 與英數字辨識資料（由 `tools/vendor.mjs` 複製，不依賴外部 CDN） |
| `icon-*.png`、`apple-touch-icon.png` | 主畫面圖示（由 `tools/make-icons.py` 產生） |
| `tools/` | 產生上述檔案的腳本（見下方「新增或修改蔬果」） |

## 本機預覽

```bash
python tools/serve.py
```

電腦開 http://localhost:5500 即可（這個伺服器關閉了快取，改完程式重新整理就會生效）。網址加上 `?debug=1`（例如 `https://bme9675010.github.io/fruit-picker/?debug=1`）會在畫面上顯示模型、GPU／CPU、每次辨識的耗時與記憶體，點一下可以複製，方便回報手機上的狀況。手機要開相機，網址必須是 **https**，所以要部署到 GitHub Pages、Cloudflare Pages、Vercel 或 Netlify 這類免費的靜態網站服務（把整個資料夾上傳即可，不需要 `tools/`）。

## 新增或修改蔬果

1. 編輯 `fruits.js`（水果放 `FRUITS`、蔬菜放 `VEGETABLES`、魚肉蛋放 `PROTEINS`（要填 `group`、`kind`、`checklist`）；`names` 用英文描述外觀，越具體越好；`cue` 是二選一時顯示的外觀重點）
2. 在 `tools/` 依序執行（兩個模型都要做；`MODEL=s1` 是主模型）：

   ```bash
   npm install
   node build-embeddings.mjs && MODEL=s1 node build-embeddings.mjs   # 文字特徵
   node collect-photos.mjs                                           # 從維基共享資源下載照片到 tools/photos/（不進 git）
   node embed-photos.mjs && MODEL=s1 node embed-photos.mjs           # 照片的影像特徵（原圖＋中央裁切）
   MODEL=s1 node train.mjs --write                                   # 主模型：原有品項比線上版本準才寫入
   node train.mjs --quick --write --force                            # 輕量備援模型：跟主模型同一份品項
   node build-quality.mjs && MODEL=s1 node build-quality.mjs         # 外觀判斷的文字特徵
   node rot-detector.mjs --write && MODEL=s1 node rot-detector.mjs --write   # 「爛了沒」影像分類器（要在 build-quality 之後）
   node vendor.mjs                                                   # 更新 Transformers.js 版本後才需要：重新複製程式庫
   npm test                                                          # 邏輯測試（搜尋、壓縮、離線快取、外觀判斷、大類／二選一、產季、日期解析）
   ```

   使用者從 App 匯出的「教過的畫面」（`fruit-picker-taught-*.json`）放進 `tools/taught/`，`train.mjs` 會自動加進訓練集（只限同一個模型匯出的檔案）。

   `train.mjs` 會印出每個新品項在測試集的準確度，以及它從原有品項「搶走」了幾張原本認對的照片。準確度太低（約 55% 以下）的建議從 `fruits.js` 拿掉；跟現有品項挑法相近又常互搶的（例如紫洋蔥和洋蔥），可以在 `tools/photo-rules.mjs` 的 `MERGED` 合併。

## 備註

- 主模型是 MobileCLIP-S1（fp16 約 43MB）。輕量版 S0 約 23MB。第一次開啟時從 Hugging Face 下載，之後由瀏覽器快取；程式庫與 ONNX Runtime 則從本網站的 `vendor/` 載入，由 `sw.js` 快取。兩者的 q8／uint8 量化版本辨識結果都不可靠，所以用 fp16。
- 認錯時點候選或二選一，App 會把當下畫面記在這支手機的 localStorage（依模型分開存），之後遇到類似畫面會更準。從「手動選擇」清單選的話，要再按「記住這個畫面」才會記。
- 準確度：維基共享資源約 9,600 張照片，依檔名固定分成訓練 50%／驗證 20%／測試 30%；訓練時另加每張照片的中央 70% 裁切（模擬 App 對準框）。哪些照片有效、怎麼分組一律由 S0 判斷，所以不同模型是在同一批照片上比較。
  - 原有 107 種（1,636 張測試照片）：前一版（S0）75.1% → 目前（S1）**79.0%**，多角度辨識 **79.5%**；正確答案在前兩名 86.7% → **88.6%**。
  - 第二批新增的 10 種：130/158（82%）。
  - 第三批新增 4 種（猴頭菇、茼蒿、瓠瓜、蓮子），紫洋蔥併入洋蔥、芭蕉併入香蕉：原有 117 種的測試準確度 79.3% → 79.0%（在誤差範圍內），前兩名 88.7% → 89.1%。
  - 另外評估過更大的 MobileCLIP-S2（fp16 約 72MB）：全部品項約 80.0%，比 S1 多 1.5% 左右，但下載量和運算量都大很多，目前沒有採用。
- 多角度辨識：即時模式輪流看「整個對準框」與「框中央 70%」，由平滑機制合併；照片模式兩種都算再平均特徵。
- 前兩名分數接近（差距 < 0.3）時改成讓使用者二選一：測試集上約 15% 的照片會詢問，「直接給錯答案」約 12%。
- 測試照片和訓練照片同樣來自維基共享資源，實際用手機鏡頭拍的提升幅度可能會小一些。
- 比較容易混淆的組合：檸檬和金桔；藍莓、黑莓和桑椹；蜜棗和青梅；大白菜、青江菜和萵苣；苦瓜和絲瓜；地瓜和馬鈴薯；芋頭和山藥；大番茄和小番茄。香蕉、芒果、鳳梨、青花菜、茄子、洋蔥這類很穩定。
- 「非蔬果」類別加上煮好的菜（一盤菜、便當、湯麵、炸物…）：鏡頭對準非食材時正確說「認不出來」的比例 43% → 70%（輕量模型 44% → 72%），原有 139 種的準確度沒有下降（79.1% → 79.7%）。
- 較弱的 17 種（全雞、虱目魚、雞胸肉、牛肉、透抽、秋刀魚、山藥、芋頭、苦瓜、柚子、葡萄柚、大白菜、高麗菜、紅石榴、木瓜、金桔、檸檬）各多收集一倍照片：芋頭 12→18/22、高麗菜 13→19/25、木瓜 24→28/35 進步明顯；雞胸肉（3/9）、山藥（4/11）、葡萄柚（8/17）仍偏弱。
- 測試後沒有加入：菠菜（7/15）、韭菜（6/12，還會讓青蔥被認錯）、芥藍（2/12）、豌豆苗（1/4）、大黃瓜（2/10）、小白菜（3/9）、油桃（7/14）、豌豆仁（4/8）、韭黃（沒有可用的測試照片）。
- 評估過但沒採用的做法：易混淆組合的專門判別器（測試集反而變差）。
- 手機瀏覽器可能因記憶體不足或切到背景而關掉網頁。App 會自動重新開啟相機；只有在使用中被強制關掉（不是切到背景）才會改用輕量模型與 CPU 模式（狀態列顯示「辨識中・輕量 ⇄」，點一下可以改回完整模式）。辨識結果穩定後也會自動降低辨識頻率，減少發熱。
- 模型下載失敗時可以按「開啟相機」重試；照片模式會先把照片縮小到長邊 1024 像素再辨識，避免佔用大量記憶體。
- 「手動選擇」清單可以搜尋；清單裡沒有的，搜尋結果會提供「上網查怎麼挑」。勾「只看現在當季」只顯示這個月盛產的品項（依 `season` 文字判斷，例如「11–3 月」「全年（冬季最甜）」），當季的品項名稱旁也會標「當季」。
- 🔊 語音：用手機瀏覽器內建的語音朗讀（不用付費），唸出品項、外觀判斷與挑選重點；生鮮唸「買之前檢查」清單。
- 📅 讀包裝日期（生鮮品項的檢查清單下方）：用 Tesseract.js 在手機上辨識框框裡的英數字（第一次使用下載約 7MB），找出 2026.11.30、115/11/30（民國年）、20261130 這類日期，以最晚的日期當有效期限，顯示「還有幾天／已過期」。只認數字、不認中文，所以分不出哪個是製造日期；數字也可能讀錯，會提醒再用眼睛確認。
- 外觀判斷：辨識出品項後，從畫面推測「新鮮／可能有碰傷／腐爛」（葉菜是「新鮮／萎黃／腐爛」），會變色的 7 種（香蕉、芒果、木瓜、大番茄、小番茄、草莓、鳳梨）另外判斷「還沒熟／剛好／熟過頭」。用 `tools/eval-quality.mjs` 以維基共享資源上標示狀態的照片實測並校準：
  - 腐爛另外用「爛了沒」影像分類器判斷（`tools/rot-detector.mjs`：約 470 張腐爛、發霉蔬果照片對比一萬張新鮮照片訓練）。只換文字描述沒有改善（同樣約 5% 誤報時腐爛抓到 28/65 vs 29/65），改用影像分類器後，在沒看過的測試照片上，新鮮誤報 3% 時能抓到 86/146 張腐爛（59%）。
  - 文字判斷與影像分類器合計：新鮮照片被誤判成碰傷／腐爛約 4.7%；品項標示的腐爛測試照片抓到 11/19（58%，原本只用文字約 45%）；熟度在有顯示時約 70% 正確。
  - 認不出品項（例如爛到看不出是什麼）時也會用影像分類器判斷，但門檻提高，避免對著桌子、牆壁誤報：非蔬果照片誤報 2.8% → 1.0%，腐爛照片仍抓到約 37%。
  - 最高狀態的機率低於 60% 時不顯示。嚴重腐爛到認不出品項的，也不會有外觀判斷。
  - 只看外觀，無法判斷甜度或內部狀況（例如西瓜甜不甜、裡面有沒有空心）。
- 魚、海鮮、肉、蛋、豆製品（25 種：雞蛋、白蝦、草蝦、蛤蜊、鮮蚵、透抽、花枝、螃蟹、鮭魚切片、虱目魚、吳郭魚、秋刀魚、白鯧、鯖魚、豬五花、豬里肌、絞肉、牛肉、羊肉、雞腿、雞胸肉、全雞、鴨肉、豆腐、豆干）：
  - 測試集準確度 197/250（79%）；加入後原有 121 種從 79.7% → 78.8%（多角度 80.0% → 79.7%），只有 7 張原本認對的照片被新品項搶走。「非蔬果」拒絕率 56% → 49%（煮好的肉類菜餚容易被認成生肉）。
  - 較弱的是全雞（4/13）、虱目魚（4/7）、雞胸肉（9/16）、牛肉（6/10），錯的多半是同一大類的其他品項。所以生鮮品項最可能的那種機率低於 60%、但同一大類加起來夠高時，先顯示「看起來是雞肉」這類大類，讓使用者點細項。
  - 第二批 7 種（螃蟹、白鯧、鯖魚、鴨肉、羊肉、豆腐、豆干）：測試集 69/88（78%）。
  - 生鮮不做「好／不好」的外觀判斷（判斷錯可能吃壞肚子），改成「買之前自己檢查」的勾選清單，並提醒以聞、摸與包裝標示為準。
- 「手動選擇」清單最下方可以匯出教過的畫面（只有特徵數值、不含照片），提供給開發者改進辨識。

## 授權與資料來源

- 本專案的程式碼以 [MIT License](LICENSE) 授權。
- `vendor/transformers-*.min.js`：[Transformers.js](https://github.com/huggingface/transformers.js)，Apache License 2.0。
- `vendor/ort-*/`：[ONNX Runtime Web](https://github.com/microsoft/onnxruntime)，MIT License。
- `vendor/tesseract-*/`：[Tesseract.js](https://github.com/naptha/tesseract.js) 與 tesseract.js-core，Apache License 2.0；`eng.traineddata.gz` 來自 [tessdata](https://github.com/tesseract-ocr/tessdata)（經 `@tesseract.js-data/eng` 套件），Apache License 2.0。
- 模型：[MobileCLIP](https://github.com/apple/ml-mobileclip)（Apple）的 ONNX 版本，執行時從 Hugging Face 的 [Xenova/mobileclip_s0](https://huggingface.co/Xenova/mobileclip_s0)、[Xenova/mobileclip_s1](https://huggingface.co/Xenova/mobileclip_s1) 下載，本 repo 不包含模型檔。**注意：MobileCLIP 的權重採用 [Apple Machine Learning Research Model License](https://github.com/apple/ml-mobileclip/blob/main/LICENSE_MODELS)，只允許非商業的研究用途，並排除用於產品或服務。** `embeddings*.json`、`refs*.bin` 是用這個模型算出的資料，同樣適用這些條款。
- 參考樣本與訓練用照片來自 [維基共享資源](https://commons.wikimedia.org/)，各照片依其原本的授權（多為 CC BY／CC BY-SA 或公有領域）。本 repo 只包含由照片算出的影像特徵（`refs*.bin`），不包含照片本身；照片清單可用 `tools/collect-photos.mjs` 重新產生（`tools/photos/index.json`，含每張照片在維基共享資源的檔名）。
