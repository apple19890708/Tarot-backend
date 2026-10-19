# 塔羅組合規則：修正計畫書

- 建立日期：2026-10-07
- 適用專案：Tarot-backend

## 目標

在現有抽牌 API 中加入「牌組合分析」：先用規則引擎算出結構化的判定結果，再用中性語氣的文字模板組成輸出。輸出順序為：

1. 整體主題
2. 逐組分析
3. 矛盾點與不確定性

規則引擎同時支援現有牌陣，以及之後的自由抽牌系統。

---

## 階段 0：資料庫固定連 `tarot-divination`（已完成）

### 背景

`MONGO_URI` 沒有寫資料庫名稱時，Mongoose 會預設使用 `test`。目前 Atlas 上 `test.cards` 有 78 筆資料，代表曾經用這種 URI 執行過 seed。

### 已完成的修改

| 檔案 | 修改 |
|---|---|
| `src/server.js` | `mongoose.connect` 加上 `dbName`，預設 `tarot-divination`，可用 `MONGO_DB_NAME` 覆蓋 |
| `scripts/seedCards.js` | 同上 |
| `.env.example` | 新增 `MONGO_DB_NAME=tarot-divination` |

`dbName` 選項的優先權高於 URI 裡的資料庫名稱，所以不管 URI 怎麼寫，都會連到 `tarot-divination`。

### 部署檢查清單

- [ ] 在 Atlas 確認 `tarot-divination.cards` 有 78 筆完整資料。如果不足，要先補資料（seed 讀取的原始牌卡文字檔不在本 repo 內）
- [ ] 推上 GitHub，讓 Render 重新部署
- [ ] 呼叫 `/api/health`，確認 `database.ready: true`、`cardCount: 78`
- [ ] 確認線上正常後，再刪除 `test` 資料庫

---

## 階段 1：靜態牌卡屬性資料

新增 `src/data/cardAttributes.js`，以 `nameEn` 對應每張牌。

不用編號對應，因為不同版本的力量／正義是 8 號還是 11 號不一致。這份是靜態資料，不改資料庫結構，也不用重新 seed。

### 1.1 花色元素

| 花色 | `suit` 值 | 元素 | 領域 |
|---|---|---|---|
| 權杖 | `wands` | 火 | 行動 |
| 聖杯 | `cups` | 水 | 情感 |
| 寶劍 | `swords` | 風 | 思維 |
| 錢幣 | `pentacles` | 土 | 物質 |

### 1.2 大牌元素（金色黎明體系，一張一個主要元素）

| 元素 | 大牌 |
|---|---|
| 火 | 皇帝、力量、命運之輪、節制、塔、太陽、審判 |
| 水 | 女祭司、戰車、吊人、死神、月亮 |
| 風 | 愚者、魔術師、戀人、正義、星星 |
| 土 | 皇后、教皇、隱士、惡魔、世界 |

### 1.3 牌義極性（暫不使用）

原規劃為 78 張牌各標一個極性（`positive`、`negative`、`neutral`）。依決議，這一版先不使用，規則 4 中依賴極性的判定一併延後，詳見規則 4。

### 1.3.1 大牌元素的比對順序

1. `nameEn` 正規化後比對（去掉開頭的 `The`、只留英文字母、轉小寫；Judgement / Judgment 都支援）
2. `nameZh` 比對
3. 編號比對（力量、正義因版本不同而排除）
4. 都比不到時，元素記為未知，並列入 `uncertainties`

### 1.4 數字主題

| 數字 | 主題 |
|---|---|
| 1 | 開始 |
| 2 | 抉擇、平衡 |
| 3 | 成長、合作 |
| 4 | 穩定 |
| 5 | 衝突 |
| 6 | 和諧、回復 |
| 7 | 考驗、反思 |
| 8 | 推進、掌控 |
| 9 | 臨界、獨立 |
| 10 | 完成或過載 |

#### 1.4.1 大牌的數字（2026-10-07 新增）

- 0（愚者）：主題為「起點、未知」
- 1～10：直接套用上表
- 11～21：各位數相加化簡後套用上表，例如 13 → 4、19 → 10、21 → 3
- 宮廷牌不套用數字主題
- 大牌編號以資料庫的 `number` 為準。力量／正義在不同版本是 8 或 11，化簡結果會不同（8 或 2）
- 化簡結果目前只提供給 AI 解讀使用，**不影響**規則 2 的「同數字強調」統計，也不影響規則 4 的數字遞進判定（兩者仍用原始編號）

### 1.5 宮廷階級

從 `nameEn` 判斷 `Page`、`Knight`、`Queen`、`King`。

---

## 階段 2：規則引擎

新增 `src/services/combinationRules.js`。

- **輸入**：一串有順序的牌（含正逆位）、問題文字
- **輸出**：結構化的判定結果，不產生文章

現有牌陣與之後的自由抽牌共用同一個引擎。

### 規則 1：元素互動

| 關係 | 組合 | 判定 |
|---|---|---|
| 友好 | 火＋風、水＋土 | 增強 |
| 對立 | 火＋水、風＋土 | 削弱或衝突 |
| 中性 | 火＋土、風＋水 | 中性 |
| 同元素（新增） | 同元素兩張 | 增強，可能過度 |

逆位降級：依決議不採用。

### 規則 2：數字與花色

- 同數字出現 2 張以上：該數字主題被強調
- 同花色出現 3 張以上：該領域主導
- 缺少某花色：該領域目前不是重點。所有牌陣都要判定
- 宮廷牌不算進數字統計。同階級出現 2 張以上時，另外標註為「強調」

### 規則 3：大牌與小牌的權重

- 計分：大牌 3 分、宮廷牌 2 分、數字牌 1 分
- **佔比用張數算**：
  - 大牌張數超過總張數一半：議題由外在或命運層面主導
  - 其他情況：議題偏日常，由個人可控
- **分數只用來排焦點牌**：分數最高的牌放在整體主題的開頭講。同分時取順序較前面的那張

### 規則 4：相鄰牌影響

- 依牌的順序（由左至右），每相鄰兩張配對一次
- 原定判定優先序：元素關係，其次牌義極性，最後是數字進程
- **本版因極性暫不使用，優先序為：元素關係 → 數字進程**

| 關係 | 判定條件 |
|---|---|
| 增強 `enhance` | 元素友好或同元素（同元素加註「可能過度」） |
| 削弱 `weaken` | 元素對立 |
| 因果 `cause` | 元素為中性，且數字遞進 |
| 中性 `neutral` | 元素為中性，且數字沒有遞進 |
| 轉折 | 依賴極性，延後到有極性資料後再加入 |

- 數字遞進的定義：兩張都是數字牌（不限花色）或兩張都是大牌，且後一張的編號等於前一張加 1
- 同花色一定同元素，所以會先判為「增強」。此時數字遞進改為附加標記 `numberProgression`，不另外判定為因果
- 每組配對另外附加標記：`sameElement`、`numberProgression`、`orientationChange`（正逆位不同）
- 逆位不反轉極性：依決議不採用
- **矛盾點（`conflicts`），在沒有極性的情況下改用以下兩種**：
  - `enhanceWithBlocked`：元素互相增強，但其中一張是逆位（受阻）
  - `focusOpposesDominantSuit`：焦點牌的元素與主導花色的元素對立
- 套用範圍：
  - 現有牌陣：照位置順序套用
  - 自由抽牌：照抽出的順序套用

### 規則 5：宮廷牌

角色判定的優先序：人物 > 性格或行動方式 > 事件。

| 問題情境 | 判定 |
|---|---|
| 問題文字包含涉及他人的關鍵詞 | 人物 |
| 問題文字不包含這類關鍵詞 | 性格或行動方式 |
| 問題是空的 | 性格或行動方式，同時記入 `uncertainties` |

關鍵詞初版：他、她、對方、主管、老闆、同事、伴侶、男友、女友、男朋友、女朋友、老公、老婆、家人、朋友、客戶。

比對前會先移除「其他」，避免「換其他工作」這類問題被誤判為涉及他人。

### 規則 6：逆位處理

- 逆位視為牌義受阻、內化、延遲或過度，不是單純的相反意思
- 牌義文字沿用資料庫的「逆位牌義」

---

## 階段 3：輸出與 API

| 檔案 | 職責 |
|---|---|
| `src/services/combinationRules.js` | 規則引擎，只產生結構化結果 |
| `src/services/analysisFormatter.js` | 把結構化結果組成中性文字 |
| `src/services/readingService.js` | 呼叫上面兩者，把 `analysis` 加進回傳 |

### 相容性

保留現有回傳欄位 `overview`、`guidance`、`cards`，現有前台不受影響。

### 新增 `analysis` 物件

```json
{
  "analysis": {
    "theme": {
      "focusIndex": 0,
      "dominance": "fate | personal",
      "emphasizedNumbers": [{ "number": 4, "count": 2, "theme": "穩定" }],
      "emphasizedCourtRanks": [{ "rank": "knight", "count": 2 }],
      "dominantSuits": [{ "suit": "wands", "count": 3 }],
      "missingSuits": ["swords"],
      "dominantElements": ["fire"],
      "text": "..."
    },
    "pairs": [
      {
        "from": 0,
        "to": 1,
        "relation": "enhance | weaken | cause | neutral",
        "relationLabel": "增強",
        "elementRelation": "same | friendly | opposed | neutral | null",
        "tags": ["sameElement", "numberProgression", "orientationChange"],
        "text": "..."
      }
    ],
    "courts": [
      { "index": 2, "rank": "queen", "suit": "cups", "role": "person | trait", "text": "..." }
    ],
    "conflicts": [{ "type": "enhanceWithBlocked", "from": 0, "to": 1, "text": "..." }],
    "uncertainties": [{ "type": "courtRoleWithoutQuestion | unknownElement", "text": "..." }],
    "stats": {
      "total": 4,
      "majorCount": 0,
      "courtCount": 0,
      "pipCount": 0,
      "reversedCount": 0,
      "suitCounts": {},
      "numberCounts": {},
      "courtRankCounts": {},
      "elementCounts": {}
    }
  }
}
```

### 執行流程

1. 逐張讀取牌義與正逆位
2. 統計權重、花色、數字分布
3. 套用元素與數字規則，找出整體主題
4. 做相鄰配對分析
5. 判定宮廷牌角色
6. 輸出中性分析：整體主題，其次是逐組分析，最後是矛盾點與不確定性

### 其他

- 文字使用中性語氣的模板，不給建議或結論
- 正逆位的抽法改為可以從外部傳入的函式，方便測試時固定結果

---

## 階段 4：自由抽牌（之後再做，先預留）

- 新增端點 `POST /api/readings/free`，參數為 `count` 與 `question`
- 直接把規則引擎的輸出包成 `analysis` 回傳
- 前台增加「牌陣／自由抽牌」切換

---

## 階段 5：測試

- 使用 Node 內建的 `node:test`，不新增套件。`package.json` 加入 `test` 指令
- 用固定的牌組測試規則的邊界：
  - 大牌剛好佔一半（不算外在主導）
  - 同元素且含逆位
  - 宮廷牌搭配空的問題
  - 元素與極性判定矛盾
  - 同數字 2 張、同花色 3 張、缺少花色

---

## 後續擴充

組合分析的第二版（問題領域對照、牌陣位置、數字階段、權重分析）另見 `doc/v02-tarot-combination-rules-plan.md`。

---

## 決議紀錄（2026-10-07）

| # | 項目 | 決議 |
|---|---|---|
| 1 | 78 張牌的極性表 | 先不使用 |
| 2 | 數字主題 2、3、6、7、8、9 的用詞 | 採用 1.4 節 |
| 3 | 逆位降級（規則 1） | 先不使用 |
| 4 | 逆位不反轉極性（規則 4） | 先不使用 |
| 5 | 大牌編號如何套用數字主題 | 各位數相加化簡，愚者 0 另定「起點、未知」（1.4.1 節） |
| 6 | `pentacles` 的中文名稱 | 統一為「錢幣」，與資料庫牌名一致（seed 解析器的來源資料夾名稱「星幣」不變） |

## 進度

| 階段 | 狀態 |
|---|---|
| 0 資料庫連線 | 程式已改，待部署驗證 |
| 1 靜態牌卡屬性 | 已完成（`src/data/cardAttributes.js`） |
| 2 規則引擎 | 已完成 |
| 3 輸出與 API | 已完成，前台已顯示 `analysis`（收在「查看判斷依據」） |
| 4 自由抽牌 | 未開始 |
| 5 測試 | 已完成（`test/combinationRules.test.js`，`npm test`） |

## 待驗證

- 資料庫中 78 張牌的 `nameEn`／`nameZh` 是否都能對到大牌元素、宮廷階級。可呼叫抽牌 API，檢查 `analysis.uncertainties` 是否出現 `unknownElement`
