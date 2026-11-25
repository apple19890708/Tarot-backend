# v27　靜謐花園雷諾曼卡牌系統

建立日期：2026-11-25
狀態：階段 1～7 前後端完成並推上 main（2026-11-25）。尚待：AI 解讀只用測試驗證過、尚未實際呼叫（真實費用與品質未驗證）；附錄 A 的關鍵詞核對與 37～52 的撲克對應仍待使用者看實體牌

## 一、目標

在塔羅之外加入第二套牌：**靜謐花園雷諾曼**（The Deck Alchemist《Lenormand Card – Serene Gardens》，52 張＝傳統 36 張＋擴充 16 張）。做到和首頁塔羅一樣能完整占卜：

1. **問題 → 抽牌 → 結果** 三步驟，和塔羅首頁同一套手感（洗牌、扇形抽牌、排列圖、逐張牌義、組合分析、AI 解讀、保存紀錄）。
2. **權限**：只有 admin 與被管理者開通「雷諾曼」的會員看得到、用得到；選單、頁面、API 三層都擋，真正的放行在後端。
3. **雷諾曼自己的解讀邏輯**：沒有正逆位，以「牌與牌組成句子」、「位置與距離」、「宮位」、「人物視線」解讀，不套用塔羅的元素、花色、數字規則。
4. **牌陣**：說明書上的三張主題牌、三張時間線、九宮格、三十六宮位大藍圖（Grand Tableau）。

### 不做的事

- **不使用這副牌的原版插畫**（掃描、翻拍、描圖都不做）。原圖有版權，網站是公開部署（GitHub Pages＋Cloud Run），即使只給被開通的會員看，圖片網址本身仍是公開的。牌面改用**原創插畫**，見規格 3-3。
- 說明書的長段說明不照抄；**關鍵詞**照說明書轉錄（附錄 A），每張牌的完整牌義由 Claude Code 依關鍵詞重新撰寫（照 CLAUDE.md「優先由 Claude Code 直接撰寫」，不呼叫 AI API 產生）。
- 不做雷諾曼的**抽牌追問**（v23）、**每日一牌**、**股市諮詢**類型；之後有需要另開版本。
- 不做「時間牌」推算（例如騎士＝很快、樹＝很慢）；先放進後續評估。
- 不把雷諾曼的牌放進塔羅的 `Card` collection（原因見 3-2）。
- 未登入者不能使用（和塔羅不同：塔羅訪客也能抽牌）。

## 二、雷諾曼與塔羅的差異

這一節說明為什麼不能直接沿用塔羅的規則引擎與元件。

| 項目 | 塔羅（現有） | 雷諾曼（本版） |
|---|---|---|
| 張數 | 78（大牌 22＋小牌 56） | 52（傳統 36＋擴充 16）；大藍圖從 52 張選 36 張（見 D2） |
| 正逆位 | 有，影響牌義與規則 | **沒有**；改看牌面人物或物件的**朝向**（視線） |
| 解讀單位 | 單張牌在某個位置的意義，再加組合規則 | **牌與牌連成句子**：前一張是主詞、後一張是形容詞（例如「房屋＋老鼠」＝家裡有損耗） |
| 位置 | 每個位置有固定含意（過去、阻礙、建議…） | 小牌陣有位置；大牌陣看**宮位**（第 n 格對應第 n 張牌的主題）與**和代表牌的距離** |
| 代表牌 | 無 | 紳士（28）／淑女（29）代表求問者或對象，大牌陣以它為中心 |
| 組合規則 | 元素、花色、數字進程、宮廷牌、逆位比例 | 牌性（吉／凶／中性）、成對組合、特殊互動（例如鸛鳥朝向蛇可「吃掉」蛇的負面）、視線、距離 |
| 主題牌 | 依問題類型調整權重 | 問題類型對應**主題牌**：感情＝愛心、金錢＝魚、工作＝錨、健康＝樹木、家庭＝房屋，看它的位置與周圍 |

## 三、規格

### 3-1 權限

**後端**

- `User` 新增 `lenormandAccess: Boolean`（預設 `false`），和 `aiAccess`、`stockAccess` 同一種寫法：
  - `toPublicJSON` 回傳時 admin 一律為 `true`。
  - 新增 `canUseLenormand()`：停用的帳號一律不行；admin 一律可以；member 要被開通。
- `middleware/auth.js` 新增 `requireLenormandAccess`（用既有的 `createUserGuard`），拒絕訊息「雷諾曼功能需要管理者開通，請聯絡管理者。」
- 管理端新增 `PATCH /api/admin/users/:id/lenormand-access`，沿用 `updateAccess('lenormandAccess', '雷諾曼')`：
  - 信箱沒驗證的會員不能開通（回 409），和 AI、股市一致。
  - 管理頁統計加一個「雷諾曼已開通」人數。
  - 寫入操作紀錄 `AdminLog`。
- 雷諾曼的所有路由放在新 router `src/routes/lenormand.js`，**在 router 層整個套 `requireLenormandAccess`**，不靠個別端點記得加。
- AI 解讀要**兩個權限都有**：`lenormandAccess` 加上 `aiAccess`（admin 不受限）。

**前端**

- `AuthUser` 型別加 `lenormandAccess?`；`session.ts` 加 `canUseLenormand`。
- 路由 meta 加 `lenormand: true`，在 `router.beforeEach` 擋：沒有權限就回首頁，和 `meta.stock` 同一套寫法。前端規範是「權限只在路由 meta 判斷」。
- 選單：`MemberMenu` 新增一組 `menuGroup: 'lenormand'`，並在 `App.vue` 的導覽過濾加上 `meta.lenormand`。
- 管理頁 `AdminUsers.vue`：開關從 `['aiAccess','stockAccess']` 加成三個；同步修改篩選、統計、操作紀錄文字（`adminFormat.ts`）、`AdminLogEntry.action` 聯集。

### 3-2 牌庫資料

- **用靜態資料檔，不放 MongoDB**：`src/data/lenormand/cards.js`（52 張）與 `src/data/lenormand/houses.js`（36 宮位）。理由：
  1. 塔羅的 `/api/readings/draw` 用 `Card.aggregate([{ $sample }])` 從**整個 `Card` collection** 抽牌，`/api/health` 也用 `Card.countDocuments()` 顯示「已載入 78 張牌」。雷諾曼的牌如果放進 `Card`，塔羅會抽到雷諾曼的牌。
  2. 52 張的內容由 Claude Code 撰寫，放在程式碼裡可以版控、code review，也能直接寫測試，不需要另外 seed。
  3. 抽牌不需要連資料庫，測試也不用 mock。
- 每張牌的欄位：
  - `id`：1～52
  - `slug`：例如 `rider`
  - `nameZh`、`nameEn`
  - `keywords`：說明書的關鍵詞，見附錄 A
  - `meaning`：Claude Code 撰寫，內容分「核心」、「感情」、「工作」、「金錢」、「健康」、「當作形容詞時」幾段
  - `tone`：`positive`／`negative`／`neutral`，規則 L1 用
  - `facing`：`left`／`right`／`null`，牌面人物或物件的朝向，規則 L4 用；牌面圖定案後才填
  - `playingCard`：撲克牌對應，例如 `{ suit: 'hearts', rank: '9' }`；規則 L9 與「撲克花色解說」使用。37～52 號在使用者核對實體牌前先填 `null`，規則會略過這些牌
  - `image`：例如 `/lenormand/01-rider.svg`（原創 SVG，見 3-3）
  - `traditional`：1～36 為 `true`
- 宮位（1～36）：`{ house, cardId, theme }`，主題照附錄 B。宮位編號與傳統牌號一一對應。
- 資料檔的完整性用測試檢查：52 張編號連續不重複、slug 唯一、每張都有關鍵詞、宮位剛好 36 個且對應傳統牌、牌陣的位置數與張數一致。

### 3-3 牌面圖片與牌背

- 不使用原版插畫（見「不做的事」）。2026-11-25 使用者決定：**牌面直接用原創插畫**，不先用文字占位。
- 做法：由 Claude Code 手寫 **SVG 插畫**（向量，檔案小、放大不糊、可以版控）。只參考原牌的**風格方向**，構圖與圖形全部原創：
  - 共用牌框：米白底、細金色邊框、四角小花飾、上方牌號、下方中文名與英文名、角落撲克標記（有 `playingCard` 才畫）。
  - 中央主圖：每張牌一個原創主題圖，例如騎士是騎馬側影、四葉草是一株四葉草配小花、船是帆船……色調以米白、淡金、灰綠、淡紫為主，搭配白色花卉。
  - 質感：用 SVG 濾鏡（`feTurbulence` 等）做一點水彩紙紋；濾鏡要輕，避免手機上渲染太慢。
  - 有朝向的牌（人物、騎士、鸛鳥、鳥、狗、船……）畫的時候就決定朝左或朝右，同時填進資料的 `facing`，規則 L4 才有依據。
- 產生方式：`scripts/lenormand/buildCardArt.js` 組出 52 張 `public/lenormand/NN-slug.svg`。共用牌框寫一次，每張牌的主圖一個模組（`scripts/lenormand/motifs/`），之後要修某一張只改那一個檔。產出的 SVG 一併 commit。
- 單張大小目標在 30KB 以內（塔羅 JPG 約 200KB）。
- 圖片放後端 `public/lenormand/`，由 `app.use('/lenormand', express.static(..., { maxAge: '7d' }))` 提供，和塔羅 `/cards` 的快取設定相同；前端仍用 `cardImageUrl()` 取得網址。
- 塔羅的像素牌面引擎（`pixelTarot`）只對應塔羅圖檔，雷諾曼不經過它，直接顯示原圖。
- 牌背：前端 `src/lib/pixelArt.ts` 新增 `drawLenormandCardBack()`，主題是花園與藤蔓。抽雷諾曼時把 `--pixel-card-back` 換成這一張；`FanDeck`、`StepDraw`、`FlyingCard` 都吃這個 CSS 變數，不用改。
- `facing`（朝向）和插畫一起決定（見上方），兩者要一致；資料完整性測試檢查有畫朝向的牌都有填 `facing`。

### 3-4 牌陣

定義檔 `src/data/lenormand/spreads.js`，**沿用塔羅 `spreads.js` 的資料形狀**：`key`、`name`、`cardCount`、`description`、`grid`、`positions[].layout`、`relations`。前端的 `SpreadLayout` 不用改就能畫。雷諾曼的位置權重先不用，`weight` 欄位省略。

| key | 名稱 | 張數 | 排法 | 說明（依說明書） |
|---|---|---|---|---|
| `theme-3` | 三張主題牌 | 3 | 1 列 3 張 | 中間是**主題牌**，左右兩張是形容主題的牌 |
| `theme-5` | 五張主題牌 | 5 | 1 列 5 張 | 主題牌在中間，左右各加一張，形容得更細（說明書：可增加到 5 或 9 張） |
| `timeline-3` | 過去現在未來 | 3 | 1 列 3 張 | 由左到右是過去、現在、未來 |
| `nine-box` | 九宮格 | 9 | 3×3 | 橫軸由左到右是過去、現在、未來；縱軸由上到下是「思想／未掌握／希望的事」、「現實／問題的狀況」、「內心感受／已掌握的事」 |
| `grand-tableau` | 三十六宮位大藍圖 | 36 | 9×4（見 D3） | **從 52 張裡選 36 張**攤開（見 D2）；每一格對應一個宮位，以代表牌為中心解讀 |

- 九宮格的位置標籤由「列主題 × 欄時間」組成，例如中心格是「現在 × 現實／問題的狀況」。前端翻到牌背時看得到這個標籤（`SpreadLayout` 已有）。
- 大藍圖的格子要同時顯示**宮位**（小字，例如「24 愛情」）與**落在這格的牌**。牌陣定義裡每個位置帶 `house` 欄位。
- 大藍圖從 52 張選 36 張，所以會有 16 張牌不在牌面上，代表牌或主題牌可能沒出現：
  - **自動抽牌**：一定放入求問者選的代表牌，其餘 35 張從剩下 51 張隨機抽。這樣每次大藍圖都有中心。
  - **輸入實體牌**：照使用者實際攤出的牌，不強制。代表牌沒出現時，改以**代表牌的宮位**（第 28 或 29 宮）當中心解讀，分析裡標明「代表牌未出現」。
  - **主題牌沒出現**：也當成一個訊息標出，例如「愛心沒有出現在牌面上」，L8 改讀主題牌對應的宮位。
  - 擴充牌（37～52）沒有自己的宮位，落在哪一宮就讀「這張擴充牌 × 該宮主題」，規則一致。

### 3-5 解讀規則（雷諾曼規則引擎）

照專案「判斷與文字分離」的原則：

- 規則判斷：`src/services/lenormand/rules/`，一條規則一個檔，**只產生結構化結果**。
- 整合：`src/services/lenormand/engine.js`。
- 中性文字：`src/services/lenormand/formatter.js`。
- 門檻與字典：`src/data/lenormand/ruleConfig.js`。

| 規則 | 名稱 | 內容 | 適用牌陣 |
|---|---|---|---|
| L1 | 牌性統計 | 依 `tone` 統計吉、凶、中性張數，給出整體傾向；凶牌集中在哪個區域（例如九宮格的哪一列） | 全部 |
| L2 | 成對組合 | 相鄰兩張依序讀成「主詞＋形容詞」。主題牌陣是「主題牌被左右兩張形容」；時間線是相鄰兩張的轉折 | 主題牌、時間線、九宮格的列與欄 |
| L3 | 特殊組合字典 | 已知有特定意義的牌對，例如：<br>戒指＋愛心＝承諾的感情<br>鸛鳥朝向蛇＝負面被清除（說明書的例子）<br>棺材＋孩童＝舊的結束、新的開始<br>字典由 Claude Code 撰寫，第一版約 60 組，之後可以擴充 | 全部 |
| L4 | 視線與朝向 | 人物牌（紳士、淑女）是否互相對視（感情占卜時表示兩人心意是否一致）；有朝向的牌「看向」哪一張；鸛鳥、騎士這類有方向的牌往哪裡移動 | 全部（`facing` 有值的牌） |
| L5 | 九宮格結構 | 三列（思想、現實、內心）、三欄（過去、現在、未來）、中心牌、兩條對角線、四角 | 九宮格 |
| L6 | 代表牌與距離 | 找到代表牌（求問者選的紳士或淑女）；其他牌依和代表牌的距離分成近、中、遠，越近影響越直接；**左邊是過去、右邊是未來、上方是意識與思想、下方是潛意識與已掌握的事**；另外讀代表牌周圍的九宮 | 大藍圖 |
| L7 | 宮位 | 每張牌落在第 n 宮時，讀成「這張牌 × 第 n 宮的主題」；代表牌、主題牌所在的宮位特別標出 | 大藍圖 |
| L8 | 主題牌 | 依問題類型找主題牌（感情＝愛心、金錢＝魚、工作＝錨、健康＝樹木、家庭＝房屋），看它在哪一宮、離代表牌多遠、周圍是哪些牌；沒出現時改讀對應宮位 | 大藍圖（小牌陣只在主題牌有出現時標出） |
| L9 | 撲克花色 | 統計紅心、方塊、梅花、黑桃的張數與主導花色；紅色（紅心、方塊）偏順、黑色（梅花、黑桃）偏有挑戰；人頭牌（J、Q、K）可能代表某個人。意思見 3-11 | 全部（`playingCard` 為 `null` 的牌略過） |
| L10 | 騎士跳（knighting） | 從代表牌與主題牌出發，走西洋棋騎士的 L 形（橫 2 直 1、或橫 1 直 2），落到的牌和起點牌兩兩成對解讀，用來看「檯面下、間接影響」的因素。在邊緣的牌能跳的格子較少（角落只有 2 個） | 大藍圖 |
| L11 | 鏡射（mirroring） | 以牌陣的中軸對照：左右鏡射（同一列、對稱欄）、上下鏡射（同一欄、對稱列）、對角鏡射（兩者都對稱）。鏡射到的兩張牌成對解讀，補充細節。代表牌與主題牌的鏡射牌特別標出 | 大藍圖；九宮格也可以用（左右、上下各一組） |

- 問題類型**沿用塔羅的 `analyzeQuestionType`**，但不開放股市類型；只用來決定 L8 的主題牌。
- 隨機性（洗牌）以參數注入（`rng`），測試可以固定結果。抽牌用 `crypto.randomInt` 做 Fisher–Yates 洗牌，不用 `Math.random`。
- 新規則照慣例補上邊界測試，寫在 `test/lenormand*.test.js`。改到門檻或字典時，照 `heuristic-check` 用多組實際抽牌抽查誤判。

### 3-6 API

全部掛在 `/api/lenormand`，router 層統一套 `requireLenormandAccess`。

| 方法 | 路徑 | 內容 |
|---|---|---|
| GET | `/api/lenormand/cards` | 52 張牌（選牌器與牌義用） |
| GET | `/api/lenormand/spreads` | 牌陣定義 |
| POST | `/api/lenormand/readings/draw` | `{ question, spreadKey, domain?, significator? }` → 後端洗牌抽牌，回傳牌、位置、分析 |
| POST | `/api/lenormand/readings/manual` | `{ question, spreadKey, cards: [id…], significator? }`：扇形抽牌或**輸入實體牌**時用，後端依牌號重算分析 |
| POST | `/api/lenormand/readings/narrate` | 另外要 AI 權限；NDJSON 串流（`startNdjson`＋`streamChat`），後端依牌號重算分析再交給 AI |
| POST | `/api/lenormand/readings` | 保存紀錄 |
| GET | `/api/lenormand/readings`、`/api/lenormand/readings/:id` | 紀錄列表、詳情（只看自己的） |
| DELETE | `/api/lenormand/readings/:id` | 刪除，連同它的日記 |

- `significator`：`28` 或 `29`，求問者選「哪一張代表我」，不和性別綁定。大藍圖必填，其他牌陣可省略。
- 輸入驗證：
  - 牌號必須是 1～52 的整數且不重複（大藍圖也是，從 52 張選 36 張）。
  - 張數要和牌陣一致。
  - 問題長度沿用 `validateQuestion`。
- 不信任前端：analysis 一律由後端依牌號重算，前端傳來的分析文字不使用。
- 回應用 `res.json()`，自動 gzip。大藍圖一次 36 張，只回需要的欄位（牌義全文由 `/cards` 提供，前端快取）。

### 3-7 資料模型（紀錄）

- 新 model `LenormandReading`，**不擴充塔羅的 `Reading`**。理由：
  - `Reading.cards` 的 `cardId` 是指向 `Card` 的 ObjectId，`orientation` 是必填。
  - `pre('validate')` 的 AI 品質檢查是塔羅專用。
  - 混在一起會讓塔羅的歷史、月曆、匯出全部要加判斷。
- 欄位：
  - `user`、`question`、`domain`、`spreadKey`、`spreadName`
  - `significator`
  - `cards: [Number]`：依位置順序，只存重算需要的輸入
  - `narration`：AI 解讀，形狀同塔羅
  - `createdAt`
- 分析不存，讀取時重算：沿用 v13 的決定，規則更新後舊紀錄也看到最新判斷。
- 每人上限沿用 100 筆。
- 刪除帳號（`services/accountDeletion.js`）的清單加上 `LenormandReading`。

### 3-8 AI 解讀

- 新檔 `src/services/lenormand/narration.js`：
  - 雷諾曼專用的 `SYSTEM_PROMPT`：沒有正逆位、牌組成句子、宮位與距離、人物視線。
  - `buildUserMessage`：把位置、宮位、成對組合、規則結果整理給 AI。
  - 呼叫沿用 `narrationService` 的 `streamChat`：90 秒無資料中止、使用者中斷時停止計費。
- 每日次數：`tarotAiQuota` 新增 kind `lenormand`，每天 30 次，admin 不限。和塔羅分開計，方便看用量。
- 大藍圖有 36 張，提示會很長：比照 v25「大牌陣推理強度」的做法調整 `effort`，並在計畫執行前估算一次的費用。
- 寫完的檢查（`narrationCheck`）：雷諾曼另寫一組，第一版只檢查「有沒有寫出正逆位」「有沒有提到代表牌」這類明顯錯誤。
- **費用規範**：開發與測試時不自行呼叫 OpenRouter；`buildUserMessage` 用 `npm test` 驗證。需要實際呼叫時，每次先取得使用者同意。

### 3-9 前端

依前端現況調查（2026-11-25），能重用的盡量重用，塔羅寫死的地方改成由牌組設定決定。

**頁面與路由**

- 新路由 `/lenormand`（`LenormandView.vue`），meta：`auth`、`lenormand`、`menuGroup: 'lenormand'`。
- 流程沿用 `HomeView` 的三步驟。`HomeView` 已有 974 行，不在裡面加 `if (deck === 'lenormand')`。做法是把步驟流程的共用部分抽成 composable，例如 `useReadingFlow`，塔羅與雷諾曼各自傳入 API 與設定。

**可直接重用**

- 排列：`SpreadLayout`、`SpreadSlots`、`readingSpread.ts`。
- 抽牌動畫：`FanDeck`、`FlyingCard`。
- AI 串流：`streamNarration` 的寫法、`NarrationFeedback`、`renderAiMarkdown`。
- 紀錄：`RecordIndex`、`RecordListShell`。
- 其他：`SelectField`、`SkeletonBlock`、`confirmDialog`、`useScrollLock`。

**要參數化（改成選配）**

- 正逆位：`HomeView.shuffleDeck`、`StepDraw`（切換按鈕與翻轉）、`SpreadSlots`、`SpreadLayout`（`orientationLabel`、`rotate-180`）、`StepResult` 的正逆位標籤。有 `orientation` 才顯示。
- `StepDraw` input 模式的選牌器分組：塔羅依大牌、花色、宮廷分組；雷諾曼改成 1～36 一組、37～52 一組，可以用牌號搜尋。
- `StepQuestion`：問題類型選項由外部傳入，雷諾曼不含股市；另加「代表牌」選項（紳士／淑女）。
- 型別：`ReadingCard.card` 的 `arcanaType`、`suit` 目前是必填；雷諾曼另定 `LenormandCard` 型別，不去放寬塔羅型別，避免影響塔羅既有的檢查。

**新做**

- `LenormandAnalysisPanel.vue`：顯示 L1～L8 的結構化結果，例如成對組合、九宮格的列與欄、特殊組合、視線。塔羅的 `ReadingAnalysisPanel`、`QuantPanel` 是塔羅專用，不共用。
- `GrandTableau.vue`：大藍圖 9×4。
  - 每格標宮位，代表牌加框，主題牌標記；代表牌或主題牌沒出現時，在對應宮位標出。
  - 點一張牌時，用顏色深淺標出它和代表牌的距離（近、中、遠）。
  - 切換「騎士跳」：從選中的牌標出 L 形落點，並列出成對解讀。
  - 切換「鏡射」：標出選中的牌的左右、上下、對角鏡射牌。
- `LenormandSuitPanel.vue`：撲克花色獨立區（3-11），花色分布＋後端給的解說表。
  - 手機寬度不夠 9 欄：改成可左右捲動，或縮放後點開單格看。實際做法在畫面交付前照 `ui-check` 決定。
- 牌背：`drawLenormandCardBack()`。

**抽牌模式**

- 小牌陣（3、5、9 張）：自動、扇形、輸入實體牌三種都提供。
- 大藍圖：只提供**自動**與**輸入實體牌**。扇形一張一張挑 36 張太長。輸入模式用 9×4 的格子逐格選牌。

> 「輸入實體牌」很適合這個功能：使用者手上有實體的靜謐花園牌，可以用實體牌占卜，再把結果輸入網站，取得分析與 AI 解讀。

### 3-10 紀錄、月曆、日記

- **我的紀錄**：`HistoryView` 新增分頁 `lenormand`。分頁依 `meta.recordTabs` 與權限決定，沒權限的人看不到這個分頁。
- **月曆**：當天的占卜清單加上雷諾曼紀錄。
  - 後端 `/api/calendar` 的每筆紀錄加 `deck: 'tarot' | 'lenormand'`（新增欄位，不改舊欄位）。
  - 前端 `CalendarDayDetail` 依 `deck` 決定連結與標籤。
  - `cardShortName` 只處理塔羅；雷諾曼直接顯示中文牌名，名字都很短。
- **日記**：
  - `JournalEntry.TARGET_KINDS` 加 `lenormand`。
  - 後端日記路由驗證 target 時，確認那筆 `LenormandReading` 是本人的。
  - 前端 `JournalView` 的 `kind` 加 `lenormand`，返回連結與文字改成依 kind 決定。
- **匯出**（`recordExport`、`recordPdf`）：這一版不做，放進後續。

### 3-11 撲克花色解說

2026-11-25 使用者要求：撲克花色也要解讀，並且**獨立一區**解釋它代表什麼。

- 結果頁的分析下方獨立一個「撲克花色」區塊：
  - 這次抽到的牌的花色分布（例如紅心 3、黑桃 1），以及 L9 的判斷。
  - 一張固定的**解說表**：四種花色、紅黑、人頭牌、A 各代表什麼。文字由後端提供（`src/data/lenormand/playingCards.js`），前端不自己寫。
- 雷諾曼的撲克花色**沒有統一標準**。查到的資料多數同意：
  - **紅心**：感情、人際關係、感受，偏正面。
  - **方塊**：金錢、事業的行動力、能量與機會，偏正面但起伏大。
  - **梅花**：麻煩、責任、壓力、需要處理的複雜狀況，偏挑戰。
  - **黑桃**：說法最分歧，有人讀成工作、結構、穩定與責任，也有人讀成溝通、移動與法律事務；整體偏挑戰。
  - **紅色與黑色**：紅色（紅心、方塊）偏順，黑色（梅花、黑桃）偏有挑戰，這是最常見的簡化讀法。
  - **人頭牌**：K、Q、J 常被當成「某個人」的提示（K 偏年長或有權威、Q 偏女性、J 偏年輕或想法）；A 代表重點或強調。也有一種說法是 K 最強、6 最弱，牌面數字代表強度。
- 解說表要寫明「各家說法不同，這裡採常見讀法」，黑桃同時列出兩種說法。
- AI 解讀的提示也帶入花色分布，但要求 AI 以牌義為主、花色為輔，不能只用花色下結論。

### 3-12 抽牌回應形狀（階段 3 定稿，前端結果頁照這一節）

`POST /api/lenormand/readings/draw` 與 `POST /api/lenormand/readings/manual` 回傳同一個形狀。形狀之後若有改，以這一節為準並同步更新。

**請求**

| 欄位 | draw | manual | 說明 |
|---|---|---|---|
| `question` | 選填 | 選填 | 字串，最多 500 字（`validateQuestion`） |
| `spreadKey` | 必填 | 必填 | `theme-3`／`theme-5`／`timeline-3`／`nine-box`／`grand-tableau`（階段 5 開放；沒選代表牌回 400「這個牌陣需要選擇代表牌。」） |
| `domain` | 選填 | 選填 | `love`／`money`／`work`／`health`／`family`／`social`／`study`；沒給就用問題關鍵詞判斷；`stock` 不接受 |
| `significator` | 選填 | 選填 | `28`（紳士）或 `29`（淑女），小牌陣可省略；大藍圖必填 |
| `cards` | — | 必填 | 牌號陣列，依位置順序（由左到右、由上到下）；1～52 的整數、不重複、張數等於牌陣張數 |

錯誤一律 400 `{ message }`；權限 401／403 同 3-1。

**回應**

```jsonc
{
  "deck": "lenormand",
  "mode": "draw",                       // draw | manual
  "question": "他會主動聯絡我嗎？",
  "spread": { "key": "theme-3", "name": "三張主題牌", "description": "…", "cardCount": 3, "grid": { "cols": 3, "rows": 1 } },
  "significator": 29,                   // 沒選是 null
  "overview": "左側形容：騎士、主題牌：愛心、右側形容：戒指",   // 中性一句，和塔羅同名
  "guidance": "…",                      // 中性結語一段，和塔羅同名
  "cards": [
    {
      "index": 0,
      "position": { "key": "left", "label": "左側形容", "prompt": "…", "layout": { "col": 1, "row": 1 } },
      // 大藍圖的 position 另有 house、houseTheme
      "card": {
        "id": 1, "slug": "rider", "nameZh": "騎士", "nameEn": "Rider", "image": "/lenormand/01-rider.svg",
        "keywords": ["消息", "…"], "tone": "neutral", "facing": "right",
        "playingCard": { "suit": "hearts", "rank": "9" },   // 37～52 是 null
        "traditional": true
      }
    }
  ],
  "analysis": {
    "questionType": { "kinds": ["yesNo"], "topic": "love", "othersInvolved": false },  // 沿用塔羅 analyzeQuestionType
    "domain": { "key": "love", "label": "感情", "source": "keywords", "themeCardId": 24, "themeIndex": 1 },
    //   source：selected（使用者選）／keywords（問題關鍵詞）／none；key 為 null 時 themeCardId 也是 null
    //   themeIndex：主題牌在這次牌面的 index，沒出現是 null
    "tone": {                           // L1 牌性統計
      "counts": { "positive": 1, "negative": 0, "neutral": 2 }, "total": 3,
      "lean": "positive",               // positive | negative | mixed | neutral（(吉−凶)/總數 ≥ 0.3 偏吉、≤ −0.3 偏凶）
      "negativeIndexes": [],
      "cleansedIndexes": [],            // 被 L3 化解的凶牌（鸛鳥朝向蛇等），counts 與 lean 把它們當中性
      "scope": "all",                   // all（小牌陣，看全部）| near（大藍圖，只看中心周圍的近距離牌；counts／total／lean／negativeIndexes／cleansedIndexes 都只算這幾張）
      "clusters": [ { "axis": "row", "key": "reality", "label": "現實／問題的狀況", "indexes": [3, 5], "count": 2 } ]  // 只有九宮格
    },
    "pairs": {                          // L2 成對組合
      "items": [ { "from": 1, "to": 0, "kind": "modifier", "line": null, "cardIds": [24, 1], "tones": ["positive", "neutral"], "shift": null, "effect": "neutral" } ],
      //   kind：modifier（from 被 to 形容）／sequence（時間先後）／stack（九宮格同一欄由上到下）
      //   line：九宮格的列或欄 key（mind、reality、heart、past、present、future）；大藍圖是 significator／theme（只讀代表牌、主題牌的左右相鄰，sequence 由左到右）；其他牌陣 null
      //   shift（sequence、stack）：improve | worsen | steady；effect（modifier）：brightens | darkens | neutral
      "theme": { "index": 1, "cardId": 24, "modifierIndexes": [0, 2], "effect": "brightened" }  // 主題牌陣才有，其他 null
      //   effect：brightened | darkened | mixed | neutral
    },
    "combos": [                         // L3 特殊組合字典（相鄰的牌）
      { "id": "ring-heart", "indexes": [2, 1], "cardIds": [25, 24], "tone": "positive", "meaning": "承諾的感情" }
      // 有方向條件的另有 "condition": "faces"；鸛鳥朝向凶牌另有 "cleanses": index
    ],
    "gaze": {                           // L4 視線
      "looks": [ { "index": 0, "cardId": 1, "facing": "right", "toward": 1, "away": null } ],  // toward／away 是看向、背對的相鄰牌，沒有是 null
      "mutual": [ { "a": 3, "b": 4, "relation": "faceToFace" } ],   // faceToFace | backToBack（相鄰的兩張有朝向的牌）
      "couple": { "gentleman": 0, "lady": 2, "between": [1], "relation": "facingApart" },   // between：同一列夾在兩人中間的牌
      //   relation：faceToFace（相鄰對視）| facingApart（同列、中間隔著牌但面對面）| backToBack | sameDirection | differentRows；兩張沒都出現時 couple 是 null
      "significator": { "cardId": 29, "index": 2, "toward": 1, "away": null }  // 沒選或沒出現時 index 為 null
    },
    "nineBox": null,                    // L5，只有九宮格；形狀見下方
    "suits": {                          // L9 撲克花色
      "counted": 3, "skipped": 0,       // skipped：playingCard 為 null（37～52）略過的張數
      "counts": { "hearts": 2, "diamonds": 0, "clubs": 1, "spades": 0 },
      "dominant": ["hearts"],           // 張數最多的花色（並列時多個；counted 為 0 時空陣列）
      "colors": { "red": 2, "black": 1 }, "colorLean": "red",   // red | black | even | null
      "faces": [ { "index": 1, "cardId": 24, "rank": "J", "suit": "hearts" } ],
      "aces": []
    },
    "tableau": null                     // 只有大藍圖，其他牌陣是 null；形狀見下方
  },
  "text": {                             // formatter 產生的中性文字，前端照順序顯示
    "sections": [ { "key": "tone", "title": "整體牌性", "lines": ["…"] } ]
    //   key 依序：tone、center、houses、themeCard、pairs、combos、gaze、nineBox、knighting、mirrors、suits（沒有內容的段落不出現；center／houses／themeCard／knighting／mirrors 只有大藍圖）
  }
}
```

**`analysis.nineBox`（只有九宮格）**

```jsonc
{
  "rows": [ { "key": "mind", "label": "思想／未掌握／希望的事", "indexes": [0, 1, 2], "cardIds": [ … ], "lean": "mixed" } ],   // mind、reality、heart
  "cols": [ { "key": "past", "label": "過去", "indexes": [0, 3, 6], "cardIds": [ … ], "lean": "neutral" } ],              // past、present、future
  "center": { "index": 4, "cardId": 31, "tone": "positive" },
  "diagonals": [ { "key": "main", "indexes": [0, 4, 8], "cardIds": [ … ], "lean": "positive" },    // 左上 → 右下
                 { "key": "anti", "indexes": [2, 4, 6], "cardIds": [ … ], "lean": "negative" } ],  // 右上 → 左下
  "corners": { "indexes": [0, 2, 6, 8], "cardIds": [ … ], "lean": "mixed" },
  "mirrors": [ { "axis": "leftRight", "a": 0, "b": 2 }, { "axis": "topBottom", "a": 0, "b": 6 } ]   // 左右 3 組、上下 3 組
}
```

**`analysis.tableau`（只有大藍圖，階段 5）**

大藍圖 9×4，位置 index `i` 在第 `i % 9 + 1` 欄、第 `floor(i / 9) + 1` 列，也就是第 `i + 1` 宮（`cards[i].position.house`）。這裡只放索引與牌號，牌名、宮位主題前端用 `cards[i]` 與 `/spreads` 的 `houses` 查。距離一律用切比雪夫距離（橫、直、斜走一步都算 1）。

```jsonc
{
  "center": {                           // L6 中心
    "mode": "significator",             // significator（代表牌有出現）| house（沒出現，改用代表牌的宮位當中心）
    "cardId": 29,                       // 求問者選的代表牌
    "present": true,                    // false 時要顯示「代表牌未出現」
    "index": 12,                        // 中心那一格：present 時是代表牌的位置；否則是第 28／29 宮那一格（index = 27 或 28）
    "house": 13, "col": 4, "row": 2
  },
  "distances": { "near": [3, 4, 5, 11, 13, 21, 22, 23], "middle": [ … ], "far": [ … ] },   // 中心以外 35 格的分組；門檻在 ruleConfig（近 ≤1、中 ≤3、遠 >3）
  "directions": { "past": [9, 10, 11], "future": [13, 14, …], "conscious": [3], "subconscious": [21, 30] },
  //   同一列左邊＝過去、右邊＝未來；同一欄上方＝意識、下方＝潛意識；由近到遠排
  "surroundings": [3, 4, 5, 11, 13, 21, 22, 23],   // 中心周圍的九宮（邊緣時少於 8 格，角落 3 格）
  "houses": {                           // L7 宮位
    "center": { "index": 12, "house": 13 },                 // 中心落在第幾宮
    "theme": { "index": 2, "house": 3 },                    // 主題牌落在第幾宮；沒有主題牌或沒出現是 null
    "own": [ { "index": 14, "cardId": 15 } ]                // 落在自己宮位的牌（第 n 張牌在第 n 宮），主題特別強
  },
  "themeCard": {                        // L8 主題牌；沒有問題類型時整個是 null
    "cardId": 24, "present": true,
    "index": 2,                         // present 時是主題牌的位置；否則是它對應宮位那一格（index = cardId − 1），要顯示「主題牌未出現」
    "house": 3,
    "distance": "middle", "steps": 2,   // 和中心的距離分組與步數
    "direction": { "horizontal": "past", "vertical": "conscious" },   // past | future | same；conscious | subconscious | same
    "surroundings": [1, 3, 10, 11, 12]
  },
  "knighting": [                        // L10 騎士跳：從中心、主題牌走 L 形（橫 2 直 1、橫 1 直 2）
    { "from": "center", "origin": 12, "targets": [1, 5, 19, 23, 28, 32] },
    { "from": "theme", "origin": 2, "targets": [9, 13, 15, 22] }    // 關鍵牌那一格（沒出現時是它對應的宮位）；和中心同一格時不列這筆（mirrors 也一樣）
  ],
  "mirrors": [                          // L11 鏡射：左右（第 c 欄 ↔ 第 10−c 欄）、上下（第 r 列 ↔ 第 5−r 列）、對角（兩者都換）
    { "from": "center", "origin": 12, "leftRight": 14, "topBottom": 21, "diagonal": 23 },
    { "from": "theme", "origin": 2, "leftRight": 6, "topBottom": 29, "diagonal": 33 }
    //   第 5 欄（中間欄）左右鏡射到自己，leftRight 與 diagonal 為 null；4 列沒有中間列，topBottom 一定有
  ]
}
```

- 大藍圖其他欄位：`tone.clusters` 空陣列、`nineBox` 是 null；`combos`、`gaze`（L4）、`suits`（L9）照樣看全部 36 張；`pairs.items` 只有代表牌與主題牌的左右相鄰（`line` 為 significator／theme），`pairs.theme` 是 null。
- `significator` 大藍圖必填。`draw` 一定放入代表牌，位置隨機，其餘 35 張從剩下 51 張抽；`manual` 照使用者攤出的 36 張，不強制包含代表牌。
- 每張牌的完整牌義不在這裡，前端用 `GET /api/lenormand/cards` 快取的資料。
- 回應不存檔；保存紀錄是階段 6 的 `POST /api/lenormand/readings`。

### 3-13 紀錄 API 形狀（階段 6 定稿，前端照這一節）

全部在 `/api/lenormand` 底下（router 層已經套 `requireLenormandAccess`：未登入 401、沒開通 403）。只看得到、動得到自己的紀錄；別人的紀錄、不存在的 id、格式不對的 id 一律 404「找不到這筆紀錄。」。

**`POST /api/lenormand/readings` 保存**

```jsonc
// request：和 manual 一樣的輸入，後端重新驗證（牌號 1～52、不重複、張數等於牌陣；大藍圖要 36 張與代表牌）
{
  "question": "他喜歡我嗎",
  "spreadKey": "theme-3",
  "domain": "love",                     // 選填
  "significator": 29,                   // 選填；大藍圖必填
  "cards": [1, 24, 25],                 // 依位置順序
  "mode": "draw",                       // 選填：draw | manual，記下這次是自動抽還是自己選，預設 manual
  "narration": { "text": "…", "model": "…" }   // 選填：AI 解讀（階段 7）；text 最多 20000 字、model 最多 100 字
}
// 201
{ "id": "6745…", "createdAt": "2026-11-25T08:00:00.000Z" }
```

- 分析不收也不存，讀取時重算（和塔羅 v13 一樣）。
- 每人最多 100 筆，超過從最舊的刪，連同它們的日記。

**`GET /api/lenormand/readings?page=1&pageSize=20` 列表**（pageSize 最多 50，新到舊）

```jsonc
{
  "page": 1, "pageSize": 20, "total": 3,
  "readings": [
    {
      "id": "6745…",
      "question": "他喜歡我嗎",
      "domain": "love",
      "spreadKey": "theme-3",
      "spreadName": "三張主題牌",
      "significator": 29,               // 沒選是 null
      "cardCount": 3,
      "cards": [ { "id": 1, "nameZh": "騎士" }, { "id": 24, "nameZh": "愛心" }, { "id": 25, "nameZh": "戒指" } ],   // 前 5 張（大藍圖 36 張也只列 5 張）
      "hasNarration": false,
      "createdAt": "2026-11-25T08:00:00.000Z"
    }
  ]
}
```

**`GET /api/lenormand/readings/:id` 詳情**

回傳和 3-12 的 `draw` 完全一樣的形狀（`analysis`、`text`、`overview`、`guidance` 都是依存下來的牌號重算），另外加：

```jsonc
{
  "id": "6745…",
  "createdAt": "2026-11-25T08:00:00.000Z",
  "mode": "draw",                       // 保存時記下的 draw | manual
  "narration": { "text": "…", "model": "…", "createdAt": "…" }   // 沒有 AI 解讀是 null
  // …其餘同 3-12（deck、question、spread、significator、cards、analysis、text、overview、guidance）
}
```

**`DELETE /api/lenormand/readings/:id` 刪除** → `{ "deleted": true }`，這筆的日記一起刪。只要登入、不要雷諾曼權限（2026-11-25 使用者決定）：被收回權限的人仍可以刪掉自己的紀錄，和日記一致；別人的仍是 404。

**`GET /api/lenormand/my-data`、`DELETE /api/lenormand/my-data` 我的雷諾曼資料**（帳號設定用，只要登入，不要雷諾曼權限）

```jsonc
// GET → 自己有幾筆
{ "readings": 2, "journals": 1 }
// DELETE → 刪掉自己所有的雷諾曼紀錄與雷諾曼日記（塔羅的不動）
{ "deletedReadings": 2, "deletedJournals": 1 }
```

- 2026-11-25 使用者決定：被收回權限的人在前端看不到雷諾曼紀錄清單，改在帳號設定放一顆「刪除我的雷諾曼紀錄」，`readings + journals` 為 0 時可以不顯示。刪除前前端要先確認，刪了不能復原。

- 保存時收的 `narration` 是前端送回來的文字（和塔羅一樣）。階段 7 不能把存下來的 `narration.text` 當成可信的 AI 輸出再送給 AI，品質檢查也不能假設它來自後端。

**月曆 `GET /api/calendar?month=YYYY-MM`**（v26 的端點，新增欄位）

- `days[].readings[]` 每筆多一個 `deck`：`'tarot' | 'lenormand'`。塔羅的舊欄位不變，也補上 `deck: 'tarot'`。
- 雷諾曼的那一筆：

```jsonc
{ "id": "6745…", "deck": "lenormand", "question": "他喜歡我嗎", "spreadName": "三張主題牌", "createdAt": "…", "cards": ["騎士", "愛心", "戒指"] }
//   cards：牌名字串（沒有正逆位），最多前 5 張；塔羅仍是「愚者正」這種字串
```

- 同一天塔羅與雷諾曼混在一起，依時間新到舊，每天最多 20 筆（同 v26）。
- 沒有雷諾曼權限的人（沒開通、被收回）不列雷諾曼紀錄，也不列雷諾曼日記；紀錄本身不刪，重新開通後又看得到。
- `days[].journals[]` 的 `target` 會出現 `lenormand:<紀錄 id>`。

**日記 `/api/journal`**（v26 的端點，新增一種對象）

- `target` 多一種：`lenormand:<24 碼紀錄 id>`。
- 列表（GET）、新增（POST）、修改（PUT）雷諾曼日記都要雷諾曼權限，沒有回 403「雷諾曼功能需要管理者開通，請聯絡管理者。」；新增時那筆 `LenormandReading` 要是本人的，否則 404。
- 刪除（DELETE）自己的日記不檢查權限：被收回權限的人仍可以清掉自己的資料。

**刪除帳號**：`LenormandReading` 加進 `accountDeletion.js` 的清單，連同日記一起刪。

### 3-14 AI 解讀 API 形狀（階段 7 定稿，前端照這一節）

**`POST /api/lenormand/readings/narrate`**

權限：雷諾曼權限（router 層）＋ AI 權限（`req.user.canUseAi()`，admin 一律可以）。後端依牌號重算分析再交給 AI，不使用前端傳來的分析。

```jsonc
// request：和 manual 一樣的輸入，加上選填的 readingId
{
  "question": "他喜歡我嗎",
  "spreadKey": "theme-3",
  "domain": "love",                     // 選填
  "significator": 29,                   // 選填；大藍圖必填
  "cards": [1, 24, 25],                 // 依位置順序，規則同 manual
  "readingId": "6745…"                  // 選填：已保存的紀錄；完整產生後把解讀存回那一筆（牌號與牌陣要一致）
}
```

**開始串流前的錯誤**（一般 JSON，`{ message }`）：

| 狀態 | 情況 |
|---|---|
| 400 | 輸入不正確（同 manual） |
| 401／403 | 沒登入／沒有雷諾曼權限（「雷諾曼功能需要管理者開通，請聯絡管理者。」） |
| 403 | 有雷諾曼、沒有 AI 權限：「AI 解讀需要管理者開通，請聯絡管理者。」 |
| 429 | 今天的次數用完：「今天的雷諾曼 AI 解讀已用完（每天 30 次），明天再試。」（admin 不限） |
| 503 | 後端沒設定 AI（缺少金鑰），或資料庫沒連上（次數記在資料庫） |
| 422 | AI 拒絕產生 |

**成功：NDJSON 串流**（`Content-Type: application/x-ndjson`，一行一個 JSON，和塔羅 `/api/readings/narrate` 一樣）

```jsonc
{"type":"ping"}                         // 每 15 秒一次的心跳，前端忽略即可（靠它判斷連線還在）
{"type":"delta","text":"…"}             // 一段解讀文字（Markdown），依序接起來
{"type":"done","model":"anthropic/…","saved":true,"checks":[]}
//   saved：null＝沒帶 readingId；true＝已存回紀錄；false＝帶了但沒存成（紀錄不存在、不是本人、牌陣／牌號／代表牌／問題類型和紀錄不一致、存檔失敗）
//   checks：寫完的程式檢查（見下方），空陣列＝沒發現問題；只給前端參考，不影響顯示
{"type":"error","message":"AI 解讀中途發生錯誤，請再試一次。"}   // 串流途中失敗；這次的次數會退還
```

- 使用者按停止或關掉頁面：後端中斷對 AI 的請求、停止計費，次數照算、不存半截文字。
- 伺服器或 AI 出錯（不是使用者停止）：退還這次的次數。
- 只有完整產生的解讀才存回紀錄；重新產生會覆蓋同一筆的 `narration`。

**寫完的檢查 `checks`**（雷諾曼專用，第一版只抓明顯錯誤）

| 值 | 意思 |
|---|---|
| `orientation` | 寫出「正位／逆位」（雷諾曼沒有正逆位） |
| `tarotTerms` | 寫出塔羅才有的詞（大阿爾克那、權杖、聖杯、寶劍、錢幣這類牌組名） |
| `noSignificator` | 大藍圖沒提到代表牌（紳士／淑女或「代表牌」） |

**紀錄詳情與保存**：`GET /api/lenormand/readings/:id` 的 `narration` 多一個 `checks`（舊紀錄沒有時是空陣列）。`POST /api/lenormand/readings` 帶 `narration` 保存時，後端也會跑一次檢查。

**每日次數**：`MarketAiUsage` 的 kind 加 `lenormand`，每天 30 次，和塔羅分開計，admin 不限。管理端會員詳情的 `usage.ai` 多 `lenormandToday`、`lenormandLimit`（admin 是 null）。

**提示詞**（`src/services/lenormand/narration.js`，不在 API 形狀裡，列出來方便對照）

- 系統提示：雷諾曼專用。沒有正逆位、牌組成句子（前一張是主詞、後一張形容它）、小牌陣的位置、大藍圖的宮位／距離／騎士跳／鏡射、人物視線；撲克花色只能當輔助，不能只靠花色下結論；「關鍵牌」的用詞和畫面一致。
- 使用者訊息：現在時間（台灣時間，含星期）、問題、牌陣、每個位置的牌與關鍵詞、規則結果（L1～L5、L9；大藍圖另有 L6～L8、L10、L11）。大藍圖只附中心周圍、關鍵牌、騎士跳、鏡射落點這些牌的牌義，其他牌只列名稱與關鍵詞，控制長度。
- 推理強度：大藍圖比照 v25「大牌陣推理強度」用 `OPENROUTER_REASONING_EFFORT_LARGE`；沒設定時大藍圖用 `high`，小牌陣照一般設定。

## 四、階段與進度

| 階段 | 內容 | 狀態 |
|---|---|---|
| 0 | 使用者確認待決事項 | 完成（2026-11-25）；附錄 A 核對與 37～52 撲克對應仍待使用者 |
| 1 | 後端資料與權限：`cards.js`（含 Claude 撰寫的 52 張牌義）、`houses.js`、`spreads.js`、`playingCards.js`、`lenormandAccess`、`requireLenormandAccess`、管理端開關、`/api/lenormand/cards`、`/spreads`；資料完整性測試；請 api-reviewer 審查 | 完成（2026-11-25）；api-reviewer 無必須修 |
| 1F | 前端權限與入口：`lenormandAccess` 型別、`canUseLenormand`、路由 meta、會員選單、管理頁開關；`/lenormand` 頁先放骨架 | 完成（2026-11-25，前端 session） |
| 2 | 原創 SVG 插畫：共用牌框＋52 張主圖、`buildCardArt.js`、靜態路由 `/lenormand`、填入 `facing` | 完成（2026-11-25）；52 張 6.9～20.8KB，SVG 預先 gzip 傳送；使用者看過預覽 |
| 3 | 後端規則引擎 L1～L5、L9＋formatter＋`draw`／`manual`（小牌陣）；邊界測試 | 完成（2026-11-25）；回應形狀見 3-12；牌性初稿偏吉，使用者決定先維持現狀（見決議紀錄） |
| 4 | 前端占卜流程：共用流程抽成 composable、正逆位參數化、牌背、`LenormandAnalysisPanel`、`LenormandSuitPanel` | 完成（2026-11-25，前端 session） |
| 5 | 大藍圖：後端 L6～L8、L10、L11；前端 `GrandTableau`（距離、騎士跳、鏡射）、輸入 36 張 | 完成（2026-11-25）；`tableau` 形狀見 3-12；回應 gzip 後約 6～7KB；大藍圖 L1 改看中心周圍 |
| 6 | 紀錄：`LenormandReading`、保存、我的紀錄分頁、月曆、日記、刪帳號清單 | 完成（2026-11-25）；API 形狀見 3-13；帳號設定可刪除自己的雷諾曼資料 |
| 7 | AI 解讀：雷諾曼提示詞、每日次數、`narrationCheck`；實際呼叫前取得使用者同意 | 完成（2026-11-25，只用測試驗證）；API 形狀見 3-14；開發與測試沒有呼叫 AI；2026-11-25 使用者決定先不實測（真實費用與解讀品質尚未驗證） |

每個階段交付前跑兩邊的驗證：後端 `npm test`；前端 `npm run check:rules && npm run build && npm test`。改到路由、權限、Model 的階段請 api-reviewer 審查，改到畫面的階段照 `ui-check` 自檢。

## 五、決定事項（2026-11-25 使用者確認）

| # | 問題 | 決定 |
|---|---|---|
| D1 | 牌面圖片來源 | **原創插畫**（Claude Code 手寫 SVG，見 3-3），不先用文字占位；不使用原版插畫。原建議是文字占位再換像素風，使用者改選原創插畫 |
| D2 | 52 張怎麼用 | 所有牌陣都從 **52 張**抽；大藍圖**從 52 張選 36 張**（使用者決定，原建議是只用傳統 36 張）。代表牌、主題牌可能沒出現的處理見 3-4 |
| D3 | 大藍圖排法 | **9×4**：每列等長，距離、方位、騎士跳、鏡射的計算一致 |
| D4 | 代表牌怎麼選 | 問題步驟讓使用者選「代表我的牌」（紳士或淑女），不和帳號性別綁定；感情問題另一張人物牌當對象 |
| D5 | 權限欄位 | 獨立的 `lenormandAccess`，不重用 `aiAccess`；可以只開雷諾曼、不開 AI |
| D6 | 雷諾曼 AI 的每日次數 | 新 kind `lenormand`，每天 30 次，和塔羅分開計 |
| D7 | 紀錄存法 | 獨立 `LenormandReading`，不擴充塔羅的 `Reading` |
| D8 | 選單位置 | **頂欄右上的「占卜」改成選單**，可以選「塔羅」或「雷諾曼」；沒有雷諾曼權限的人維持原本的單一「占卜」連結。會員選單的「雷諾曼」一組只放紀錄（2026-11-25 使用者調整，原本是占卜和紀錄都放在會員選單） |
| D9 | 撲克花色 | **要解讀**（規則 L9），並在結果頁獨立一區解說（3-11） |
| D10 | 進階技法 | **要做**騎士跳（L10）與鏡射（L11） |

## 六、決議紀錄

- 2026-11-25：使用者要求新增「靜謐花園雷諾曼」卡牌系統：只給被允許的會員與 admin，要能和首頁塔羅一樣占卜，並提供說明書照片（牌陣、宮位、52 張牌義）。本計畫書據此規劃，待使用者確認待決事項。
- 2026-11-25：牌庫用靜態資料檔、不放進 `Card` collection。原因是塔羅抽牌用 `$sample` 抽整個 collection，`/api/health` 也算總張數，混放會讓塔羅抽到雷諾曼的牌。
- 2026-11-25：不使用原版插畫。理由見「不做的事」。
- 2026-11-25：使用者確認決定事項。和原建議不同的有四項：
  - 牌面直接用原創插畫（D1）。
  - 大藍圖從 52 張選 36 張（D2）。
  - 撲克花色要解讀並獨立解說（D9）。
  - 騎士跳與鏡射要做（D10）。
  - 其餘照建議。階段重排：權限前後端同時開工，原創插畫排在規則引擎之前。
- 2026-11-25：大藍圖自動抽牌一定放入代表牌，輸入實體牌則照實際牌面。理由：自動抽牌時沒有中心的大藍圖無法解讀；實體牌是使用者真的攤出來的結果，不能替使用者改，改用代表牌的宮位當中心。
- 2026-11-25：撲克花色的意思各家說法不同，查詢結果只有「紅心＝感情」「紅色偏順、黑色偏挑戰」較一致，黑桃分歧最大。解說表採常見讀法並註明差異（3-11）。
- 2026-11-25（階段 2）：牌面文字直接畫在 SVG 裡，`font-family` 寫中文襯線字型的備援清單，前端不用疊字；`<img>` 顯示時用裝置上的字型。SVG 是純文字，後端啟動時預先 gzip（557KB → 約 102KB），`gzip` 判斷和 JSON 壓縮共用 `src/lib/acceptEncoding.js`。朝向：騎士、船、孩童、鸛鳥、狗、紳士朝右；蛇、鐮刀、鳥、狐狸、熊、淑女朝左，紳士在左、淑女在右相鄰時對視。
- 2026-11-25（階段 3）：問題類型除了計畫的五種（感情＝愛心、財務＝魚、工作＝錨、健康＝樹木、家庭＝房屋），另加人際＝庭園、學業＝書，讓沿用塔羅關鍵詞的問題也有主題牌；不含股市。heuristic-check 找到的誤判（「好可愛」判成感情、「租屋」判成家庭、「家人」兩類重複）已修並補測試，例外寫在 `ruleConfig.js`。
- 2026-11-25（階段 3）：鸛鳥朝向相鄰的凶牌都算化解（字典的「鸛鳥朝向蛇」是說明書的例子，牌義寫的是朝向凶牌都適用）；被化解的凶牌在 L1、L5 當中性計算，列在 `cleansedIndexes`。朝向只看左右（同一列）。
- 2026-11-25（階段 3）：模擬 2 萬次抽牌發現，附錄 A 的牌性初稿吉牌 21 張、凶牌 11 張，三張牌陣約 54% 判成「偏順利」、20% 偏有挑戰；九宮格偏有挑戰只有 2%。原因是初稿偏吉，不是門檻。2026-11-25 使用者決定先維持現狀（不改牌性、不改門檻），之後實際用了再看。

- 2026-11-25：使用者調整入口（D8）：雷諾曼占卜從會員選單移到頂欄右上的「占卜」選單（塔羅／雷諾曼），會員選單只放紀錄。
- 2026-11-25（階段 5）：大藍圖距離用切比雪夫距離（橫、直、斜一步都算 1），近 ≤1、中 ≤3、遠 >3，門檻在 `ruleConfig.js`。方位只看同一列（左過去、右未來）與同一欄（上意識、下潛意識）。代表牌與主題牌沒出現時，中心、騎士跳、鏡射都從它對應的宮位那一格出發。L2 在大藍圖只讀代表牌與主題牌的左右相鄰。第 5 欄的左右與對角鏡射給 null（對角會和上下同一格）。
- 2026-11-25（階段 5）：模擬 3000 次大藍圖，L1 的整體傾向 91% 是「吉凶交錯」、9% 偏吉、0% 偏凶：36 張牌的吉凶會互相抵銷，整體傾向在大藍圖幾乎沒有資訊量。2026-11-25 使用者決定照建議：大藍圖的 L1 改看中心周圍（L6 的近距離牌；代表牌沒出現時是中心宮位那一格的周圍），鸛鳥化解照樣適用，小牌陣不變；`tone` 新增 `scope` 欄位（all／near），其他欄位不變。改動後同樣模擬 3000 次：吉凶交錯 50%、偏吉 40%、偏凶 7%、中性 4%（改動前 91%／9%／0%／0%）。
- 2026-11-25（階段 5）：L8 的顯示文字改叫「關鍵牌」（例如「感情的關鍵牌：24 愛心」），因為主題牌陣（theme-3／theme-5）中間的位置也叫「主題牌」，同一頁會撞名。前端提出、使用者決定，前後端統一。回應欄位名稱（`themeCard`、`knighting[].from: 'theme'` 等）不變。
- 2026-11-25（階段 6）：雷諾曼紀錄另存 `LenormandReading`（D7），另外記 `mode`（draw／manual）讓詳情頁知道當初怎麼抽的；列表與月曆只列前 5 張牌名（大藍圖 36 張不全列）。上限 100 筆沿用塔羅的 `trimHistory`（加 targetKind 參數，汰除時連同日記）。月曆與日記看 `userCanUseLenormand`：被收回權限的人看不到雷諾曼紀錄與日記，資料不刪；刪除自己的日記不檢查權限。
- 2026-11-25（階段 6）：被收回雷諾曼權限的人仍可以刪除自己的雷諾曼紀錄與日記（使用者決定），其他雷諾曼端點照樣要權限。
- 2026-11-25（階段 6）：前端沒有畫面讓被收回權限的人看到或刪除自己的雷諾曼紀錄。使用者先說維持現狀，之後改為**在帳號設定加一顆「刪除我的雷諾曼紀錄」按鈕**：後端新增 `GET`／`DELETE /api/lenormand/my-data`（只要登入，見 3-13），一次刪掉自己所有的雷諾曼紀錄與日記。
- 2026-11-25（階段 7）：雷諾曼 AI 解讀走 `POST /api/lenormand/readings/narrate`，AI 權限用 `req.user.canUseAi()`（不再串一次 `requireAiAccess`）。大藍圖的推理強度沒設 `OPENROUTER_REASONING_EFFORT_LARGE` 時用 high（塔羅的大牌陣沒設時照一般設定，兩者不同，因為使用者要求大藍圖用較高的推理）。大藍圖的提示只附中心周圍、關鍵牌、騎士跳、鏡射落點、L2 句子裡那些牌的牌義，其他牌只列名稱與關鍵詞（使用者訊息約 4500 字，上限約 5500 字）。寫完的檢查（`checks`）第一版只抓正逆位、塔羅用詞、大藍圖沒提代表牌；heuristic-check 發現「聖杯一樣」「小牌陣」會被誤判，已改成只抓「阿爾克那」與牌組名接牌組／宮廷的說法並補測試。
- 2026-11-25（階段 7）費用估算（沒有實際呼叫，用字數換算 token，中文約 1～1.3 token／字）：系統提示約 800 字（大藍圖約 1000 字）；使用者訊息三張牌約 700 字、五張約 1000 字、九宮格約 2100 字、大藍圖平均約 4500 字（最多約 5400 字）。輸出約 1000～2500 token，另加推理 token（medium 約 2000～5000、大藍圖用 high 時約 5000～15000，最不確定的一項）。以塔羅一次約 US$0.04 為基準：小牌陣（三張、五張）輸入比塔羅少，約 US$0.02～0.04；九宮格約 US$0.03～0.05；大藍圖輸入和塔羅差不多、推理較深，約 US$0.06～0.15。要知道準確數字，需要使用者同意後用 `includeUsage` 實際呼叫一次。
- 2026-11-25（階段 7）api-reviewer 後的修正：問題包在 `<question>` 裡、拿掉標籤字樣、換行壓成空白，系統提示註明問題裡的指示不執行；存回紀錄時多比對問題類型（決定關鍵牌），比對條件全放進一次 `updateOne`；檢查次數前先確認資料庫（503）；塔羅的 `requireAiAccess` 改用同一個 `userCanUseAi`。

## 附錄 A　52 張牌（依說明書轉錄）

- 「關鍵詞」依說明書照片轉錄。照片有些字很小，**請使用者對照實體說明書核對**；標「？」的是看不清楚、需要確認的字。
- 「撲克」：1～36 是傳統雷諾曼的對應，也請對照實體牌確認這副牌有沒有改動；37～52 這副牌另外補足撲克的 2～5，需要看實體牌補上。補上之前，這 16 張的 `playingCard` 先填 `null`，L9 會略過。
- 「牌性」是規則 L1 的初稿，可以調整。

| # | 牌名 | 英文 | 關鍵詞 | 撲克 | 牌性 |
|---|---|---|---|---|---|
| 1 | 騎士 | Rider | 消息、邂逅、郵包、速度、信差 | ♥9 | 中性 |
| 2 | 四葉草 | Clover | 突然的幸運、機會、幸福感 | ♦6 | 吉 |
| 3 | 船 | Ship | 旅行、冒險、外國、貿易、下一階段 | ♠10 | 中性 |
| 4 | 房屋 | House | 家庭、房間、安全的地方、私人領域 | ♥K | 吉 |
| 5 | 樹木 | Tree | 健康、成長、發展、生命 | ♥7 | 中性 |
| 6 | 雲 | Clouds | 迷濛、混亂、不清楚、妨礙 | ♣K | 凶 |
| 7 | 蛇 | Snake | 惡意、危險、背叛、智慧 | ♣Q | 凶 |
| 8 | 棺材 | Coffin | 結束、死亡、困局、停止 | ♦9 | 凶 |
| 9 | 花束 | Bouquet | 慶祝、感動、禮物 | ♠Q | 吉 |
| 10 | 鐮刀 | Scythe | 收割、一個段落、決斷、區間？ | ♦J | 凶 |
| 11 | 鞭子 | Whip | 懲罰、爭吵、疼痛、訓練 | ♣J | 凶 |
| 12 | 鳥 | Birds | 對話、八卦、社交媒體、網路 | ♦7 | 中性 |
| 13 | 孩童 | Child | 新開始、天真、不成熟、初學者 | ♠J | 吉 |
| 14 | 狐狸 | Fox | 虛偽、謊言、企圖、聰明 | ♣9 | 凶 |
| 15 | 熊 | Bear | 權力、地位、長輩、有領導力 | ♣10 | 中性 |
| 16 | 星星 | Stars | 目標、指引、希望、方向 | ♥6 | 吉 |
| 17 | 鸛鳥 | Stork | 搬家、遷移、懷孕、好兆頭 | ♥Q | 吉 |
| 18 | 狗 | Dog | 信賴、摯友、忠誠、順從 | ♥10 | 吉 |
| 19 | 塔 | Tower | 公共、政府、監視、傳統 | ♠6 | 中性 |
| 20 | 庭園 | Garden | 社交、集會、人脈、派對 | ♠8 | 吉 |
| 21 | 山 | Mountain | 障礙、挑戰、停滯、忍耐 | ♣8 | 凶 |
| 22 | 分岔路 | Crossroads | 選項、選擇、轉捩點、道路 | ♦Q | 中性 |
| 23 | 老鼠 | Mice | 損失、麻煩、疾病、偷竊 | ♣7 | 凶 |
| 24 | 愛心 | Heart | 愛情、戀愛、感覺、喜愛 | ♥J | 吉 |
| 25 | 戒指 | Ring | 契約、束縛、承諾、循環 | ♣A | 中性 |
| 26 | 書 | Book | 秘密、知識、教育、私事 | ♦10 | 中性 |
| 27 | 信件 | Letter | 訊息、情報、書面溝通、文件 | ♠7 | 中性 |
| 28 | 紳士 | Gentleman | 男問卜者、主動、戀人、陽剛 | ♥A | 中性 |
| 29 | 淑女 | Lady | 女問卜者、被動、戀人、陰柔 | ♠A | 中性 |
| 30 | 百合 | Lily | 成熟、純粹、老年、性愛 | ♠K | 吉 |
| 31 | 太陽 | Sun | 成功、幸福、能量、活力 | ♦A | 吉 |
| 32 | 月亮 | Moon | 名聲、浪漫、直覺、陰晴圓缺 | ♥8 | 中性 |
| 33 | 鑰匙 | Key | 解答、重要、關鍵、突破 | ♦8 | 吉 |
| 34 | 魚 | Fish | 豐富、金錢、資產、流動 | ♦K | 吉 |
| 35 | 錨 | Anchor | 穩定、認真、頑固、信念 | ♠9 | 中性 |
| 36 | 十字架 | Cross | 負擔、責任、磨難、犧牲 | ♣6 | 凶 |
| 37 | 蓮花 | Lotus | 純淨、因果、重生、平靜 | 待補 | 吉 |
| 38 | 影子 | Shadow | 隱藏、陰暗面、過去的影響、潛意識 | 待補 | 凶 |
| 39 | 森林 | Forest | 迷惘、自然、複雜性、尋找指引 | 待補 | 中性 |
| 40 | 沙漏 | Hourglass | 等待、耐心、時限、當下 | 待補 | 中性 |
| 41 | 面具 | Mask | 偽裝、防衛、派對、身份 | 待補 | 凶 |
| 42 | 香水 | Perfume | 魅力、吸引力、記憶、個人風格 | 待補 | 吉 |
| 43 | 齒輪 | Gears | 合作、動力、團隊、運行 | 待補 | 中性 |
| 44 | 棋子 | Chess | 策略、計劃、博弈、競爭 | 待補 | 中性 |
| 45 | 牆 | Wall | 保護、隔離、孤立、界限 | 待補 | 中性 |
| 46 | 鏡子 | Mirror | 反思、真實、誠實、內心觀察 | 待補 | 中性 |
| 47 | 沙發 | Couch | 放鬆、舒適、悠閒、聯繫 | 待補 | 吉 |
| 48 | 音樂 | Music | 和諧、創造力、表達、藝術 | 待補 | 吉 |
| 49 | 蝴蝶 | Butterfly | 蛻變、輕盈、優雅、短暫 | 待補 | 吉 |
| 50 | 橋 | Bridge | 連結、過渡、調解、克服障礙 | 待補 | 吉 |
| 51 | 翼 | Wings | 自由、飛越、解脫、升華 | 待補 | 吉 |
| 52 | 鑽石 | Diamond | 價值、長久、潛力、獨特、稀有 | 待補 | 吉 |

## 附錄 B　三十六宮位（依說明書）

宮位編號與傳統牌號相同。牌落在第 n 宮時，讀成「這張牌 × 該宮主題」。

| 宮 | 牌 | 主題 | 宮 | 牌 | 主題 | 宮 | 牌 | 主題 |
|---|---|---|---|---|---|---|---|---|
| 1 | 騎士 | 消息 | 13 | 孩童 | 新開始 | 25 | 戒指 | 契約 |
| 2 | 四葉草 | 幸運 | 14 | 狐狸 | 心機 | 26 | 書 | 知識 |
| 3 | 船 | 遠行 | 15 | 熊 | 權力者 | 27 | 信件 | 情報 |
| 4 | 房屋 | 家庭 | 16 | 星星 | 目標 | 28 | 紳士 | 本人／對象 |
| 5 | 樹木 | 健康 | 17 | 鸛鳥 | 遷移 | 29 | 淑女 | 本人／對象 |
| 6 | 雲 | 遮蔽 | 18 | 狗 | 信任 | 30 | 百合 | 性／成熟 |
| 7 | 蛇 | 惡意 | 19 | 塔 | 公共 | 31 | 太陽 | 成功 |
| 8 | 棺材 | 結束 | 20 | 庭園 | 社交 | 32 | 月亮 | 名聲 |
| 9 | 花束 | 慶祝 | 21 | 山 | 障礙 | 33 | 鑰匙 | 解決方法 |
| 10 | 鐮刀 | 決斷 | 22 | 分岔路 | 選擇 | 34 | 魚 | 豐富 |
| 11 | 鞭子 | 懲罰 | 23 | 老鼠 | 損失 | 35 | 錨 | 穩定／工作 |
| 12 | 鳥 | 對話 | 24 | 愛心 | 愛情 | 36 | 十字架 | 背負 |
