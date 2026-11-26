# v29　後端優化（專案評估找到的項目）

建立日期：2026-11-26
狀態：進行中

> 版號：原本編 v28，2026-11-26 合併遠端時發現遠端已有 v28（塔羅原創水彩牌面，`doc/v28-tarot-original-art-plan.md`），這份改成 v29；程式註解裡的「v28 項目 N」一併改成「v29 項目 N」。

## 一、目標

2026-11-26 兩個唯讀子代理做了專案評估，使用者要求「全部都做完」。這份計畫書把後端的部分列成進度表，做一項勾一項，決議也記在這裡。前端的部分由前端 session 另外處理。

原則：

- **回傳給前端的形狀不變**。萬一一定要變，先通知前端 session。
- 每一項做完都跑 `npm test`；最後跑 `verify`、`heuristic-check`（限速門檻），改到路由、權限、Model 的請 api-reviewer 審查。
- 不新增執行期的套件；需要新工具時先問使用者。
- 開發與測試絕不呼叫 OpenRouter。

**不做的事**

- Secret Manager（把 `env.yaml` 的機密搬到 GCP Secret Manager）：屬於 GCP 設定、不在 repo 裡，這次只寫建議與步驟（見五、待使用者決定）。
- 拿掉提示快取（`cache_control`）：先記錄一週的實際用量再判斷。
- 套件的大版本升級（dotenv 18、web-push 4）：只升小版本。
- 移除股票日記的舊格式轉換：使用者不確定線上是否已轉完，先保留。

## 二、項目

### A. 改動小、有實際影響

1. **AI 每日上限可以用同時請求繞過**：塔羅 narrate、追問、雷諾曼 narrate 都是先 `check()`，到 AI 開始產生才 `record()`，同一個人同時送很多個請求時，全部都會通過檢查。股市分析已經有「同一人進行中」的鎖，抽成共用並三條都套用（和第 10 項一起做）。
2. **`financeNews.test.js` 偶發失敗**：請求處理途中的 `console.log` 和 `node --test` 子行程共用 stdout，負載高時父行程解析測試結果失敗。請求途中的 log 改用 `console.warn`／`console.error`；測試的 `withServer` 先 `closeAllConnections()` 再關。
3. **紀錄列表讀整份文件**：塔羅與雷諾曼的紀錄列表只挑需要的欄位、加 `.lean()`，摘要改成純函式；回傳形狀不變。
4. **訪客抽牌沒有限速**：`POST /api/readings/draw`、`/manual`、`/follow-up/draw`、`GET /api/cards/random` 共用一個訪客限速器，登入的人略過（比照每日一牌）。

### B. 改動中等

5. **塔羅牌卡縮圖**：78 張 JPEG 共約 16MB，結果頁只顯示約 50px 寬。產生 240px 寬的 WebP 放在 `public/cards/thumb/<同檔名>.webp`，快取同 `/cards`；原圖保留給「點牌放大」。和前端的約定：縮圖網址是把 `/cards/xxx.jpg` 換成 `/cards/thumb/xxx.webp`。
6. **AI 費用的觀測**：正式環境開啟 OpenRouter 的 `usage`，每次記下 token 數、費用、快取命中的 token（不記問題內容）；備援模型改成 Sonnet 5（使用者決定）；追問改以紀錄裡存的解讀為準，或縮短前端送來文字的上限。
7. **股市諮詢的行情串流沒壓縮**：修剪 NDJSON 裡前端用不到的行情資料；前端用到的欄位不能少。
8. **`env.yaml` 沒受保護**：hooks 的 `guard.mjs` 擋讀 `env.yaml`，補測試；前後端的 `.claude/hooks/` 同步。

### C. 結構整理

9. **`server.js` 太大**：塔羅路由（draw、manual、cards、narrate、follow-up）抽成 `createTarotRouter({...})`，用注入的方式讓測試載入得到；補塔羅 narrate／追問的 HTTP 層測試（假的串流）。
10. **AI 串流的共用函式**：「中斷停止計費、出錯退還、`NarrationRefusedError` 回 422」有好幾份，抽成共用的 `streamAiResponse`，用量的記錄、退還與第 1 項的鎖也統一在這裡。
11. **`startOfTaipeiDay`**：從 `routes/marketAnalysis` 搬到 `services/clock.js`，service 不反過來依賴 route。
12. **股票日記舊格式轉換**：每次啟動全表掃描一次。使用者不確定線上是否已轉完，先保留（見五）。
13. **套件**：express、mongoose、express-rate-limit 升到最新的小版本。

## 三、階段與進度

| # | 項目 | 狀態 |
|---|---|---|
| 1 | AI 上限的同時請求 | 完成：塔羅解讀、追問、雷諾曼、個股、新聞五條都先上鎖再檢查次數；塔羅三條的新請求會取代同一人進行中的舊請求（舊的照算、不退），個股與新聞維持 409；有測試 |
| 2 | 測試偶發失敗 | 完成：請求途中的 log 改走 stderr（共用串流的中斷 log、大盤概況）；23 處 withServer 先 closeAllConnections，完整測試約 7.7 秒；4 份完整測試同時跑 10 輪共 40 次，0 次失敗（修之前子代理測到 40 次失敗 8 次） |
| 3 | 紀錄列表只挑欄位 | 完成：塔羅與雷諾曼列表 `.select().lean()`，摘要改成純函式；實測 20 筆讀取量 114KB → 12KB，回傳形狀不變 |
| 4 | 訪客抽牌限速 | 完成：共用 `lib/guestLimiter.js`（每 IP 每分鐘 30 次，登入略過），套到 draw、manual、follow-up/draw、cards/random，每日一牌也改用它 |
| 5 | 牌卡縮圖 | 等使用者安裝 ImageMagick |
| 6 | AI 費用觀測、備援模型、追問文字 | 完成：每次記 token／快取／推理 token／費用（`MarketAiUsage`，保留 14 天，不記問題）、`scripts/aiUsageReport.js` 報表；備援改 Sonnet 5；追問的先前解讀與已寫回答以紀錄為準，前端送的截短 |
| 7 | 行情串流瘦身 | 不做瘦身（原因見決議紀錄）；順便修掉 3～4 檔時行情存不進紀錄的問題 |
| 8 | `env.yaml` 保護 | 完成：hooks 擋 Read／Grep／shell 讀 env.yaml，前後端同步，`test/hooks.test.js` |
| 9 | 抽出塔羅路由 | 完成：`routes/tarot.js`（`createTarotRouter`），server.js 1060 → 約 470 行；`test/tarotRoutes.test.js` 7 個 HTTP 層測試（假串流）；4101 煙霧測試既有網址正常 |
| 10 | AI 串流共用函式 | 完成：`services/aiStream.js`（`streamAiResponse`、`createUserLock`、`createAiUsage`），五條 AI 路徑共用 |
| 11 | `startOfTaipeiDay` 搬家 | 完成：搬到 `services/clock.js`；順便把另外三處直接 `new Intl.DateTimeFormat` 改用共用的 `dateTimeFormat` |
| 12 | 舊格式轉換 | 保留（使用者不確定） |
| 13 | 套件小版本 | 完成：express 5.2.1 → 5.3.0、mongoose 9.12.0 → 9.13.1、express-rate-limit 8.7.4 → 8.7.5；`npm test` 全過，4101 煙霧測試正常 |

## 四、決議紀錄

- 2026-11-26：使用者決定備援模型由 Claude Opus 5.5（每百萬 token 輸入 US$4／輸出 US$20）改成 Claude Sonnet 5（US$2／US$10，和主模型 Sonnet 5.5 同價），主模型出錯時費用不會翻倍。
- 2026-11-26：縮圖工具：這台電腦沒有 ImageMagick／ffmpeg／Python 影像套件，使用者選擇自己安裝 ImageMagick，不新增 `sharp` 套件。
- 2026-11-26：股票日記的舊格式轉換：使用者不確定 Cloud Run 的 log 是否還有「[股票日記] 舊格式轉換」，先保留。
- 2026-11-26（項目 1、10）：鎖放在記憶體（`createUserLock`），Cloud Run 多實例各算各的，只是第一道；每日上限仍以資料庫計數為準。塔羅、追問、雷諾曼各自一把鎖（不同種類可以同時），個股與新聞沿用原本的鎖但改成共用函式。409 訊息「上一個 AI 解讀還在進行，請等它完成。」（股市維持「AI 分析」的字樣）。
- 2026-11-26（項目 6）：OpenRouter 的 `usage.include` 預設開啟（不加費用，設 `OPENROUTER_INCLUDE_USAGE=false` 可關），每次完成後把 promptTokens、completionTokens、cachedTokens、reasoningTokens、cost、model 寫回那一筆 `MarketAiUsage`；保留天數 2 → 14 天。提示快取先保留，觀察一週後用 `node scripts/aiUsageReport.js 7` 看快取命中率與每次費用再決定。
- 2026-11-26（項目 7）：實測一檔股票的行情約 70KB（gzip 後約 22KB），最大的 K 線（日／週／月）與回測曲線前端都在畫，數字也已經四捨五入；前端沒用到的只是幾個純量與小陣列，瘦身省不到 5%，又有弄壞畫面的風險，所以不做。量的時候發現原本保存上限 200000 字元（註解寫一檔約 20KB），問 3～4 檔時行情會被靜靜丟掉，改成 400000，`POST /api/readings` 與補存解讀的 body 上限 300kb → 500kb。
- 2026-11-26（項目 4）：訪客限速門檻沿用每日一牌的每 IP 每分鐘 30 次，抽牌、手動、追問抽牌、隨機牌共用一個額度；計數在記憶體，多實例各算各的。
- 2026-11-26（api-reviewer 審查後的修正）：
  - 必修：中斷的監聽原本在檢查次數、取行情之後才掛上，這段時間使用者斷線不會被發現、仍會呼叫 AI。改成 handler 一開始就 `watchClose`，呼叫 AI 前再檢查一次是否已中斷。
  - 前端「重新產生」會先中斷舊請求再送新的，但中斷傳到後端要時間，單純上鎖會讓新請求拿到 409。塔羅解讀、追問、雷諾曼改用 `takeOver`：中斷同一人的舊請求、最多等 5 秒讓它釋放再上鎖。被取代的舊請求照「使用者中斷」處理（次數照算、不退，不會變成繞過上限的方法）；它的連線還在時，還沒開始串流回 409、已經在串流送 error 事件，訊息「同一個帳號又送出了新的 AI 請求，這一次已經停止。」。5 秒內等不到才回原本的 409「上一個 AI 解讀還在進行」。
  - body 超過上限原本回 500，改回 413「送出的資料太大，無法處理。」；JSON 格式錯誤原本回 500，改回 400「資料格式不正確。」（4101 實測）。
  - 行情保存上限改用位元組計算（`Buffer.byteLength`，400000），中文字不會讓實際大小超過 body 上限。
  - 補紀錄摘要純函式的測試、429／400 時鎖有釋放的測試。

## 五、待使用者決定

- **Secret Manager**：建議把 `env.yaml` 裡的機密（MongoDB 帳密、OpenRouter 金鑰、JWT 密鑰等）改放 GCP Secret Manager，Cloud Run 以環境變數或掛載的方式讀取。步驟：在 GCP 建立各個 secret → 給 Cloud Run 的服務帳號 `Secret Manager Secret Accessor` 權限 → Cloud Build／`gcloud run deploy` 改用 `--set-secrets` → 確認線上正常後，刪掉本機 `env.yaml` 裡的明文。
- **舊格式轉換**：在 Cloud Run 的 log 搜尋「[股票日記] 舊格式轉換」，最近幾次部署都沒出現（或都是 0 篇），就可以移除啟動時的轉換。
