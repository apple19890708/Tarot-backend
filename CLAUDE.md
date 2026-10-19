# Tarot 後端（Tbackend）

塔羅占卜的 API。前端在相鄰的 `../Tfontend`，兩者常一起修改。

## 溝通

- 一律使用繁體中文（zh-TW）回覆與撰寫註解；程式識別字維持英文。

## 技術與指令

- Node.js（CommonJS）+ Express 5 + Mongoose 9，資料庫為 MongoDB Atlas 的 `tarot-divination`（78 張牌）
- `npm test`：Node 內建 `node:test`。改完程式一律跑測試；不要為了測試新增套件。
- `npm run dev`：`node --watch`，使用者自己用的開發伺服器。

## 程式結構

- `src/server.js`：所有路由（`/api/health`、`/api/spreads`、`/api/readings/draw`、`/api/readings/narrate`）
- `src/data/cardAttributes.js`：靜態牌卡屬性（花色元素、大牌元素、數字主題、宮廷階級）
- `src/services/combinationRules.js`：規則引擎，**只產生結構化結果，不產生文字**；整合 `src/services/rules/` 底下的規則 7～10
- `src/data/ruleConfig.js`：規則 7～10 的關鍵詞與門檻，調整門檻改這裡
- `src/services/analysisFormatter.js`：把結構化結果組成中性文字
- `src/services/readingService.js`：組合抽牌結果與 `analysis`
- `src/services/narrationService.js`：經 OpenRouter 呼叫 AI，把分析改寫成口語解讀
- `doc/v01-tarot-combination-rules-plan.md`：組合規則第一版（規則 1～6，已完成）
- `doc/v02-tarot-combination-rules-plan.md`：組合分析擴充（規則 7～10）
- `doc/worklog.md`：每日工作紀錄

## 編輯規則

- **判斷與文字分離**：規則判斷放 `combinationRules.js` 與 `src/services/rules/`（新規則一條一檔），文字放 `analysisFormatter.js`，AI 寫作原則放 `narrationService.js` 的 `SYSTEM_PROMPT`。
- **規則有變更就更新計畫書**：調整規則、門檻或決議時，同步修改對應計畫書（規則 1～6 在第一版、規則 7 之後在 v2）的章節、決議紀錄與進度表。
- **向下相容**：保留既有回傳欄位（`overview`、`guidance`、`cards`），新增欄位用加的，不改名、不刪除。
- **不信任前端資料**：需要分析或 AI 解讀時，由後端依牌 id 與正逆位重新計算，不直接使用前端傳來的分析文字。使用者輸入要驗證格式與長度。
- 新規則要在 `test/combinationRules.test.js` 補上邊界測試；隨機性（例如正逆位）以參數注入，讓測試可固定結果。

## 機密與費用

- **絕對不要自行呼叫 OpenRouter**。任何會消耗使用者額度的操作（`/api/readings/narrate`、`scripts/generatePairs.js`、任何 AI 生成）一律**先詢問並取得明確同意才執行**，計畫書裡的概括同意不算數，每次執行前都要再確認一次。
- 需要產生文字內容時，**優先由 Claude Code 直接撰寫**（例如 `scripts/seedPairsManual.js` 的作法），不要預設走 API。

- `.env` 含 MongoDB 帳密與 `OPENROUTER_API_KEY`：不要讀出、印出或寫進其他檔案；需要確認時只檢查「有沒有設定」。新增變數時同步更新 `.env.example`（只放空值或佔位符）。
- `/api/readings/narrate` 每次呼叫都會產生 AI 費用（約 US$0.04）。測試時只呼叫必要的次數，平常用 `npm test` 驗證提示內容（`buildUserMessage`）即可。

## 執行伺服器（重要）

使用者自己會在 **4000（後端）** 與 **5173（前端）** 跑 `npm run dev`。Claude 不得干擾：

1. 優先用 `npm test` 驗證，能不開伺服器就不開。
2. 必須開伺服器時，先用 `netstat -ano | grep -E ":(4000|4100|5173|5180) "` 確認佔用狀況，再以自己的 port、不加 `--watch` 啟動（避免改檔時重啟、中斷進行中的請求）：
   - `PORT=4100 node src/server.js`
   - 需要前端畫面時，前端用 5180 並指向 4100（見 `../Tfontend/CLAUDE.md`）
3. **測試結束後必須自己關閉**：記下自己啟動的程序 PID，用 `taskkill /PID <pid> /T /F` 連同子程序一起結束（Windows 上只停止背景工作不會結束子程序），再用 `netstat` 確認 port 已釋放。
4. 絕對不要結束不是自己啟動的程序（例如使用者在 4000／5173 的伺服器）。
