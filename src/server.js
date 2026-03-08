require('dotenv').config()

const express = require('express')
const cors = require('cors')
const mongoose = require('mongoose')

const Card = require('./models/Card')
const spreads = require('./data/spreads')
const { buildReading } = require('./services/readingService')

mongoose.set('bufferCommands', false)

const app = express()
const port = Number.parseInt(process.env.PORT || '4000', 10)
const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173'

app.use(cors({ origin: clientUrl }))
app.use(express.json())

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

app.post('/api/readings/draw', async (req, res, next) => {
  try {
    if (!ensureDatabase(res)) {
      return
    }

    const spread = spreads.find((item) => item.key === req.body.spreadKey)
    if (!spread) {
      res.status(400).json({ message: '找不到指定牌陣。' })
      return
    }

    const question = typeof req.body.question === 'string' ? req.body.question.trim() : ''
    const cards = await Card.aggregate([{ $sample: { size: spread.cardCount } }])

    if (cards.length < spread.cardCount) {
      res.status(400).json({ message: '資料庫中的牌卡數量不足，請先執行 seed。' })
      return
    }

    res.json(buildReading({ question, spread, cards }))
  } catch (error) {
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
    await mongoose.connect(mongoUri)
    console.log('MongoDB connected')
  } catch (error) {
    console.error('MongoDB connection failed:', error.message)
  }
}

async function start() {
  await connectDatabase()

  app.listen(port, () => {
    console.log(`Tarot API running at http://localhost:${port}`)
    console.log(`CORS origin: ${clientUrl}`)
  })
}

start()