# 塔羅手動選牌：第三版計畫書（互動模式）

- 建立日期：2026-10-12
- 適用專案：Tarot-backend、Tarot-frontend
- 相關：取代第一版計畫書「階段 4 自由抽牌」的隨機版本，改為手動選牌
- 狀態：已完成（2026-10-12）

## 目標

在現有「選牌陣 → 系統抽牌」之外，新增一個互動模式：使用者除了自己輸入問題，還能自己挑選要解讀的塔羅牌。

已確認的設計：

1. 選牌方式：**點牌卡清單挑選**（列出 78 張牌，點選加入）
2. 正逆位：**使用者自己選**（每張牌可切換正位／逆位）
3. 張數：**自由張數**，上限 10 張（沒有牌陣位置）
4. 模式切換：**分頁**
5. 已選牌：預設由左到右，**可拖曳換位置**
6. 牌卡圖案：抓取公共領域的偉特塔羅（Rider-Waite-Smith，1909）圖存入專案，並在資料庫記錄每張牌的圖片路徑

與現有流程共用：組合分析（規則 1～10）、AI 串流解讀、Markdown 顯示、按鈕觸發與停止。

---

## 一、模式切換

前端在「占卜設定」最上方新增模式切換（兩個分頁或 segmented control）：

- **抽牌模式**（預設）：現狀。選牌陣 → 系統隨機抽牌。
- **選牌模式**：使用者輸入問題 + 自己挑牌。

兩個模式共用問題輸入框。切換模式時保留已輸入的問題。

---

## 二、牌卡圖案（偉特塔羅）

### 2.0.1 版權

使用 **Rider-Waite-Smith 1909 原版**（Pamela Colman Smith 繪），在美國為公共領域（public domain），可自由使用。
**不使用**後續重新上色或重繪的商業版本（仍受版權保護）。來源以公共領域圖庫為準（例如 Wikimedia Commons 的 RWS 1909 掃描圖），逐張確認授權後下載。

### 2.0.2 儲存方式

圖片**不存進 MongoDB**，改為：

- 下載到後端靜態資料夾 `public/cards/`，由 Express 以靜態檔案提供（`app.use('/cards', express.static(...))` 或既有 public 設定）
- 檔名規則：大牌 `major-<兩位數編號>-<英文名>.jpg`（例：`major-00-fool.jpg`）、小牌 `<花色>-<兩位數編號>-<英文名>.jpg`（例：`wands-01-ace.jpg`）
- 資料庫 `Card` 新增欄位 `image`（字串，存相對路徑如 `/cards/major-00-fool.jpg`，預設空字串）
- 由一次性腳本 `scripts/fetchCardImages.js` 下載圖片並回填 `image` 欄位；腳本以 `nameEn`／`number`／`suit` 對應檔名，找不到對應時列出警告

### 2.0.3 前端顯示

- `GET /api/cards` 與解讀回傳的每張牌都帶 `image`
- 選牌清單、已選牌、結果牌卡顯示縮圖；逆位的牌以 CSS `rotate(180deg)` 呈現
- `image` 為空時顯示既有的純文字牌卡（向下相容，缺圖不壞版）

---

## 三、後端 API

### 2.1 新增端點：取得全牌清單

前端選牌需要 78 張牌的清單（id、名稱、花色）。

| 項目 | 內容 |
|---|---|
| 路由 | `GET /api/cards` |
| 回傳 | 牌卡陣列，每張含 `id`、`nameZh`、`nameEn`、`suit`、`arcanaType`、`number`、`image` |
| 排序 | 大牌依 `number`，小牌依花色（權杖、聖杯、寶劍、錢幣）再依 `number`，方便前端分組顯示 |
| 不含 | `sections`（牌義全文）、`keywords` 等大欄位，減少傳輸量 |

### 2.2 新增端點：手動選牌解讀

| 項目 | 內容 |
|---|---|
| 路由 | `POST /api/readings/manual` |
| 參數 | `question`（字串，限 500 字）、`cards`（陣列，每項 `{ id, orientation }`） |
| 驗證 | `cards` 長度 1～10；每項 `id` 為合法 ObjectId、`orientation` 為 upright／reversed；`id` 不可重複 |
| 流程 | 依 `id` 從資料庫撈牌（不信任前端傳來的名稱與分析），依傳入順序與正逆位組成 reading |
| 回傳 | 與 `/draw` 相同結構：`question`、`cards`、`overview`、`guidance`、`analysis`；`spread` 改為自由模式的描述（見下）；每張 `card` 含 `image` |

傳入順序即解讀順序（左到右）。前端拖曳換位後送出時，`cards` 已是新順序。

### 2.3 `buildReading` 支援無牌陣

目前 `buildReading` 需要 `spread.positions`。改為可接受「無牌陣」模式：

- 新增參數形式：傳入 `positions = null` 時，每張牌不帶位置（`label`、`key`、`prompt` 皆無）
- 無位置時：
  - `interpretation`、`overview`、`guidance` 的文字改用「第 N 張」代替位置名稱
  - `analyzeCombination` 的 `positionKeys` 傳 `null`（規則 8 牌陣位置、份量走向自動略過，其餘規則照常）
  - 回傳的 `spread` 以固定物件代表自由模式：`{ key: 'manual', name: '自選牌', description: '由你自己挑選的牌', cardCount: N }`
- 既有的三種牌陣流程完全不受影響（有 `positions` 就照舊）

### 2.4 AI 串流解讀沿用

`/api/readings/narrate` 已依牌 id 與正逆位重算分析，對手動選牌天然相容。唯一需調整：

- 目前 `narrate` 以 `spreadKey` 找牌陣。手動模式沒有牌陣，需讓它支援「無牌陣」：`spreadKey` 傳 `manual` 或省略時，走無位置流程。
- `narrationService` 的提示在無位置時，「牌陣位置」一節自然為空（`analysis.positions` 為空陣列），既有的 `listOrNone` 已處理。

### 2.5 測試（`npm test`）

- `buildReading` 無牌陣：overview／guidance 用「第 N 張」、`analysis.positions` 為空、其餘分析（元素、數字、權重、問題對照）仍產生
- `/manual` 參數驗證：張數 0 與 11、重複 id、非法 orientation、找不到的 id
- 全牌清單排序正確
- `image` 欄位有回傳（有回填時為路徑，未回填時為空字串）

---

## 四、前端

### 4.1 型別與 API（`src/types.ts`、`src/lib/api.ts`）

- 新增 `CardSummary` 型別（對應 `GET /api/cards`，含 `image`）
- 新增 `fetchCards()`：取得全牌清單（進入選牌模式時才呼叫，並快取）
- 新增 `createManualReading({ question, cards })`：對應 `POST /api/readings/manual`
- `streamNarration` 已用 `reading.spread.key` 與 `reading.cards`，手動模式回傳的 `spread.key = 'manual'` 可直接沿用；後端 narrate 需接受 `manual`

### 4.2 模式切換（分頁）

- 占卜設定最上方放分頁：「抽牌」「選牌」兩個 tab
- 共用問題輸入框；切換 tab 時保留已輸入的問題
- 樣式沿用深色玻璃質感，作用中的 tab 用 amber 點綴

### 4.3 選牌介面（`HomeView.vue`）

- **加入牌卡**：可搜尋的牌卡清單（依大牌／四花色分組），顯示縮圖，點一下加入已選牌
- **已選牌**：依序（左到右）顯示縮圖，每張可切換正位／逆位、可移除
- **拖曳換位**：已選牌可拖曳調整順序。採用原生 HTML Drag and Drop API（draggable + dragstart／dragover／drop），不新增套件（CLAUDE.md 規定新增套件需先詢問）
- 數量限制 1～10，達上限時停用加入
- 送出按鈕：至少選 1 張才可按；呼叫 `createManualReading`
- 載入中、失敗狀態比照現有 `handleDraw`

### 4.4 結果顯示

- 與抽牌模式共用現有結果區（牌卡、組合分析、AI 解讀）
- 牌卡顯示圖片縮圖，逆位以 `rotate(180deg)` 呈現；缺圖時維持純文字牌卡
- 牌卡標題的位置名稱（過去／現在…）在手動模式改顯示「第 N 張」
- 「判斷依據」的「位置解讀」區在手動模式自然不顯示（無資料）

### 4.5 樣式

沿用深色玻璃質感與現有 Tailwind class，不另外寫 CSS。

---

## 五、相容性與風險

- 既有 `/draw`、`/narrate`、三種牌陣完全不動行為，只擴充 `buildReading` 與新增端點
- `GET /api/cards` 為公開端點，只回傳牌名等非敏感資料
- `/manual` 與 `/narrate` 同樣會產生 AI 費用（narrate 階段），沿用現有的按鈕觸發機制控管
- 牌卡圖片僅用公共領域 RWS 1909 原版；下載腳本逐張確認授權，商業重繪版不使用
- 圖片檔（約 78 張）加入 git 會讓 repo 變大；若不想進 repo，可改放雲端儲存（例如 Render 的磁碟或物件儲存）並只存 URL。首批先放 `public/cards/`，視情況再調整

## 六、施作順序

1. 後端 `buildReading` 支援無牌陣 + 測試
2. 後端 `GET /api/cards`、`POST /api/readings/manual` + 測試
3. 後端 `/narrate` 支援 manual
4. 圖片：`Card` 新增 `image` 欄位、`scripts/fetchCardImages.js` 下載 RWS 1909 並回填、Express 提供 `public/cards/` 靜態檔
5. 前端型別、API、分頁切換、選牌介面（含拖曳）、牌卡縮圖
6. 用 4100／5180 臨時伺服器驗證，完成後關閉
7. 更新計畫書進度與 worklog

## 七、待確認事項

（已全部確認，見決議紀錄）

---

## 決議紀錄

| # | 項目 | 決議 |
|---|---|---|
| 1 | 選牌方式 | 點牌卡清單挑選 |
| 2 | 正逆位 | 使用者自己選 |
| 3 | 張數 | 自由張數，上限 10 張，無牌陣位置 |
| 4 | 模式切換 | 分頁 |
| 5 | 已選牌排序 | 預設左到右，可拖曳換位（原生 Drag and Drop，不加套件） |
| 6 | 牌卡圖案 | 公共領域 RWS 1909；圖存 `public/cards/`，資料庫存路徑 |
| 7 | 圖片儲存位置 | 方案 A：下載到 `public/cards/` 並進 git（imgtok 無 API 且不穩定，不採用） |

## 進度

| 項目 | 狀態 |
|---|---|
| 後端 buildReading 無牌陣 | 已完成 |
| 後端 GET /api/cards | 已完成 |
| 後端 POST /api/readings/manual | 已完成（`src/services/manualDraw.js` 驗證＋排序） |
| 後端 narrate 支援 manual | 已完成（spreadKey 省略或 manual 走無牌陣） |
| 圖片 下載腳本與 image 欄位 | 已完成（78 張存 `public/cards/`，`npm run fetch-images`，資料庫回填 image） |
| 前端 分頁切換 | 已完成 |
| 前端 選牌介面（含拖曳、縮圖） | 已完成（原生 Drag and Drop，牌卡顯示縮圖、逆位旋轉 180°） |
| 測試 | 已完成，`npm test` 共 33 項 |
