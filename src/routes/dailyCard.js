// 每日一牌與月曆（v26 計畫 1）。掛在 /api 底下：
//   GET  /daily-card/today      今天抽過的那張（要登入）
//   POST /daily-card/draw       抽今天的牌；登入的存起來、當天固定（D1 不能重抽），訪客只回傳不存、附領取憑證
//   POST /daily-card/claim      訪客抽的牌在登入或註冊後存進月曆（要登入，只收今天的憑證）
//   GET  /calendar?month=YYYY-MM 這個月每一天的每日一牌與占卜紀錄摘要（要登入，只看自己的）
// 每日一牌不呼叫 AI（v26 不做的事）。依賴可以注入，測試不必連資料庫。
const express = require('express')
const { rateLimit } = require('express-rate-limit')

const DailyCardModel = require('../models/DailyCard')
const CardModel = require('../models/Card')
const ReadingModel = require('../models/Reading')
const JournalEntryModel = require('../models/JournalEntry')
const { taipeiDayKey, monthRange, streakOf, dailyCardView } = require('../services/dailyCard')
const { signDailyClaim, verifyDailyClaim } = require('../lib/jwt')

// 連續天數往回看最多這麼多天（一年多），避免越用越慢
const STREAK_LOOKBACK = 400
// 月曆每天最多列幾筆占卜紀錄（一天問很多次時，面板只列最近的）
const READINGS_PER_DAY = 20

async function defaultPickCard(Card) {
  const [card] = await Card.aggregate([{ $sample: { size: 1 } }])
  return card || null
}

// 訪客抽牌的每 IP 限速（api-reviewer 2026-11-20）：不用登入就能一直打，每次一個 $sample 聚合加簽憑證。
// 計數放記憶體（同 auth.js 的限速器），Cloud Run 多實例各算各的，只當第一道。登入的人不受這個限制
const GUEST_DRAW_WINDOW_MS = 60 * 1000
const GUEST_DRAW_MAX = 30
function defaultGuestLimiter() {
  return rateLimit({
    windowMs: GUEST_DRAW_WINDOW_MS,
    limit: GUEST_DRAW_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => Boolean(req.auth),
    message: { message: '抽牌次數太多，請稍後再試。' },
  })
}

function createDailyCardRouter({
  ensureDatabase,
  requireAuth,
  optionalAuth,
  DailyCard = DailyCardModel,
  Card = CardModel,
  Reading = ReadingModel,
  JournalEntry = JournalEntryModel,
  pickCard = () => defaultPickCard(Card),
  randomOrientation = () => (Math.random() < 0.5 ? 'upright' : 'reversed'),
  now = () => new Date(),
  // 訪客抽牌的領取憑證（登入或註冊後把那張牌存進月曆）；測試時注入固定密鑰
  signClaim = signDailyClaim,
  verifyClaim = verifyDailyClaim,
  guestLimiter = defaultGuestLimiter(),
}) {
  const router = express.Router()

  async function streakFor(userId, today) {
    const rows = await DailyCard.find({ user: userId }).sort({ date: -1 }).limit(STREAK_LOOKBACK).select('date').lean()
    return streakOf(
      rows.map((row) => row.date),
      today,
    )
  }

  // 牌庫對不到（重新匯入過）時用存下來的快照，至少看得到是哪張牌；牌義文字這時沒有
  async function viewOf(record) {
    const card = await Card.findById(record.cardId).lean()
    if (card) return dailyCardView(card, record.orientation, record.date)
    return dailyCardView({ _id: record.cardId, nameZh: record.nameZh, nameEn: record.nameEn, image: record.image }, record.orientation, record.date)
  }

  router.get('/daily-card/today', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const today = taipeiDayKey(now())
      const record = await DailyCard.findOne({ user: req.auth.userId, date: today }).lean()
      res.json({ today, dailyCard: record ? await viewOf(record) : null, streak: await streakFor(req.auth.userId, today) })
    } catch (error) {
      next(error)
    }
  })

  // 「當天不能重抽」只防一般的使用流程，不防刻意繞過：訪客沒有身分，抽牌時不帶登入資訊（無痕視窗、先登出）
  // 就能一直抽，再用 /claim 領進自己的月曆。每日一牌只是紀錄（不涉及金錢、不呼叫 AI），這是接受的取捨
  // （api-reviewer 2026-11-20，見 doc/v26 決議紀錄）。下面對失效 token 回 401 只是不讓「登入過期」時悄悄變成訪客
  router.post('/daily-card/draw', optionalAuth, guestLimiter, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const today = taipeiDayKey(now())
      // 帶了 token 卻驗證不過（過期、已登出）：回 401 讓前端走重新登入，不要當成訪客抽一張不存的牌，
      // 否則重新登入後可以再抽一次，等於繞過「當天不能重抽」（api-reviewer 2026-11-20）
      if (req.get('authorization') && !req.auth) {
        res.status(401).json({ message: '登入已過期，請重新登入。' })
        return
      }
      const userId = req.auth?.userId

      // 登入的人今天抽過就回那張，不重抽
      if (userId) {
        const existing = await DailyCard.findOne({ user: userId, date: today }).lean()
        if (existing) {
          res.json({ today, dailyCard: await viewOf(existing), saved: true, alreadyDrawn: true, streak: await streakFor(userId, today) })
          return
        }
      }

      const card = await pickCard()
      if (!card) {
        res.status(503).json({ message: '牌庫還沒準備好，請稍後再試。' })
        return
      }
      const orientation = randomOrientation()

      // 訪客：不存，附上領取憑證；登入或註冊後用 /daily-card/claim 把這張存進月曆（不用重抽）
      if (!userId) {
        res.json({
          today,
          dailyCard: dailyCardView(card, orientation, today),
          saved: false,
          alreadyDrawn: false,
          streak: 0,
          claim: signClaim({ date: today, cardId: card._id, orientation }),
        })
        return
      }

      try {
        await DailyCard.create({ user: userId, date: today, cardId: card._id, orientation, nameZh: card.nameZh, nameEn: card.nameEn || '', image: card.image || '' })
      } catch (error) {
        // 同時送兩次：唯一索引擋下第二次，回傳先存好的那張
        if (error?.code !== 11000) throw error
        const existing = await DailyCard.findOne({ user: userId, date: today }).lean()
        if (!existing) {
          res.status(409).json({ message: '抽牌時發生衝突，請重新整理再試一次。' })
          return
        }
        res.json({ today, dailyCard: await viewOf(existing), saved: true, alreadyDrawn: true, streak: await streakFor(userId, today) })
        return
      }
      res.status(201).json({
        today,
        dailyCard: dailyCardView(card, orientation, today),
        saved: true,
        alreadyDrawn: false,
        streak: await streakFor(userId, today),
      })
    } catch (error) {
      next(error)
    }
  })

  // 訪客抽的牌，登入或註冊後存進月曆。憑證是伺服器簽的（牌與正逆位改不了），而且只收今天的
  router.post('/daily-card/claim', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const claim = verifyClaim(typeof req.body?.claim === 'string' ? req.body.claim : '')
      if (!claim) {
        res.status(400).json({ message: '領取憑證無效或已過期。' })
        return
      }
      const today = taipeiDayKey(now())
      if (claim.date !== today) {
        res.status(409).json({ message: '這張牌不是今天抽的，不能存進今天的月曆。' })
        return
      }
      const userId = req.auth.userId
      // 今天已經抽過（例如在別的裝置），以已經存的為準，不覆蓋
      const existing = await DailyCard.findOne({ user: userId, date: today }).lean()
      if (existing) {
        res.json({ today, dailyCard: await viewOf(existing), saved: true, alreadyDrawn: true, claimed: false, streak: await streakFor(userId, today) })
        return
      }
      const card = await Card.findById(claim.cardId).lean()
      if (!card) {
        res.status(400).json({ message: '找不到這張牌，請重新抽一次。' })
        return
      }
      try {
        await DailyCard.create({ user: userId, date: today, cardId: card._id, orientation: claim.orientation, nameZh: card.nameZh, nameEn: card.nameEn || '', image: card.image || '' })
      } catch (error) {
        if (error?.code !== 11000) throw error
        const saved = await DailyCard.findOne({ user: userId, date: today }).lean()
        if (!saved) {
          res.status(409).json({ message: '存牌時發生衝突，請重新整理再試一次。' })
          return
        }
        res.json({ today, dailyCard: await viewOf(saved), saved: true, alreadyDrawn: true, claimed: false, streak: await streakFor(userId, today) })
        return
      }
      res.status(201).json({
        today,
        dailyCard: dailyCardView(card, claim.orientation, today),
        saved: true,
        alreadyDrawn: false,
        claimed: true,
        streak: await streakFor(userId, today),
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/calendar', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const range = monthRange(req.query.month)
      if (!range) {
        res.status(400).json({ message: '月份格式要是 YYYY-MM。' })
        return
      }
      const userId = req.auth.userId
      const today = taipeiDayKey(now())
      const [dailyRows, readings, streak, journals] = await Promise.all([
        DailyCard.find({ user: userId, date: { $gte: range.firstDay, $lt: range.nextFirstDay } }).lean(),
        Reading.find({ user: userId, createdAt: { $gte: range.start, $lt: range.end } })
          .sort({ createdAt: -1 })
          .select('question spreadName createdAt cards.nameZh cards.orientation')
          .lean(),
        streakFor(userId, today),
        // 當天寫的日記（v26 計畫 2）：依日記的日期放，不是依它寫在哪一筆底下
        // 每日一牌的日記 2026-11-20 拿掉，舊資料不列
        JournalEntry.find({ user: userId, targetKind: { $in: ['reading', 'stock'] }, entryDate: { $gte: range.firstDay, $lt: range.nextFirstDay } })
          .sort({ entryDate: 1, createdAt: 1 })
          .select('targetKind targetId title text outcome entryDate')
          .lean(),
      ])

      const cardIds = [...new Set(dailyRows.map((row) => String(row.cardId)))]
      // 牌義也要（點月曆上的牌開小彈窗，內容和今天的牌一樣，2026-11-20 使用者要求）；一個月最多 31 張
      const cards = cardIds.length ? await Card.find({ _id: { $in: cardIds } }).select('nameZh nameEn image suit arcanaType keywords sections').lean() : []
      const cardById = new Map(cards.map((card) => [String(card._id), card]))

      const days = new Map()
      const dayOf = (date) => {
        if (!days.has(date)) days.set(date, { date, dailyCard: null, readings: [], journals: [] })
        return days.get(date)
      }
      for (const row of dailyRows) {
        // 對不到牌庫時用存下來的快照
        const card = cardById.get(String(row.cardId)) || (row.nameZh ? { _id: row.cardId, nameZh: row.nameZh, nameEn: row.nameEn, image: row.image } : null)
        if (!card) continue
        // detail：和 /daily-card/today 同一個格式（快照時沒有牌義文字）
        dayOf(row.date).dailyCard = { nameZh: card.nameZh, image: card.image || '', orientation: row.orientation, detail: dailyCardView(card, row.orientation, row.date) }
      }
      for (const reading of readings) {
        const day = dayOf(taipeiDayKey(new Date(reading.createdAt)))
        if (day.readings.length >= READINGS_PER_DAY) continue
        day.readings.push({
          id: String(reading._id),
          question: reading.question || '',
          spreadName: reading.spreadName || '',
          createdAt: new Date(reading.createdAt).toISOString(),
          cards: (reading.cards || []).map((card) => `${card.nameZh || ''}${card.orientation === 'reversed' ? '逆' : '正'}`),
        })
      }

      for (const entry of journals) {
        const day = dayOf(entry.entryDate)
        if (day.journals.length >= READINGS_PER_DAY) continue
        day.journals.push({ id: String(entry._id), target: `${entry.targetKind}:${entry.targetId}`, title: entry.title || '', text: entry.text || '', outcome: entry.outcome || null })
      }

      res.json({
        month: range.month,
        today,
        streak,
        days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createDailyCardRouter, STREAK_LOOKBACK, READINGS_PER_DAY }
