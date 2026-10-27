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
const { createAdminRouter } = require('./routes/admin')
const { createReadingsRouter } = require('./routes/readings')
const { loadCardsInOrder } = require('./services/cardLoader')
const Reading = require('./models/Reading')
const { buildReadingWithDictionary } = require('./services/readingService')
const { isNarrationAvailable, streamNarration, NarrationRefusedError } = require('./services/narrationService')
const {
  compareCards,
  validateManualCards,
  validateQuestion,
  resolveDomain,
  resolveCustomSpread,
} = require('./services/manualDraw')
const { getCardProfile } = require('./data/cardAttributes')

const ORIENTATIONS = ['upright', 'reversed']

mongoose.set('bufferCommands', false)

const app = express()
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
app.use(express.json())

// 牌卡圖片（公共領域 RWS 1909），放在 public/cards/
app.use('/cards', express.static(path.join(__dirname, '..', 'public', 'cards')))

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

const { optionalAuth, requireAuth, requireAdmin, requireAiAccess } = createAuthMiddleware({
  // token 裡的 sub 不一定是合法的 ObjectId（偽造或舊資料），先擋掉避免 CastError
  findUserById: (id) => (mongoose.isValidObjectId(id) ? User.findById(id) : null),
})

app.use('/api/auth', createAuthRouter({ ensureDatabase, requireAuth }))
app.use('/api/admin', createAdminRouter({ ensureDatabase, requireAdmin }))
// 只定義 GET／DELETE，與下面公開的 POST /api/readings/draw 等端點不衝突
app.use('/api/readings', createReadingsRouter({ ensureDatabase, requireAuth }))

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
        // 宮廷牌靠牌名判斷（編號在不同牌組不一致），所以由後端給 kind，
        // 前端只拿來分組顯示，不自己判斷哪些是宮廷牌
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
async function saveNarration({ readingId, userId, text, model, drawn }) {
  if (!readingId || !userId || !text || !mongoose.isValidObjectId(readingId)) {
    return
  }

  try {
    const record = await Reading.findOne({ _id: readingId, user: userId })
    if (!record) {
      return
    }

    // 確認這段解讀講的就是那筆紀錄的牌，否則紀錄會配上一段和畫面無關的文字
    const sameCards =
      record.cards.length === drawn.length &&
      record.cards.every(
        (card, index) =>
          String(card.cardId) === String(drawn[index].id) && card.orientation === drawn[index].orientation,
      )
    if (!sameCards) {
      return
    }

    record.narration = { text, model: model || '', createdAt: new Date() }
    await record.save()
  } catch (error) {
    console.error('AI 解讀存檔失敗：', error.message)
  }
}

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

    // 前端中斷連線（按停止、重新抽牌、關閉頁面）時，連帶中斷對 OpenRouter 的請求以停止計費
    const controller = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) {
        controller.abort()
      }
    })

    // 回應格式為 NDJSON，每行一個事件：delta（一段文字）、done（完成）、error（串流途中失敗）
    const writeEvent = (event) => res.write(`${JSON.stringify(event)}\n`)

    // 完整產生的解讀要存回紀錄（AI 文字要花錢又無法重現），所以邊送邊收集
    let narrationText = ''

    try {
      const { model } = await streamNarration({
        reading,
        cards,
        signal: controller.signal,
        onStart: () => {
          res.status(200).set({
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
          })
          res.flushHeaders()
        },
        onDelta: (text) => {
          narrationText += text
          writeEvent({ type: 'delta', text })
        },
      })
      // 只有完整產生才存；中途被停止的半截文字不留
      await saveNarration({
        readingId: req.body.readingId,
        userId: req.auth.userId,
        text: narrationText,
        model,
        drawn,
      })
      writeEvent({ type: 'done', model })
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

  app.listen(port, () => {
    console.log(`Tarot API running at http://localhost:${port}`)
    console.log(`CORS origin: ${clientUrls.join(', ')}`)
  })
}

start()