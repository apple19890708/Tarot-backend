require('dotenv').config()

const path = require('path')
const express = require('express')
const cors = require('cors')
const mongoose = require('mongoose')

const Card = require('./models/Card')
const User = require('./models/User')
const spreads = require('./data/spreads')
const { createAuthMiddleware } = require('./middleware/auth')
const { createAuthRouter } = require('./routes/auth')
const PasswordReset = require('./models/PasswordReset')
const { createMailer } = require('./services/mailer')
const { createGoogleVerifier } = require('./services/googleAuth')
const { createAdminRouter } = require('./routes/admin')
const { createReadingsRouter } = require('./routes/readings')
const { loadCardsInOrder } = require('./services/cardLoader')
const Reading = require('./models/Reading')
const { buildReadingWithDictionary } = require('./services/readingService')
const { isNarrationAvailable, streamNarration, streamChat, NarrationRefusedError } = require('./services/narrationService')
const { startNdjson } = require('./lib/ndjsonStream')
const { jsonCompression } = require('./lib/jsonCompression')
const { buildMarketSnapshot, warmUpMarket, defaultMarketService } = require('./services/market/marketService')
const { recordCalls } = require('./services/market/tracking')
const { createMarketRouter } = require('./routes/market')
const { createMarketAnalysisRouter } = require('./routes/marketAnalysis')
const { createFinanceNewsRouter } = require('./routes/financeNews')
const FinanceNews = require('./models/FinanceNews')
const FinanceNewsAnalysis = require('./models/FinanceNewsAnalysis')
const MarketAiUsage = require('./models/MarketAiUsage')
const { createFinanceNewsSync } = require('./services/market/financeNews')
const { createNewsDigest, digestFromHtml } = require('./services/market/newsDigest')
const MarketAnalysis = require('./models/MarketAnalysis')
const MarketCall = require('./models/MarketCall')
const MarketAlert = require('./models/MarketAlert')
const MarketWatch = require('./models/MarketWatch')
const MarketWatchGroup = require('./models/MarketWatchGroup')
const MarketProfile = require('./models/MarketProfile')
const MarketSnapshot = require('./models/MarketSnapshot')
const MarketNews = require('./models/MarketNews')
const { createNewsSync } = require('./services/market/materialNews')
const { createSnapshotRecorder } = require('./services/market/snapshotRecorder')
const { createCronRouter } = require('./routes/cron')
const { createDiscord } = require('./services/discord')
const { createWebPush } = require('./services/webPush')
const PushSubscription = require('./models/PushSubscription')
const { createNotifier } = require('./services/market/notifier')
const {
  compareCards,
  validateManualCards,
  validateQuestion,
  resolveDomain,
  resolveCustomSpread,
} = require('./services/manualDraw')
const { getCardProfile } = require('./data/cardAttributes')
const { STOCK_ONLY_DOMAINS } = require('./data/ruleConfig')

const ORIENTATIONS = ['upright', 'reversed']

mongoose.set('bufferCommands', false)

const app = express()
// Render 前面有一層代理：信任一層，req.ip 才是使用者的 IP；不設的話所有人共用代理的 IP，
// 登入與忘記密碼的「同一 IP 限速」會變成全站共用一個額度
app.set('trust proxy', 1)
const port = Number.parseInt(process.env.PORT || '4000', 10)
// CLIENT_URL 可以用逗號分隔多個來源（本機 5173、GitHub Pages、Render…）。
// 只有列在裡面的網域，瀏覽器才打得到這個 API。
const clientUrls = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((item) => item.trim().replace(/\/$/, ''))
  .filter(Boolean)

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
// 保存紀錄時會一起帶上股市諮詢當時的行情（含圖表與回測曲線，最多約 200KB），只放寬這條；
// 這個 parser 先解析過，後面的全域 express.json() 就會略過
app.post('/api/readings', express.json({ limit: '300kb' }))
app.use(express.json())
// JSON 回應 gzip（Cloud Run 不會替回應壓縮；傳出流量是唯一可能超過免費額度的項目）。串流與圖片不經過，見 lib/jsonCompression.js
app.use(jsonCompression())

// 牌卡圖片（公共領域 RWS 1909），放在 public/cards/。每張約 200KB、內容不會變：
// 讓瀏覽器快取 7 天，期間不再回來問（原本 max-age=0 每次都要跨太平洋問一次 304）
app.use('/cards', express.static(path.join(__dirname, '..', 'public', 'cards'), { maxAge: '7d' }))

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

const { optionalAuth, requireAuth, requireAdmin, requireAiAccess, requireStockAccess, hasStockAccess } = createAuthMiddleware({
  // token 裡的 sub 不一定是合法的 ObjectId（偽造或舊資料），先擋掉避免 CastError。
  // 每個需要登入的請求都會查一次（比對憑證版本號）；資料庫沒連上時直接失敗，不要等 mongoose 緩衝 10 秒
  findUserById: (id) => {
    if (mongoose.connection.readyState !== 1) throw new Error('資料庫尚未連線。')
    return mongoose.isValidObjectId(id) ? User.findById(id) : null
  },
})

// 忘記密碼寄信（Gmail API）與 Google 登入；沒設定環境變數時兩者都回 503，不影響一般登入。
// APP_URL：前端網址（含 GitHub Pages 的子路徑），沒設定時用 CLIENT_URL 的第一個（本機開發）
app.use(
  '/api/auth',
  createAuthRouter({
    ensureDatabase,
    requireAuth,
    PasswordResets: PasswordReset,
    mailer: createMailer(),
    google: createGoogleVerifier(),
    appUrl: process.env.APP_URL || clientUrls[0] || '',
  }),
)
app.use('/api/admin', createAdminRouter({ ensureDatabase, requireAdmin }))
// 只定義 GET／DELETE，與下面公開的 POST /api/readings/draw 等端點不衝突
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

app.get('/api/spreads', (_req, res) => {
  res.json(spreads)
})

app.get('/api/cards/random', async (req, res, next) => {
  try {
    if (!ensureDatabase(res)) {
      return
    }

    const requestedCount = Number.parseInt(String(req.query.count || '1'), 10)
    const count = Number.isNaN(requestedCount) ? 1 : Math.min(Math.max(requestedCount, 1), 10)
    const cards = await Card.aggregate([{ $sample: { size: count } }])

    res.json(cards)
  } catch (error) {
    next(error)
  }
})

app.post('/api/readings/draw', optionalAuth, async (req, res, next) => {
  try {
    if (!ensureDatabase(res)) {
      return
    }

    const spread = spreads.find((item) => item.key === req.body.spreadKey)
    if (!spread) {
      res.status(400).json({ message: '找不到指定牌陣。' })
      return
    }

    // 問題長度在這裡就擋掉，和 manual／narrate 一致（它會被回聲，也可能被存成紀錄）
    const { question, error: questionError } = validateQuestion(req.body.question)
    if (questionError) {
      res.status(400).json({ message: questionError })
      return
    }

    const { domain, error: domainError } = resolveDomain(req.body.domain)
    if (domainError) {
      res.status(400).json({ message: domainError })
      return
    }
    if (!(await ensureDomainAllowed(req, res, domain))) {
      return
    }

    const cards = await Card.aggregate([{ $sample: { size: spread.cardCount } }])

    if (cards.length < spread.cardCount) {
      res.status(400).json({ message: '資料庫中的牌卡數量不足，請先執行 seed。' })
      return
    }

    // 紀錄不在這裡存：要不要留存由使用者在結果頁自己決定（POST /api/readings）
    res.json(await buildReadingWithDictionary({ question, spread, cards, domain }))
  } catch (error) {
    next(error)
  }
})

// 手動選牌用的全牌清單，只回傳選牌需要的欄位
app.get('/api/cards', async (_req, res, next) => {
  try {
    if (!ensureDatabase(res)) {
      return
    }

    const cards = await Card.find({}, 'nameZh nameEn suit arcanaType number image').lean()
    const list = cards
      .sort(compareCards)
      .map((card) => {
        // 宮廷牌的判斷集中在 getCardProfile（依牌名），由後端給 kind，
        // 前端只拿來分組顯示，不自己判斷哪些是宮廷牌。
        // 號碼本身四個牌組一致（侍者 11、騎士 12、皇后 13、國王 14，2026-11-04 查資料庫確認）
        const profile = getCardProfile(card)

        return {
          id: card._id,
          nameZh: card.nameZh,
          nameEn: card.nameEn,
          suit: card.suit,
          arcanaType: card.arcanaType,
          number: card.number,
          image: card.image || '',
          kind: profile.kind,
          courtRank: profile.courtRank,
        }
      })

    res.json(list)
  } catch (error) {
    next(error)
  }
})

// 手動選牌解讀：依使用者挑選的牌與順序產生分析。
// 有帶 spreadKey 就套牌陣位置（關係對與位置權重照常生效），沒帶就維持自由張數。
app.post('/api/readings/manual', optionalAuth, async (req, res, next) => {
  try {
    if (!ensureDatabase(res)) {
      return
    }

    const { question, error: questionError } = validateQuestion(req.body.question)
    if (questionError) {
      res.status(400).json({ message: questionError })
      return
    }

    const { domain, error: domainError } = resolveDomain(req.body.domain)
    if (domainError) {
      res.status(400).json({ message: domainError })
      return
    }
    if (!(await ensureDomainAllowed(req, res, domain))) {
      return
    }

    const { drawn, error } = validateManualCards(req.body.cards)
    if (error) {
      res.status(400).json({ message: error })
      return
    }

    // spreadKey 省略時維持舊行為（自由張數、無位置）；給了就必須存在
    let spread = null
    if (req.body.spreadKey) {
      spread = spreads.find((item) => item.key === req.body.spreadKey) || null
      if (!spread) {
        res.status(400).json({ message: '找不到指定牌陣。' })
        return
      }
      if (drawn.length !== spread.cardCount) {
        res.status(400).json({
          message: `${spread.name} 需要 ${spread.cardCount} 張牌，目前選了 ${drawn.length} 張。`,
        })
        return
      }
    } else {
      const custom = resolveCustomSpread(req.body.positions, drawn.length)
      if (custom.error) {
        res.status(400).json({ message: custom.error })
        return
      }
      spread = custom.spread
    }

    const { cards, error: loadError } = await loadCardsInOrder(drawn)
    if (loadError) {
      res.status(400).json({ message: loadError })
      return
    }

    const reading = await buildReadingWithDictionary({
      question,
      spread,
      cards,
      drawOrientation: (index) => drawn[index].orientation,
      domain,
    })
    // 紀錄不在這裡存：要不要留存由使用者在結果頁自己決定（POST /api/readings）
    res.json(reading)
  } catch (error) {
    next(error)
  }
})

// 把完整產生的 AI 解讀存回使用者自己的那筆紀錄。沒帶 readingId（例如舊版前端）就跳過；
// 存檔失敗不影響已經送出去的解讀，只記 log。
// 回傳 null：沒有指定紀錄（還沒保存），本來就不存；true／false：有指定紀錄時是否存成功。
// 重新產生時會直接覆蓋同一筆的 narration，不另開新紀錄。結果要回報給前端，
// 否則存檔失敗只寫在 log，使用者以為紀錄已經更新。
async function saveNarration({ readingId, userId, text, model, market, drawn }) {
  if (!readingId) {
    return null
  }
  if (!userId || !text || !mongoose.isValidObjectId(readingId)) {
    return false
  }

  try {
    const record = await Reading.findOne({ _id: readingId, user: userId })
    if (!record) {
      return false
    }

    // 確認這段解讀講的就是那筆紀錄的牌，否則紀錄會配上一段和畫面無關的文字
    const sameCards =
      record.cards.length === drawn.length &&
      record.cards.every(
        (card, index) =>
          String(card.cardId) === String(drawn[index].id) && card.orientation === drawn[index].orientation,
      )
    if (!sameCards) {
      return false
    }

    record.narration = { text, model: model || '', market: market || null, createdAt: new Date() }
    await record.save()
    return true
  } catch (error) {
    console.error('AI 解讀存檔失敗：', error.message)
    return false
  }
}

// 到價推播：瀏覽器推播（所有會員；VAPID 金鑰沒設定時自動關閉）與 Discord Webhook（只給 admin）
const notifier = createNotifier({ discord: createDiscord(), webPush: createWebPush(), MarketProfile, PushSubscription, User, MarketAlert })
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
    ai: { isAvailable: isNarrationAvailable, stream: streamChat },
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
    ai: { isAvailable: isNarrationAvailable, stream: streamChat },
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
  }),
)

// 依牌與正逆位重算組合分析，再交給 AI 改寫成口語解讀；不信任前端傳來的分析文字
// AI 解讀會產生費用，所以限 admin 與被管理者開通的會員（未登入者仍可抽牌與看規則分析）
app.post('/api/readings/narrate', requireAiAccess, async (req, res, next) => {
  try {
    if (!isNarrationAvailable()) {
      res.status(503).json({ message: 'AI 解讀尚未設定（缺少 OPENROUTER_API_KEY）。' })
      return
    }

    if (!ensureDatabase(res)) {
      return
    }

    // spreadKey 省略、manual 或 custom 時走手動選牌（位置由 positions 決定）；否則依指定牌陣
    const MANUAL_KEYS = ['manual', 'custom']
    const isManual = !req.body.spreadKey || MANUAL_KEYS.includes(req.body.spreadKey)
    const spread = isManual ? null : spreads.find((item) => item.key === req.body.spreadKey)
    if (!isManual && !spread) {
      res.status(400).json({ message: '找不到指定牌陣。' })
      return
    }

    const { question, error: questionError } = validateQuestion(req.body.question)
    if (questionError) {
      res.status(400).json({ message: questionError })
      return
    }

    const { domain: narrateDomain, error: narrateDomainError } = resolveDomain(req.body.domain)
    if (narrateDomainError) {
      res.status(400).json({ message: narrateDomainError })
      return
    }
    // requireAiAccess 只確認 AI 權限；股市諮詢還要金融股市權限，否則會拿到行情、回測與操作建議
    if (!(await ensureDomainAllowed(req, res, narrateDomain))) {
      return
    }

    let drawn
    let narrateSpread = spread
    if (isManual) {
      const result = validateManualCards(req.body.cards)
      if (result.error) {
        res.status(400).json({ message: result.error })
        return
      }
      drawn = result.drawn
      // 自訂位置要一起帶進來，否則 AI 解讀會看不到使用者定義的位置含意
      const custom = resolveCustomSpread(req.body.positions, drawn.length)
      if (custom.error) {
        res.status(400).json({ message: custom.error })
        return
      }
      narrateSpread = custom.spread
    } else {
      drawn = Array.isArray(req.body.cards) ? req.body.cards : []
      const isValid =
        drawn.length === spread.cardCount &&
        drawn.every((item) => mongoose.isValidObjectId(item?.id) && ORIENTATIONS.includes(item?.orientation))
      if (!isValid) {
        res.status(400).json({ message: '牌卡資料格式不正確。' })
        return
      }
    }

    const { cards, error: loadError } = await loadCardsInOrder(drawn)
    if (loadError) {
      res.status(400).json({ message: loadError })
      return
    }

    const reading = await buildReadingWithDictionary({
      question,
      spread: narrateSpread,
      cards,
      drawOrientation: (index) => drawn[index].orientation,
      domain: narrateDomain,
    })

    // 問題和股市有關時，先查即時報價與技術指標一起交給 AI。查詢失敗不影響解讀，只是少了數據
    // 只有「股市諮詢」才查市場資料、改用技術分析的寫法；其他問題類型一律走原本的塔羅解讀。
    // 查詢失敗不影響解讀，只是少了數據
    const market =
      narrateDomain === 'stock'
        ? await buildMarketSnapshot(question).catch((error) => {
            console.error('市場資料查詢失敗：', error.message)
            return null
          })
        : null
    // AI 解讀時查到的建議也記下來（自動對答案用）；失敗不影響解讀
    if (market && mongoose.connection.readyState === 1) {
      recordCalls(MarketCall, req.auth.userId, market).catch((err) => console.error('建議紀錄失敗：', err.message))
    }

    // 前端中斷連線（按停止、重新抽牌、關閉頁面）時，連帶中斷對 OpenRouter 的請求以停止計費
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) {
        controller.abort()
      }
    })

    // 回應格式為 NDJSON，每行一個事件：market（查到的市場資料，只在股市問題出現、排在最前面）、
    // delta（一段文字）、done（完成）、error（串流途中失敗）
    const writeEvent = (event) => res.write(`${JSON.stringify(event)}\n`)

    // 完整產生的解讀要存回紀錄（AI 文字要花錢又無法重現），所以邊送邊收集
    let narrationText = ''

    try {
      const { model } = await streamNarration({
        reading,
        cards,
        market,
        signal: controller.signal,
        onStart: () => {
          // 送出標頭並開始心跳（前端靠它分辨「還在等 AI」和「連線斷了」）
          startNdjson(res)
          if (market) {
            writeEvent({ type: 'market', snapshot: market })
          }
        },
        onDelta: (text) => {
          narrationText += text
          writeEvent({ type: 'delta', text })
        },
      })
      // 只有完整產生才存；中途被停止的半截文字不留（紀錄裡原本那篇也保持不動）
      const saved = await saveNarration({
        readingId: req.body.readingId,
        userId: req.auth.userId,
        text: narrationText,
        model,
        market,
        drawn,
      })
      writeEvent({ type: 'done', model, saved })
      res.end()
    } catch (error) {
      if (controller.signal.aborted) {
        console.log('AI 解讀已由使用者中斷')
        return
      }
      if (!res.headersSent) {
        throw error
      }
      console.error(error)
      writeEvent({
        type: 'error',
        message: error instanceof NarrationRefusedError ? 'AI 無法產生這次的解讀。' : 'AI 解讀中途發生錯誤，請再試一次。',
      })
      res.end()
    }
  } catch (error) {
    if (error instanceof NarrationRefusedError) {
      res.status(422).json({ message: 'AI 無法產生這次的解讀。' })
      return
    }
    next(error)
  }
})

app.use((error, _req, res, _next) => {
  console.error(error)
  res.status(500).json({ message: '伺服器發生錯誤，請稍後再試。' })
})

async function connectDatabase() {
  const mongoUri = process.env.MONGO_URI

  if (!mongoUri) {
    console.warn('MONGO_URI 未設定，API 將以未連線狀態啟動。')
    return
  }

  try {
    const dbName = process.env.MONGO_DB_NAME || 'tarot-divination'
    await mongoose.connect(mongoUri, { dbName })
    console.log(`MongoDB connected (db: ${dbName})`)
  } catch (error) {
    console.error('MongoDB connection failed:', error.message)
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