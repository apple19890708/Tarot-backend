require('dotenv').config()

const path = require('path')
const express = require('express')
const cors = require('cors')
const { securityHeaders } = require('./lib/securityHeaders')
const mongoose = require('mongoose')

const Card = require('./models/Card')
const User = require('./models/User')
const { createAuthMiddleware } = require('./middleware/auth')
const { createAuthRouter } = require('./routes/auth')
const PasswordReset = require('./models/PasswordReset')
const LoginAttempt = require('./models/LoginAttempt')
const EmailVerification = require('./models/EmailVerification')
const { defaultUserDataDeleter } = require('./services/accountDeletion')
const { createTarotAiQuota } = require('./services/tarotAiQuota')
const { createMailer } = require('./services/mailer')
const { createGoogleVerifier } = require('./services/googleAuth')
const { createAdminRouter } = require('./routes/admin')
const { createReadingsRouter } = require('./routes/readings')
const { createDailyCardRouter } = require('./routes/dailyCard')
const { createJournalRouter } = require('./routes/journal')
const { createNotificationsRouter } = require('./routes/notifications')
const { createLenormandRouter } = require('./routes/lenormand')
const { createTarotRouter } = require('./routes/tarot')
const { createNotificationCenter } = require('./services/notificationCenter')
const Notification = require('./models/Notification')
const { loadCardsInOrder } = require('./services/cardLoader')
const Reading = require('./models/Reading')
const { buildReadingWithDictionary } = require('./services/readingService')
const {
  isNarrationAvailable,
  streamNarration,
  streamFollowUpNarration,
  streamChat,
  MARKET_MODEL,
} = require('./services/narrationService')
// 個股與財經新聞的 AI 分析用自己的模型設定（OPENROUTER_MARKET_MODEL），塔羅解讀用 OPENROUTER_MODEL
const streamMarketChat = (options) => streamChat({ ...options, model: MARKET_MODEL })
const { jsonCompression } = require('./lib/jsonCompression')
const { gzipStatic } = require('./lib/gzipStatic')
const { buildMarketSnapshot, warmUpMarket, defaultMarketService } = require('./services/market/marketService')
const { recordCalls } = require('./services/market/tracking')
const { createMarketRouter } = require('./routes/market')
const { createMarketAnalysisRouter } = require('./routes/marketAnalysis')
const { createFinanceNewsRouter } = require('./routes/financeNews')
const FinanceNews = require('./models/FinanceNews')
const FinanceNewsAnalysis = require('./models/FinanceNewsAnalysis')
const MarketAiUsage = require('./models/MarketAiUsage')
// 塔羅 AI 解讀與追問的每日次數（v24 1-4）
const tarotAiQuota = createTarotAiQuota({ Usage: MarketAiUsage })
const { createFinanceNewsSync } = require('./services/market/financeNews')
const { createNewsDigest, digestFromHtml } = require('./services/market/newsDigest')
const MarketAnalysis = require('./models/MarketAnalysis')
const MarketCall = require('./models/MarketCall')
const MarketAlert = require('./models/MarketAlert')
const MarketWatch = require('./models/MarketWatch')
const MarketWatchGroup = require('./models/MarketWatchGroup')
const MarketProfile = require('./models/MarketProfile')
const MarketReminder = require('./models/MarketReminder')
const DividendForecast = require('./models/DividendForecast')
const { createForecastLog } = require('./services/market/forecastLog')
const MarketSnapshot = require('./models/MarketSnapshot')
const MarketNews = require('./models/MarketNews')
const { createNewsSync } = require('./services/market/materialNews')
const { createSnapshotRecorder } = require('./services/market/snapshotRecorder')
const { createCronRouter } = require('./routes/cron')
const { createExDividendReminder } = require('./services/market/exDividendReminder')
const { isMarketOpen } = require('./services/market/alertChecker')
const { createDiscord } = require('./services/discord')
const { createWebPush } = require('./services/webPush')
const PushSubscription = require('./models/PushSubscription')
const { createNotifier } = require('./services/market/notifier')
const { STOCK_ONLY_DOMAINS } = require('./data/ruleConfig')

mongoose.set('bufferCommands', false)

const app = express()
// Cloud Run 前面有一層代理：信任一層，req.ip 才是使用者的 IP；不設的話所有人共用代理的 IP，
// 登入與忘記密碼的「同一 IP 限速」會變成全站共用一個額度
app.set('trust proxy', 1)
const port = Number.parseInt(process.env.PORT || '4000', 10)
// CLIENT_URL 可以用逗號分隔多個來源（本機 5173、GitHub Pages、Render…）。
// 只有列在裡面的網域，瀏覽器才打得到這個 API。
const clientUrls = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((item) => item.trim().replace(/\/$/, ''))
  .filter(Boolean)

// 安全標頭與 noindex（v24 1-5、4-4），細節見 lib/securityHeaders.js
app.use(securityHeaders())

app.use(
  cors({
    origin(origin, callback) {
      // 沒有 Origin 的請求（curl、同源、伺服器對伺服器）一律放行
      if (!origin || clientUrls.includes(origin)) {
        callback(null, true)
        return
      }
      callback(new Error(`來源不在 CLIENT_URL 允許清單內：${origin}`))
    },
  }),
)
// 保存紀錄時會一起帶上股市諮詢當時的行情（含圖表與回測曲線，一檔約 70KB、最多 4 檔，約 300KB），只放寬這條；
// 這個 parser 先解析過，後面的全域 express.json() 就會略過
app.post('/api/readings', express.json({ limit: '500kb' }))
// 補存 AI 解讀也會帶行情資料，限制和保存一樣。這兩行要放在全域 express.json() 前面：先解析過的，全域那個會略過
app.put('/api/readings/:id/narration', express.json({ limit: '500kb' }))
app.use(express.json())
// JSON 回應 gzip（Cloud Run 不會替回應壓縮；傳出流量是唯一可能超過免費額度的項目）。串流與圖片不經過，見 lib/jsonCompression.js
app.use(jsonCompression())

// 牌卡圖片，放在 public/cards/，內容不會變：讓瀏覽器快取 7 天，期間不再回來問（原本 max-age=0 每次都要跨太平洋問一次 304）
// - 原版：公共領域 RWS 1909 的 jpg（每張約 200KB），資料庫 Card.image 存的是這個
// - 水彩：v28 原創 SVG（scripts/tarot/buildCardArt.js 產生，同 slug 換副檔名），前端選水彩時自己把 .jpg 換成 .svg
// SVG 先過 gzipStatic（只處理 .svg，啟動時壓好放記憶體，78 張合計約 955KB，壓縮後約 170KB）；jpg 與不接受 gzip 的請求交給 express.static
const CARDS_DIR = path.join(__dirname, '..', 'public', 'cards')
app.use('/cards', gzipStatic(CARDS_DIR, { maxAgeSeconds: 7 * 24 * 60 * 60 }))
app.use('/cards', express.static(CARDS_DIR, { maxAge: '7d' }))
// 雷諾曼牌面（v27）：原創 SVG（scripts/lenormand/buildCardArt.js 產生），每張 7～21KB，快取設定同 /cards。
// SVG 是純文字，先過 gzipStatic 送預先壓好的版本（約只剩 2 成）；不接受 gzip 的才交給 express.static 送原檔。
// 跨網域載入靠 securityHeaders 的 Cross-Origin-Resource-Policy: cross-origin（全站共用，和塔羅一樣）
const LENORMAND_DIR = path.join(__dirname, '..', 'public', 'lenormand')
app.use('/lenormand', gzipStatic(LENORMAND_DIR, { maxAgeSeconds: 7 * 24 * 60 * 60 }))
app.use('/lenormand', express.static(LENORMAND_DIR, { maxAge: '7d' }))

function isDatabaseReady() {
  return mongoose.connection.readyState === 1
}

function ensureDatabase(res) {
  if (isDatabaseReady()) {
    return true
  }

  res.status(503).json({
    message: 'MongoDB 尚未連線。請先設定 backend/.env 的 MONGO_URI，並執行 npm run seed。',
  })

  return false
}

const {
  optionalAuth,
  requireAuth,
  requireAdmin,
  requireAiAccess,
  requireStockAccess,
  hasStockAccess,
  requireLenormandAccess,
} = createAuthMiddleware({
  // token 裡的 sub 不一定是合法的 ObjectId（偽造或舊資料），先擋掉避免 CastError。
  // 每個需要登入的請求都會查一次（比對憑證版本號）；資料庫沒連上時直接失敗，不要等 mongoose 緩衝 10 秒
  findUserById: (id) => {
    if (mongoose.connection.readyState !== 1) throw new Error('資料庫尚未連線。')
    return mongoose.isValidObjectId(id) ? User.findById(id) : null
  },
  // 最後活動時間（管理頁用），同一小時內只寫一次
  touchUser: (id, at) => User.updateOne({ _id: id }, { $set: { lastActiveAt: at } }),
})

// 忘記密碼寄信（Gmail API）與 Google 登入；沒設定環境變數時兩者都回 503，不影響一般登入。
// APP_URL：前端網址（含 GitHub Pages 的子路徑），沒設定時用 CLIENT_URL 的第一個（本機開發）
app.use(
  '/api/auth',
  createAuthRouter({
    ensureDatabase,
    requireAuth,
    PasswordResets: PasswordReset,
    LoginAttempts: LoginAttempt,
    deleteUserData: defaultUserDataDeleter(),
    EmailVerifications: EmailVerification,
    mailer: createMailer(),
    google: createGoogleVerifier(),
    appUrl: process.env.APP_URL || clientUrls[0] || '',
  }),
)
app.use('/api/admin', createAdminRouter({ ensureDatabase, requireAdmin }))
// 只定義 POST /、GET、PUT /:id/…、DELETE（都是單段或 :id 開頭的路徑），與下面公開的 POST /api/readings/draw 等端點不衝突
// 股市諮詢只給 admin 與開通「金融股市」的會員。選單只是不顯示，真正的放行在這裡。
// 用在 draw、manual、narrate 與保存紀錄；narrate 另外還要 AI 權限（requireAiAccess）
async function ensureDomainAllowed(req, res, domain) {
  if (!STOCK_ONLY_DOMAINS.includes(domain) || (await hasStockAccess(req))) {
    return true
  }
  res.status(403).json({ message: '股市諮詢需要金融股市權限，請聯絡管理者開通。' })
  return false
}

app.use('/api/readings', createReadingsRouter({ ensureDatabase, requireAuth, ensureDomainAllowed }))
// 每日一牌與月曆（v26 計畫 1）：/api/daily-card/today、/api/daily-card/draw、/api/calendar
app.use('/api', createDailyCardRouter({ ensureDatabase, requireAuth, optionalAuth }))
// 占卜日記（v26 計畫 2）
app.use('/api', createJournalRouter({ ensureDatabase, requireAuth }))
// 通知中心（v26 計畫 5）：鈴鐺的列表、未讀數、已讀、刪除；寫入由 notifier 負責
app.use('/api', createNotificationsRouter({ ensureDatabase, requireAuth, Notification }))
// 雷諾曼（v27）：整個 router 只給 admin 與開通 lenormandAccess 的會員；刪除自己的紀錄只要登入
app.use('/api/lenormand', createLenormandRouter({ requireLenormandAccess, requireAuth, ensureDatabase, aiQuota: tarotAiQuota }))

app.get('/api/health', async (_req, res) => {
  const cardCount = isDatabaseReady() ? await Card.countDocuments() : 0

  res.json({
    status: 'ok',
    database: {
      ready: isDatabaseReady(),
      cardCount,
      message: isDatabaseReady() ? 'MongoDB 已連線。' : 'MongoDB 尚未連線。',
    },
  })
})

// 塔羅占卜（抽牌、手動選牌、AI 解讀、追問）：v29 項目 9 從這裡抽到 routes/tarot.js，網址不變
app.use(
  createTarotRouter({
    ensureDatabase,
    optionalAuth,
    requireAiAccess,
    ensureDomainAllowed,
    Card,
    Reading,
    MarketCall,
    loadCardsInOrder,
    buildReadingWithDictionary,
    aiQuota: tarotAiQuota,
    ai: { isAvailable: isNarrationAvailable, streamNarration, streamFollowUpNarration },
    market: { buildSnapshot: buildMarketSnapshot, recordCalls },
    isDatabaseReady,
  }),
)

// 到價推播：瀏覽器推播（所有會員；VAPID 金鑰沒設定時自動關閉）與 Discord Webhook（只給 admin）；
// 每一則也存進通知中心（v26 計畫 5），推播失敗或沒開推播也看得到
const notifier = createNotifier({
  discord: createDiscord(),
  webPush: createWebPush(),
  MarketProfile,
  PushSubscription,
  User,
  MarketAlert,
  notifications: createNotificationCenter({ Notification }),
})
// 重大訊息：公開資訊觀測站只給當天的，抓到就存 30 天（排程與使用者開頁面時都會觸發，30 分鐘最多一次）
const newsSync = createNewsSync({
  MarketNews,
  fetchJson: async (url) => {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TarotMarket/1.0)', Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error(`${response.status} ${url}`)
    return response.json()
  },
})

// 讀外部內容（財經新聞來源與原文）：外部內容不可信，邊讀邊累計，超過 2MB 就中斷；失敗的錯誤帶 status
async function fetchLimitedText(url, accept, timeoutMs = 10000) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TarotMarket/1.0)', Accept: accept },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    const error = new Error(`${response.status} ${url}`)
    error.status = response.status
    throw error
  }
  const MAX_BYTES = 2 * 1024 * 1024
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new Error(`回應超過 2MB：${url}`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

// 財經新聞（v17 規格 G）：國內外免費 RSS／鉅亨網，抓到就存 7 天（15 分鐘最多抓一次）
const financeNewsSync = createFinanceNewsSync({
  FinanceNews,
  fetchText: (url) => fetchLimitedText(url, 'application/rss+xml, application/xml, application/json, text/xml'),
  // 鉅亨網的列表附全文：同步時就先產生新聞重點，打開不用再讀原文（原文頁第一次讀要十幾秒）
  prepareDigest: async (row, html) => digestFromHtml(row, html, await defaultMarketService.getDirectory()),
})
// 新聞重點彈窗：第一次有人打開才讀原文、節錄重點與標籤（不呼叫 AI），結果存在那則新聞上
const newsDigest = createNewsDigest({
  FinanceNews,
  // 原文頁第一次讀可能比較慢（鉅亨網沒快取時約 15 秒）
  fetchHtml: (url) => fetchLimitedText(url, 'text/html', 20000),
  getDirectory: () => defaultMarketService.getDirectory(),
})

// 每日資產快照：台股收盤後由排程記錄，使用者開自訂追蹤頁時也會補記
const snapshotRecorder = createSnapshotRecorder({
  MarketSnapshot,
  MarketWatch,
  MarketProfile,
  User,
  marketService: defaultMarketService,
})

// 除息前推播（v20 階段 6）：由同一個盤中排程觸發，開了提醒的會員在除息前最後一個交易日收到通知
const exDividendReminder = createExDividendReminder({
  MarketProfile,
  MarketWatch,
  MarketReminder,
  User,
  notifier,
  marketService: defaultMarketService,
  isMarketOpen,
})

// 股市諮詢：行情快照、建議追蹤、價位提醒、自訂追蹤（限金融股市權限，不呼叫 AI、不產生費用）
app.use(
  '/api/market',
  createMarketRouter({
    requireStockAccess,
    ensureDatabase,
    marketService: defaultMarketService,
    MarketCall,
    MarketAlert,
    MarketWatch,
    MarketWatchGroup,
    MarketProfile,
    notifier,
    snapshots: snapshotRecorder,
    news: newsSync,
    forecastLog: createForecastLog({ DividendForecast }),
  }),
)

// 個股分析（v17 規格 F）：彈窗資料不呼叫 AI；AI 深度分析要 AI 權限、有次數限制；「我的紀錄」的股票分析
app.use(
  '/api/market',
  createMarketAnalysisRouter({
    requireStockAccess,
    requireAiAccess,
    ensureDatabase,
    marketService: defaultMarketService,
    MarketWatch,
    MarketAnalysis,
    MarketProfile,
    MarketAiUsage,
    news: newsSync,
    ai: { isAvailable: isNarrationAvailable, stream: streamMarketChat },
  }),
)

// 財經新聞（v17 規格 G）：新聞列表不呼叫 AI；AI 影響分析要使用者手動按、要 AI 權限、有次數限制
app.use(
  '/api/market',
  createFinanceNewsRouter({
    requireStockAccess,
    requireAiAccess,
    ensureDatabase,
    financeNews: financeNewsSync,
    newsDigest,
    MarketWatch,
    FinanceNewsAnalysis,
    MarketAiUsage,
    ai: { isAvailable: isNarrationAvailable, stream: streamMarketChat },
  }),
)

// 外部排程（GitHub Actions）呼叫：網頁關著也檢查價位提醒並推播。用 CRON_SECRET 驗證，沒設定就關閉
app.use(
  '/api/cron',
  createCronRouter({
    ensureDatabase,
    marketService: defaultMarketService,
    notifier,
    MarketAlert,
    User,
    recordSnapshots: () => snapshotRecorder.recordAll(),
    syncNews: () => newsSync.sync(),
    syncFinanceNews: () => financeNewsSync.sync(),
    remindExDividends: () => exDividendReminder.run(),
  }),
)

app.use((error, _req, res, _next) => {
  // body 超過上限（express.json 的 limit）：回 413 和看得懂的說明，不要變成 500（api-reviewer 2026-11-26）
  if (error?.type === 'entity.too.large' || error?.status === 413) {
    res.status(413).json({ message: '送出的資料太大，無法處理。' })
    return
  }
  // JSON 格式錯誤：回 400（原本也是 500）
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ message: '資料格式不正確。' })
    return
  }
  console.error(error)
  res.status(500).json({ message: '伺服器發生錯誤，請稍後再試。' })
})

// 第一次連線失敗時在背景重試（5 秒起、每次加倍、最多 60 秒一次）。
// 2026-11-19：新版本在 Cloud Run 啟動那幾秒網路不穩，第一次連線失敗後就再也沒重連，
// 整個執行個體一直「MongoDB 尚未連線」（健康檢查仍回 ok，Cloud Run 不會換掉它）。
// mongoose 只會在「連上之後斷線」時自己重連，第一次就失敗不會重試，所以要自己排。
const DB_RETRY_FIRST_MS = 5000
const DB_RETRY_MAX_MS = 60000

async function connectDatabase(attempt = 1) {
  const mongoUri = process.env.MONGO_URI

  if (!mongoUri) {
    console.warn('MONGO_URI 未設定，API 將以未連線狀態啟動。')
    return
  }

  try {
    const dbName = process.env.MONGO_DB_NAME || 'tarot-divination'
    await mongoose.connect(mongoUri, { dbName })
    console.log(`MongoDB connected (db: ${dbName})${attempt > 1 ? `，第 ${attempt} 次嘗試` : ''}`)
    // 每日一牌的 user＋date 唯一索引擋住重複抽牌；建索引失敗只會靜靜地發 error 事件，這裡明確等它建好並記 log（api-reviewer 2026-11-20）
    require('./models/DailyCard')
      .init()
      .catch((error) => console.error('每日一牌唯一索引建立失敗（重複抽牌可能存成兩筆）：', error.message))
    // 股票日記的舊格式轉換（v26 D9）原本在這裡每次啟動跑一次，v29 項目 12 移到 scripts/migrateStockJournal.js 手動執行
  } catch (error) {
    const delay = Math.min(DB_RETRY_MAX_MS, DB_RETRY_FIRST_MS * 2 ** (attempt - 1))
    console.error(`MongoDB connection failed（第 ${attempt} 次）：${error.message}；${delay / 1000} 秒後重試`)
    setTimeout(() => void connectDatabase(attempt + 1), delay)
  }
}

async function start() {
  // 沒有密鑰就不要啟動。給預設值等於沒有密鑰，簽出來的 token 誰都能偽造。
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET 未設定，伺服器不啟動。請在 .env 加上 JWT_SECRET（見 .env.example）。')
    process.exit(1)
  }

  await connectDatabase()

  // 先載入股票清單（名稱對代號），第一次問股票時不用等；失敗也不影響啟動
  warmUpMarket().catch((error) => console.error('股票清單預載失敗：', error.message))

  app.listen(port, () => {
    console.log(`Tarot API running at http://localhost:${port}`)
    console.log(`CORS origin: ${clientUrls.join(', ')}`)
  })
}

start()