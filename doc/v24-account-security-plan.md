# v24　帳戶會員安全與 SEO

建立日期：2026-11-17
狀態：階段 1～4 已實作（2026-11-17），待部署後線上確認

## 一、目標

1. **帳戶會員安全**：先堵住會讓帳號被別人用、或讓 AI 費用失控的洞，再讓會員自己管得到自己的帳號，最後補上註冊驗證信箱與管理者的第二道保護（階段 1～3）。
2. **SEO**：讓搜尋引擎找得到、分享到 LINE／Facebook 時有標題和預覽圖（階段 4，主要改前端，見第六節）。2026-11-17 使用者追加。

起因：2026-11-17 使用者要求檢查帳戶會員安全。檢查結果：基礎已經做對（見 2.0），沒看到可以直接被利用的大洞，但有 Google 合併帳號、限速、AI 用量、自助功能四類缺口。

### 不做的事

- 不加 refresh token、不把 token 改放 httpOnly cookie。前端在 GitHub Pages、後端在 Cloud Run，跨網域 cookie 要動到 CORS 與 SameSite，範圍太大；改用 CSP（規格 3.3）降低 token 被偷的風險。
- 不做一般會員的兩步驟驗證，只做管理者（規格 3.2）。
- 不做登入裝置清單（哪台電腦登入過、個別登出）。現有的「登出所有裝置」先夠用。
- 不做 IP 黑名單、驗證碼（CAPTCHA）。
- 資料庫備份不寫程式，由使用者到 MongoDB Atlas 確認（見第五節）。
- SEO 不改成伺服器渲染（SSR／Nuxt）、不搬離 GitHub Pages；只做靜態的 meta、每頁一份 HTML 與網站地圖（見第六節）。
- SEO 不讓登入後才看得到的頁面（我的紀錄、股市追蹤、管理頁）被收錄，也不收錄個人的占卜結果。

## 二、規格

### 2.0 已經做對、這一版不改的

- 密碼用 bcrypt 雜湊；`JWT_SECRET` 沒設定伺服器不啟動。
- token 帶版本號（`tokenVersion`）：重設密碼、管理者停用、登出所有裝置都會讓舊 token 立刻失效。
- 忘記密碼：重設連結只存 SHA-256 雜湊、30 分鐘過期、用過作廢、5 分鐘內不重寄；連結網址只從環境變數來。
- 每次請求都回資料庫確認帳號狀態，不信 token 裡的角色；管理操作記在 `AdminLog`。
- 會員資料：抽查紀錄、追蹤清單、價位提醒、個股分析的讀寫，條件都帶 `user: req.auth.userId`，拿別人的 id 查不到。
- AI 文字一律經過 DOMPurify；排程密鑰用 `timingSafeEqual` 比對；前後端 `npm audit` 0 個漏洞（2026-11-17）。

### 階段 1：堵住會出事的地方（純後端）

**1-1. Google 登入合併帳號時清掉未驗證的密碼**
- 問題：註冊不驗證信箱。攻擊者可以先用別人的信箱加一組密碼註冊；本人之後用 Google 登入時，`routes/auth.js` 會把 googleId 綁到這個帳號，攻擊者的密碼仍然有效，看得到本人的紀錄與持股。
- 做法：User 新增 `emailVerified`（Boolean）。Google 登入、重設密碼成功（收得到信就代表信箱是他的）時設為 true。
  Google 要綁到一個 `emailVerified` 不是 true、而且有密碼的帳號時：清掉 `passwordHash`、`tokenVersion` 加 1（所有裝置登出），再綁上 googleId。本人之後要用密碼登入，走忘記密碼設一組。
- 舊帳號沒有 `emailVerified`：一律當成未驗證。影響是「用密碼註冊、從沒用過 Google 的舊會員第一次用 Google 登入時，舊密碼會失效」，登入頁要說明（「已改用 Google 登入；要用密碼的話請按忘記密碼」）。
- 測試：攻擊者先註冊 → 本人 Google 登入 → 攻擊者的密碼登入失敗、舊 token 失效；已驗證的帳號綁 Google 時密碼保留。

**1-2. 限速改用 express-rate-limit，並補上註冊**
- 現有自己寫的 `createRateLimiter`（記憶體 Map、不會清）換成 `express-rate-limit`：登入、Google 登入、忘記密碼、重設密碼照原本的門檻，註冊新增同一 IP 每小時 5 次（門檻待定）。
- `app.set('trust proxy', 1)` 已經設好，`req.ip` 是使用者的 IP。
- 計數用套件預設的記憶體存法：Cloud Run 重開會歸零、多個實例各算各的，IP 限速只當第一道；真正擋猜密碼的是 1-3（存在 MongoDB）。不另外裝 MongoDB 的存放套件。

**1-3. 同一帳號連續登入失敗就暫時鎖住**
- 問題：現在只按 IP 限速，換 IP 就能一直猜同一個帳號；計數放在記憶體裡，Cloud Run 重開或多個實例時會歸零或各算各的，記錄 IP 的 Map 也不會清。
- 做法：新 model `LoginAttempt`（key＝email、count、expireAt，TTL 索引自動刪除），自己寫（express-rate-limit 是按請求計數，不適合「同一帳號連續失敗、成功就歸零」）。同一個 email 連續錯 10 次鎖 15 分鐘（門檻待定），鎖住期間一律回同一句「嘗試次數過多」，不透露帳號存不存在。登入成功就清掉該 email 的計數。
- 注意：鎖帳號可能被拿來故意鎖住別人。鎖的時間短、只擋密碼登入（Google 登入與忘記密碼不受影響），本人還有路進來。

**1-4. 塔羅 AI 解讀加每日上限**
- 問題：個股分析、財經新聞分析有每日次數限制（`MarketAiUsage`），塔羅解讀（`/api/readings/narrate`）與抽牌追問（`/api/readings/follow-up/narrate`）只檢查有沒有開通，被盜或被寫程式狂打時費用沒有上限。
- 做法：沿用 `MarketAiUsage`，新增 kind `tarot`、`followUp`；每位會員每日上限先設寬鬆的值（例如解讀 30、追問 30，待定），admin 不限。超過回 429 並說明明天幾點恢復；AI 失敗時退回這一次（同個股分析的作法）。
- 管理頁的會員詳細資料一併顯示今天用了幾次。
- v21 點數制上線後由點數取代，這裡的上限留著當防濫用的天花板。

**1-5. 後端加安全標頭（helmet）**
- 裝 `helmet`，放在 CORS 前面；會關掉 `X-Powered-By`，加上 `nosniff`、`X-Frame-Options`、HSTS 等標頭。
- 要調整的預設值：`crossOriginResourcePolicy` 改成 `cross-origin`（牌卡圖片 `/cards` 由 GitHub Pages 的頁面跨網域載入，預設 `same-origin` 會被擋）；後端只回 JSON，`contentSecurityPolicy` 維持預設即可（前端的 CSP 見 3-3）。
- 測試：`/cards` 的圖片、AI 串流（ndjson）、gzip 回應都照常。

### 階段 2：會員自己管得到自己的帳號（後端＋前端「帳號設定」頁）

**2-1. 登入後改密碼**
- `POST /api/auth/change-password`（requireAuth）：舊密碼＋新密碼；改完 `tokenVersion` 加 1，回傳新 token（這台留著登入、其他裝置登出）。
- 只有 Google、沒設過密碼的帳號：畫面改成「設定密碼」，不用舊密碼，但要求最近 10 分鐘內登入過（避免借來的電腦被設密碼）；或直接導去忘記密碼（實作時決定）。
- 套用 1-3 的失敗計數，舊密碼不能拿來猜。

**2-2. 帳號異動通知信**
- 密碼被重設、改了密碼、Google 被綁上、帳號被刪除時寄信給本人：時間、做了什麼、「不是你做的話請立刻重設密碼並聯絡管理者」。
- 寄信失敗只記錄，不影響操作本身。

**2-3. 自助刪除帳號**
- `DELETE /api/auth/me`（requireAuth）：要再輸入一次密碼（只有 Google 的帳號重新做一次 Google 登入）；admin 不能刪自己。
- 一起刪：紀錄、追蹤清單與群組、價位提醒、股市設定、個股分析、新聞分析、推播訂閱、重設憑證、AI 用量。`AdminLog` 照留（目前就是這樣處理已刪除的帳號）。
- 隱私權頁的「刪除資料」改成指向帳號設定頁，保留聯絡信箱當備用。

**2-4. 帳號設定頁（前端）**
- 新路由 `/account`（`meta.auth`），從水晶球選單進入：顯示信箱、登入方式（密碼／Google）、改密碼、登出所有裝置（現有 API）、刪除帳號（`confirmDialog`＋再輸入密碼）。
- 照 `ui-check`：按鈕四種狀態、錯誤訊息顯示後端原因、手機寬度。

### 階段 3：較大的改動

**3-1. 註冊要驗證信箱**
- 註冊後寄驗證信（沿用重設信的憑證作法：只存雜湊、有效期限、用過作廢），點連結才設 `emailVerified = true`。
- 未驗證期間能不能用：可以登入、可以占卜，但不能開通 AI 與股市權限（管理頁標示「信箱未驗證」）；7 天沒驗證的帳號可以被同信箱重新註冊覆蓋（實作時決定）。
- 這是 1-1 的根本解法，也解決「註冊時信箱打錯，忘記密碼的信寄到別人那裡」。
- 寄信額度：Gmail API 每日上限要確認，註冊量大時再換寄信服務。

**3-2. 管理者兩步驟驗證**
- 管理者能開權限、停用會員，現在只靠一組密碼。兩個方案擇一（實作時和使用者確認）：
  - A：管理者只能用 Google 登入（密碼登入回 403），把兩步驟交給 Google 帳號本身。最簡單。
  - B：TOTP 驗證碼（Google Authenticator），需要自己實作 RFC 6238 或加套件（要先問）。

**3-3. 前端加 CSP**
- token 存在 localStorage、有效 7 天，萬一出現 XSS 就會被偷走。現在靠 DOMPurify 擋著；在 `index.html` 加 `<meta http-equiv="Content-Security-Policy">` 當第二道防線（GitHub Pages 不能設回應標頭）。
- 要放行：自己的網域、Cloud Run 的 API、Google 登入（accounts.google.com）、牌卡圖片、Vite 打包出來的 inline 樣式。上線前要逐頁確認沒有被擋。

### 待決定

- 忘記密碼現在會說「這個信箱沒有註冊」（使用者先前的決定，方便使用者，但能被用來查誰有註冊）。維持或改成一律回「如果有這個帳號，信已經寄出」，等使用者決定。

## 三、階段與進度

| 階段 | 內容 | 狀態 |
|---|---|---|
| 1 | Google 合併清掉未驗證密碼、註冊限速、帳號登入失敗鎖定、塔羅 AI 每日上限、安全標頭 | 已實作（2026-11-17） |
| 2 | 改密碼、異動通知信、自助刪除帳號、帳號設定頁 | 已實作（2026-11-17） |
| 3 | 註冊驗證信箱、管理者兩步驟驗證（方案 A）、前端 CSP | 已實作（2026-11-17） |
| 4 | SEO 基本盤：標題與描述、分享預覽、公開頁各一份 HTML（回 200）、noindex、網站地圖、Search Console（第六節 4-1～4-5） | 已實作（2026-11-17）；Search Console 待使用者操作 |
| 5（保留） | 自訂網域、78 張牌義公開頁（第六節 4-6、4-7） | 先不做，保留構想（2026-11-17 使用者決定） |

## 四、決議紀錄

- 2026-11-17：開 v24。檢查結果見 2.0；依「會不會讓帳號被別人用或讓費用失控」排優先順序，分三階段。
- 2026-11-17：不改 token 的存放方式（localStorage），改用 CSP 降低風險；跨網域 cookie 範圍太大。
- 2026-11-17：使用者同意安裝 `helmet`、`express-rate-limit`（取代自己寫的安全標頭與記憶體限速）；同一帳號登入失敗鎖定仍自己寫、存 MongoDB。
- 2026-11-17：SEO 併入 v24（使用者要求），排在安全之後當階段 4；維持 GitHub Pages＋SPA，用打包後產生每頁 HTML 的方式補，不改 SSR。
- 2026-11-17：網站名稱定為 Tarot Bar、標語「小酌一杯，抽一張牌」；分享預覽圖完成（像素風馬丁尼插半片橘子，圖上只放「Tarot Bar」）。自訂網域與牌義公開頁先不做，保留在 4-6、4-7。
- 2026-11-17：階段 3 管理者兩步驟驗證選方案 A（只能用 Google 登入）；未驗證信箱的帳號照預設，只限制不能被開通權限。左上角與信件改用 Tarot Bar。
- 2026-11-17：塔羅 AI 每日上限先用寬鬆的值，v21 點數制上線後保留當防濫用的天花板。

### 實作紀錄（2026-11-17）

- 門檻用計畫書的暫定值：註冊同一 IP 每小時 5 個、同一帳號連續錯 10 次鎖 15 分鐘、塔羅 AI 解讀與追問每天各 30 次（使用者說「照計畫書開發」，未另外指定）。
- 後端：`routes/auth.js`（限速改 express-rate-limit、帳號鎖定、Google 合併、`GET /account`、`POST /change-password`、`DELETE /me`、異動通知信）、`models/LoginAttempt.js`、User 新增 `emailVerified`、`services/tarotAiQuota.js`、`services/accountDeletion.js`（會員資料表清單，測試會比對 models 資料夾，漏了會失敗）、`lib/securityHeaders.js`（helmet＋`X-Robots-Tag: noindex`）。測試 `test/accountSecurity.test.js`。
- 2-1 只有 Google 的帳號：改密碼一律導去「忘記密碼」（不做「最近 10 分鐘內登入過」那個方案）。舊密碼錯回 400 不回 401（前端收到 401 會當成登出），並套用帳號鎖定（key `user:id`）。
- 2-3 刪除帳號：admin 不能刪自己；Google 帳號要重新用同一個 Google 帳號登入確認。
- 2-4 帳號設定頁 `/account`：從導覽列點自己的名字進入（不另外佔一個導覽項目）；「登出所有裝置」放在這頁（水晶球選單那顆仍維持 2026-11-09 的決定，不顯示）。隱私權頁的刪除說明改成指向這頁。
- 1-1 Google 合併清掉密碼時，前端用只有一顆按鈕的提示框告知（`confirmDialog` 新增 `alert`）。
- 4-1～4-5：文案集中在前端 `src/seo.json`；`index.html` 加 description、canonical、Open Graph、Twitter 標籤；換頁時 `src/lib/seo.ts` 更新標題、描述、canonical、noindex；打包後 `scripts/seo-pages.mjs` 換上完整網址、產生 `login/`、`register/`、`privacy/` 三份 HTML 與 `sitemap.xml`。`index.html` 裡首頁的標題與描述和 `seo.json` 重複寫了一份（第一次進站的 HTML 要有），改文案時兩邊一起改。
- 網站左上角改成「小酌一杯，抽一張牌／Tarot Bar」，寄信的寄件人名稱與主旨也改成 Tarot Bar（2026-11-17 使用者同意）。首頁大標「塔羅占卜」是功能名稱，維持不變。

### 階段 3 實作紀錄（2026-11-17）

- 3-1 註冊驗證信箱：新 `models/EmailVerification.js`（只存雜湊、24 小時、TTL）。註冊後寄驗證信，回 `verificationSent`；`POST /verify-email`（不需登入）、`POST /resend-verification`（要登入，5 分鐘一次）。前端新頁 `/verify-email`，帳號設定頁顯示驗證狀態與「重寄驗證信」。
  - 未驗證的限制（使用者採計畫書的預設）：可以登入、占卜；**管理者不能替他開通 AI 與股市權限**（`PATCH /admin/users/:id/ai-access|stock-access` 回 409），收回不受影響、已經開通的不收回。管理頁標示「信箱未驗證」。
  - 不做「7 天沒驗證可被同信箱重新註冊覆蓋」：Google 合併已經會清掉未驗證的密碼，覆蓋會讓真正的主人遺失紀錄。
- 3-2 選方案 A：管理者用密碼登入，密碼對了回 403「管理者帳號請按『使用 Google 登入』」（密碼錯照樣只說登入失敗，不透露誰是管理者）。Google 登入沒設定時不擋；緊急時在後端設環境變數 `ADMIN_PASSWORD_LOGIN=1` 暫時放行。管理者的信箱必須是能用 Google 登入的帳號。
- 3-3 CSP：打包後由 `scripts/seo-pages.mjs` 在每份 HTML 加 `<meta http-equiv="Content-Security-Policy">`。script 只允許自己、index.html 內嵌腳本的 sha256、Google 登入的 gsi/client；connect 只允許自己、`VITE_API_BASE_URL` 的來源、Google gsi；style 因 Vue 的 :style 與 Google 按鈕需要 `unsafe-inline`；img 允許 https。用無頭 Chrome 載入打包結果（首頁、登入、隱私權）沒有任何 CSP 違規、畫面正常；Google 登入按鈕與連 Cloud Run 的請求要部署後確認。

## 五、要請使用者確認的

- MongoDB Atlas 有沒有開備份（帳號資料出事時才救得回來）。
- 各門檻：註冊限速、登入失敗鎖定次數與時間、塔羅 AI 每日上限。
- ~~管理者兩步驟驗證選 A 還是 B~~（2026-11-17 選 A）
- 忘記密碼要不要繼續說「這個信箱沒有註冊」。
- ~~SEO：名稱、標語、預覽圖、自訂網域、牌義公開頁~~（2026-11-17 已決定，見 4-1、4-2 與決議紀錄）

## 六、SEO（階段 4，主要改前端 Tarot-fontEnd）

### 6.1 現況評估（2026-11-17）

| 項目 | 現況 | 影響 |
|---|---|---|
| 網站類型 | Vue 單頁應用（SPA），畫面由 JS 產生 | Google 會執行 JS，大致收得到；LINE、Facebook、Bing 的預覽機器人不執行 JS，只看到空白 |
| 標題 | `index.html` 固定「Orange_Tarot」，換頁不改 `document.title` | 搜尋結果和分頁標籤看不出是塔羅占卜 |
| 描述、分享預覽 | 沒有 `description`、`og:*`、`twitter:*` | 分享連結沒有說明和圖片 |
| 直接開子頁 | GitHub Pages 用 `404.html` 接手（`deploy-pages.yml`） | 畫面正常，但 HTTP 狀態是 **404**，Google 會把 `/privacy` 這類頁面當成不存在 |
| robots.txt | 網站在 `apple19890708.github.io/Tarot-fontEnd/` 底下 | robots.txt 只認網域根目錄，這個 repo 放不了（要自訂網域或另建 `apple19890708.github.io` repo） |
| 網站地圖 | 沒有 | 可以放在子路徑，手動交給 Search Console |
| 可收錄的內容 | 首頁（抽牌）、隱私權政策、登入、註冊 | 內容很少；其餘頁面要登入，本來就不該收錄 |
| 語言 | `<html lang="zh-Hant">` | 已正確 |

結論：基本盤（標題、描述、分享預覽、子頁回 200、網站地圖）成本低、效果明確，先做；要在搜尋上真的有排名，需要「可被搜尋的內容」（牌義頁）和自訂網域，列為選做。

### 6.2 規格

**4-1. 標題與描述**
- `index.html` 改成正式名稱＋一句話描述；加 `<meta name="description">`、`<link rel="canonical">`。
- 換頁時依路由的 `meta.title` 設 `document.title`（「我的紀錄｜Tarot Bar」），寫在 `router.afterEach`。
- 定案（2026-11-17）：
  - 網站名稱：**Tarot Bar**（原本的「Orange_Tarot」改掉；`manifest.webmanifest` 的 name 一起改）
  - 標語：**小酌一杯，抽一張牌**
  - 首頁標題：「Tarot Bar｜小酌一杯，抽一張牌」
  - 描述：「小酌一杯，抽一張牌。今晚的心事，讓牌替你說說看——線上塔羅占卜，附牌與牌的組合分析與 AI 解讀。」

**4-2. 分享預覽（Open Graph）**
- 加 `og:title`、`og:description`、`og:image`（1200×630）、`og:url`、`og:type`、`og:locale=zh_TW`、`twitter:card=summary_large_image`。
- `og:image` 要寫完整網址（含 `https://…/Tarot-fontEnd/`），預覽機器人不吃相對路徑。
- 預覽圖已完成（2026-11-17）：`Tarot-fontEnd/public/og-image.png`，原稿 `Tarot-fontEnd/doc/og-image.svg`（像素風：夜空、吧台、杯緣卡著半片橘子的馬丁尼，右邊只有「Tarot Bar」，2026-11-17 使用者要求改成像素風、拿掉塔羅牌與其他文字）。原稿是方格組成的 SVG，改完用無頭 Chrome 截圖 1200×630 重新產生。

**4-3. 公開頁各一份 HTML（讓直接開子頁回 200）**
- 打包後用一個小腳本（`scripts/` 底下、不加套件）把 `dist/index.html` 複製成 `dist/privacy/index.html`、`dist/login/index.html`、`dist/register/index.html`，各自換上該頁的 title、description、canonical。
- `404.html` 保留，給其他路由和真的不存在的網址。
- 路由清單從 `src/router/index.ts` 的 `meta` 讀，不在兩邊各寫一份（實作時決定怎麼共用）。

**4-4. 不收錄的頁面**
- 要登入、管理、重設密碼、忘記密碼的頁面：路由 `meta` 加 `noindex`，換頁時插入 `<meta name="robots" content="noindex">`。
- 後端 API 回應加 `X-Robots-Tag: noindex`（和 1-5 的 helmet 一起做）。

**4-5. 網站地圖與 Search Console**
- 打包時產生 `dist/sitemap.xml`，只列公開頁。
- 使用者到 Google Search Console 用「網址前置字元」新增 `https://apple19890708.github.io/Tarot-fontEnd/`，驗證用 HTML meta 標籤（放進 `index.html`），再提交 sitemap。這一步要使用者操作。

**4-6（保留，先不做）. 自訂網域**
- 好處：可以放 robots.txt、網址好記、品牌一致；`base` 改成 `/`（`VITE_BASE_PATH=/`，vite.config.ts 已支援）。
- 要做的：買網域（每年約數百元台幣）、GitHub Pages 設定 CNAME、後端 `CLIENT_URL`／`APP_URL`、Google 登入的已授權來源都要加新網域。

**4-7（保留，先不做）. 78 張牌義公開頁**
- 塔羅網站被搜尋最多的是「某張牌的意思」。做成 `/cards/:slug`，打包時從後端牌卡資料產生靜態 HTML（牌名、正逆位牌義、圖片），每張牌一個網址並列進 sitemap。
- 牌義文字來自後端資料（照「文字一律來自後端」的規範），不在前端另寫。
- 規模較大，等 4-1～4-5 上線、Search Console 有資料後再決定。

### 6.3 驗證方式
- 打包後檢查 `dist/` 每份 HTML 的 title、description、og 標籤、canonical 都對。
- 上線後：用 Facebook 分享偵錯工具、LINE 貼連結看預覽；用 `curl -I` 確認 `/privacy/` 回 200；Search Console 的「網址審查」確認可收錄。這些要線上才看得到。
