# v12　註冊、登入與權限（JWT）

建立日期：2026-10-19
狀態：階段 1～5 已實作完成（2026-10-19），階段 6（占卜紀錄）未開始

前一版 v11（牌對改寫）暫停，未完成清單見 `doc/v11-tarot-pair-voice-plan.md` 第 12 節。

## 一、目標

把現在「誰來都一樣」的站台，改成有身分的站台：

- 簡易註冊、登入（email ＋ 密碼）
- 以 JWT 帶身分，前後端都認得
- 三種角色：**未登入者（guest）**、**會員（member）**、**管理者（admin）**
- 前台（占卜畫面）與後台（管理頁）都吃同一套權限

**不做的事**（這一版不碰，避免範圍膨脹）：
第三方登入、忘記密碼寄信、email 驗證、refresh token 輪替、多裝置登出、
密碼強度儀表、驗證碼。這些要做會另開 v13。

## 二、角色與權限

| 功能 | guest | member | admin |
|---|---|---|---|
| 看首頁、選牌陣、抽牌 | ✅ | ✅ | ✅ |
| 牌義、規則引擎的組合分析 | ✅ | ✅ | ✅ |
| **AI 解讀**（`/api/readings/narrate`） | ❌ | 需開通 | ✅ |
| **占卜紀錄**（存檔、看歷史） | ❌ | ✅ | ✅ |
| 管理頁 `/routes`、會員列表 | ❌ | ❌ | ✅ |

### 兩個決議

1. **guest 可以完整玩一輪占卜**（抽牌＋規則分析），只有 AI 解讀和紀錄要登入。
   這同時把 AI 費用綁在帳號上，之後要加配額才有對象可以算。
   **（2026-10-19 修正）AI 解讀再收緊一層：登入還不夠，要 admin 或被 admin 開通的 member。**
   `User.aiAccess` 預設 `false`，admin 不看這個欄位一律放行。
   判斷每次都回資料庫（`requireAiAccess`），所以收回權限後舊 token 立刻失效，不必等他重新登入。
   開通介面在 `/admin/users`，API 是 `PATCH /api/admin/users/:id/ai-access`，body `{ allowed: boolean }`。
2. **admin 不自助註冊**。註冊一律給 member，要變 admin 用指令
   （`npm run user:promote -- <email>`）直接改資料庫。這一版不做後台改角色的 UI。

## 三、相依套件（已確認要裝）

後端新增兩個：

```
npm install jsonwebtoken bcrypt
```

- `jsonwebtoken`：簽發與驗證 HS256 token
- `bcrypt`：密碼雜湊（cost 10）

前端**不新增套件**，用現有的 `fetch` 與 vue-router 就夠。

> 注意：`bcrypt` 有原生編譯，Render 第一次部署會比較久。如果 Render 上裝不起來，
> 改用純 JS 的 `bcryptjs`，介面一樣，只要換 require 的名字。

## 四、資料模型

新增 `src/models/User.js`：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `email` | String | 必填、unique、存小寫去頭尾空白 |
| `passwordHash` | String | 必填，bcrypt 結果，**絕不回傳給前端** |
| `displayName` | String | 預設取 email 的 @ 前面那段 |
| `role` | String | `'member' \| 'admin'`，預設 `'member'` |
| `createdAt` / `updatedAt` | Date | `timestamps: true` |

第二階段再加 `src/models/Reading.js`（占卜紀錄）：
`userId`、`spreadId`、`domain`、`question`、`cards`（牌 id ＋正逆位）、
`analysis`（結構化結果）、`narration`（AI 文字，可能沒有）、`createdAt`。

**不存前端傳來的分析文字**——照 CLAUDE.md 的規矩，存牌 id 與正逆位，
要顯示時由後端重算。`narration` 是例外，因為它不可重算（會再花一次錢）。

## 五、JWT 規格

```js
// payload，故意只放最小集合
{ sub: '<userId>', role: 'member', iat, exp }
```

- 演算法 HS256，密鑰讀 `process.env.JWT_SECRET`
- 有效期 `7d`（這一版不做 refresh token；過期就重新登入）
- **啟動時檢查**：沒有 `JWT_SECRET` 就直接 `process.exit(1)`，不要給預設值。
  有預設值的密鑰等於沒有密鑰。
- 角色放在 token 裡是為了省一次查詢，但**管理者路由仍要回資料庫確認 role**，
  因為 token 簽發後使用者被降權的話，token 裡的 role 是舊的。

## 六、後端 API

新增 `src/routes/auth.js`，在 `server.js` 用 `app.use('/api/auth', authRouter)` 掛上。

> `CLAUDE.md` 現在寫「`src/server.js`：所有路由」。這一版開始拆檔，
> 實作完要同步改那一行。

| 方法 | 路徑 | 權限 | 說明 |
|---|---|---|---|
| POST | `/api/auth/register` | 公開 | email ＋ password，成功直接回 token（註冊後免再登入） |
| POST | `/api/auth/login` | 公開 | 回 token ＋ user |
| GET | `/api/auth/me` | 需登入 | 用 token 換目前使用者，前端重新整理時用來復原登入狀態 |
| GET | `/api/admin/users` | admin | 會員列表（email、displayName、role、aiAccess、createdAt），分頁 |
| PATCH | `/api/admin/users/:id/ai-access` | admin | 開通／收回 AI 解析；對 admin 呼叫回 409（本來就有權限） |

回傳格式統一：

```json
{ "token": "<jwt>", "user": { "id": "...", "email": "...", "displayName": "...", "role": "member" } }
```

### 驗證規則

- email：基本格式檢查、長度 ≤ 254、存成小寫
- 密碼：長度 8～72（bcrypt 上限 72 bytes）
- **錯誤訊息不要洩漏帳號存不存在**：登入失敗一律回
  「email 或密碼不正確」，不要分成「查無此帳號」「密碼錯誤」
- 註冊撞 email：回 409，訊息「這個 email 已經註冊過了」
- 簡易防爆破：同一 IP 對 `/api/auth/login` 每分鐘最多 10 次，
  用記憶體裡的 Map 計數即可，不裝套件（單機部署夠用，之後要擴就換 Redis）

## 七、中介層

新增 `src/middleware/auth.js`，三個函式：

| 函式 | 行為 |
|---|---|
| `optionalAuth` | 有 token 就解析並掛上 `req.user`，沒有或無效也放行 |
| `requireAuth` | 沒有有效 token 回 401 |
| `requireAdmin` | 先 `requireAuth`，再回資料庫確認 `role === 'admin'`，否則 403 |
| `requireAiAccess` | 同上，條件改成 `role === 'admin' \|\| aiAccess === true`，否則 403 |

套用到既有路由：

- `/api/readings/narrate` 加 `requireAiAccess` ← **這一版唯一會改到現有行為的地方**
- `/api/readings/draw`、`/api/readings/manual` 加 `optionalAuth`，
  有登入就順便存一筆 Reading（第二階段）
- 其餘維持公開

## 八、前端

### 8.1 新增檔案

| 檔案 | 用途 |
|---|---|
| `src/lib/auth.ts` | token 的存取（localStorage，key 用 `tarot_token`）、目前使用者的 reactive 狀態、`login` / `register` / `logout` / `restore` |
| `src/pages/LoginView.vue` | 登入 |
| `src/pages/RegisterView.vue` | 註冊 |
| `src/pages/AdminUsers.vue` | 會員列表（admin） |

不引入 Pinia——這個站只有一個全域狀態，用 `reactive` 包一層匯出就夠了，
不值得多一個套件和一層概念。

### 8.2 token 怎麼帶（已確認：localStorage ＋ Authorization header）

改 `src/lib/api.ts` 的 `request()`：

```ts
const token = getToken()
headers: {
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
  ...(options?.headers || {}),
}
```

**401 一律自動登出**：`request()` 收到 401 就清掉 token、把使用者狀態歸零，
並導回登入頁。token 過期是最常見的 401，不處理的話畫面會卡在半登入狀態。

`streamNarration` 走的是另一條路（SSE / fetch stream），**要記得也加 header**，
很容易漏掉——它正好是唯一需要登入的既有 API。

### 8.3 路由守衛

`src/router/index.ts` 的每一筆路由加 `meta`：

```ts
{ path: '/login', component: LoginView, meta: { guest: true } },
{ path: '/routes', component: RoutesAdmin, meta: { role: 'admin' } },
{ path: '/admin/users', component: AdminUsers, meta: { role: 'admin' } },
```

`router.beforeEach`：

1. 第一次進站先 `await restore()`（用 token 打 `/api/auth/me`），
   **沒有這一步，重新整理後守衛會誤判成未登入**，把 admin 踢出去
2. `meta.role` 不符 → 導回首頁（不是登入頁；他已經登入了，問題是權限不夠）
3. `meta.auth` 且未登入 → 導登入頁，並把原本要去的路徑記在 query 裡，登入後導回

### 8.4 畫面上的呈現

- 右上角：未登入顯示「登入／註冊」，登入後顯示 displayName ＋ 登出
- AI 解讀按鈕：未登入時**不要隱藏**，顯示成可以點、點了提示「登入後可用」，
  再導到登入頁。隱藏會讓使用者不知道有這個功能
- 沿用既有樣式：`bg-white/5`、`border-white/10`、`rounded-[1.75rem]`、amber／rose 點綴

### 8.5 和現有 RoutesAdmin 的關係

`src/pages/RoutesAdmin.vue` 已經有 `permission: 'public' | 'private'` 欄位，
但目前只是表單上的值、沒有實際效果。這一版把它接上：`private` 的動態路由
等同 `meta.auth = true`。`/routes` 本身改成只有 admin 進得去。

## 九、環境變數

後端 `.env` 新增（同步更新 `.env.example`，只放佔位符）：

```
JWT_SECRET=
```

產生方式：`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`

前端不需要新變數。

**Render 上也要設 `JWT_SECRET`**，而且要和本機不同。忘了設的話後端會直接啟動失敗
（這是刻意的，比帶著預設密鑰上線好）。

## 十、測試（`npm test`，node:test）

新增 `test/auth.test.js`，不連真的資料庫，把 model 的呼叫抽成可注入的參數：

1. 密碼雜湊後不等於原文、`compare` 對得起來
2. 簽出來的 token 解得開，payload 的 `sub`、`role` 正確
3. 過期 token 驗證失敗
4. 被竄改過的 token（改 payload 不改簽章）驗證失敗
5. `requireAdmin` 對 member 的 token 回 403
6. 登入失敗的訊息不區分「帳號不存在」與「密碼錯誤」

前端沒有測試框架，用 `npm run build` 做型別檢查。

## 十一、實作順序

| 階段 | 內容 | 驗收 |
|---|---|---|
| 1 | 後端：User model、`src/lib/jwt.js`、middleware、`/api/auth/*`、測試 | `npm test` 通過 |
| 2 | 後端：`requireAuth` 套到 narrate、`/api/admin/users` | 測試通過 |
| 3 | 前端：`auth.ts`、api.ts 帶 header、401 自動登出 | `npm run build` 通過 |
| 4 | 前端：登入／註冊頁、右上角狀態、路由守衛 | 手動走一次註冊→登入→重新整理→登出 |
| 5 | 前端：AdminUsers 頁、`/routes` 收進 admin | 用 member 帳號確認進不去 |
| 6 | 第二階段：Reading model、存紀錄、歷史頁 | 另開章節 |

階段 1～5 是「簡易註冊登入」的完整範圍，階段 6（占卜紀錄）可以之後再做——
但權限表上「guest 不能有紀錄」這條，在階段 6 做完之前是空的承諾。

## 十二、要小心的地方

1. **`npm run dev` 的伺服器是使用者的**。驗證一律用 `npm test` 和 `npm run build`，
   真的要開伺服器就用 4100／5180，結束自己 `taskkill /PID <pid> /T /F`。
2. **不要把 `passwordHash` 寫進任何回應**。Mongoose 查詢統一加
   `.select('-passwordHash')`，或在 schema 設 `select: false`。
3. **CORS**：後端現在是 `app.use(cors({ origin: clientUrl }))`。
   用 Authorization header 不需要 `credentials: true`，維持現狀即可。
4. **型別跟著後端走**：`src/types.ts` 加 `AuthUser`、`AuthResponse`，
   新欄位設可選（`?`），因為 Render 上的後端可能還是舊版。
5. **不要自行呼叫 `/api/readings/narrate` 做測試**，那會花錢。
   要驗證 `requireAuth` 有沒有生效，用 `npm test` 測 middleware，不要打真的 API。

## 十三、決議紀錄

| 日期 | 決議 |
|---|---|
| 2026-10-19 | 裝 `jsonwebtoken` ＋ `bcrypt`，不自己用 crypto 實作 |
| 2026-10-19 | token 放 localStorage，用 Authorization header 帶，不用 httpOnly cookie |
| 2026-10-19 | guest 可以完整占卜（含規則分析），只有 AI 解讀與紀錄需要登入 |
| 2026-10-19 | AI 解析再收緊：只有 admin 或被 admin 開通的 member 能用，`aiAccess` 預設關閉 |
| 2026-10-19 | 權限一律回資料庫判斷，不信 token 裡的 role／aiAccess，收回後即時生效 |
| 2026-10-19 | admin 不自助註冊，用指令升權 |
| 2026-10-19 | 不引入 Pinia，前端狀態用 reactive 自己包 |

## 十四、進度

| 階段 | 狀態 | 驗證方式 |
|---|---|---|
| 1　後端 auth 基礎 | **完成** | `npm test` 95 筆全過（其中 9 筆是 auth） |
| 2　既有路由套權限 | **完成** | 4100 實測：narrate 未登入回 401、admin 用 member token 回 403 |
| 3　前端 token 串接 | **完成** | `npm run build`（vue-tsc）通過 |
| 4　登入／註冊頁與守衛 | **完成** | 同上；**還沒在瀏覽器實際點過** |
| 5　admin 頁面 | **完成** | API 端實測 200、不含 passwordHash；畫面未實際開過 |
| 6　占卜紀錄 | 未開始 | — |

### 2026-10-19 實作後的補充

- `bcrypt@6` 在本機 Windows 裝得起來，不必換 `bcryptjs`。Render 要再看一次。
- `.env` 已補上 `JWT_SECRET`（本機用，隨機產生）；`.env.example` 也加了佔位符。
  **Render 上要另外設一組不同的值**，沒設的話後端會直接退出。
- 實測用的是另一個資料庫 `tarot-auth-smoke`（跑完已刪除），
  正式的 `tarot-divination` 沒有被寫入任何測試帳號。
- `findUserById` 會先檢查 ObjectId 合法性，否則偽造的 token 會讓 mongoose 丟 CastError 變成 500。
- `createAuthRouter` 的 `Users` 可注入，測試因此不必連資料庫。
- **結果頁去登入不會掉資料**：HomeView 把步驟 3 的結果（牌、問題、領域、已產生的 AI 文字）
  存進 `sessionStorage` 的 `tarot_result_snapshot`，登入回來或重新整理都原樣還原，
  兩小時後失效，按「重新開始」或「重抽」會清掉。沒有這層的話，從結果頁點登入等於整輪重抽。
- **AI 權限的畫面有三態**：未登入（按鈕可點，導去登入）、已登入未開通（不給按鈕，顯示
  「AI 解讀尚未開通」）、可用（正常按鈕）。前端的 `canUseAi` 只決定顯示，放行與否仍由後端判斷。
- **已登入者的 `aiAccess` 只在載入時更新**（`restore()` 打 `/api/auth/me`）。
  被開通的人要重新整理頁面才看得到按鈕；沒重整就按，後端會回 403 並顯示原因。
- 還沒做：瀏覽器端的完整手動走查（註冊→登入→重新整理→登出→用 member 進 /routes）。
