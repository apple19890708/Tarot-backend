// 占卜日記 API（v26 計畫 2、2-2）。全部要登入，只看得到、只改得到自己的：
//   GET    /journal?target=reading:<id> | stock:<市場>:<代號>  這個對象的日記（依日期排的時間軸）
// 每日一牌的日記（daily:<日期>）2026-11-20 使用者決定拿掉：不再接受，月曆也不列（資料表的 enum 留著，舊資料讀得出來）
// 股票日記一檔一本（stock:tw:0050）；每篇可帶 stock（記錄股票的欄位），只有股票日記收
//   POST   /journal                                          新增一篇 { target, title?, content, outcome?, entryDate?, stock? }
//   PUT    /journal/:id                                      修改 { title?, content?, outcome?, entryDate?, stock? }
//   DELETE /journal/:id
// 日記內容不送給 AI（v26 不做的事）。依賴可以注入，測試不必連資料庫
const express = require('express')
const mongoose = require('mongoose')
const { rateLimit } = require('express-rate-limit')

const JournalEntryModel = require('../models/JournalEntry')
const ReadingModel = require('../models/Reading')
const MarketAnalysisModel = require('../models/MarketAnalysis')
const MarketWatchModel = require('../models/MarketWatch')
const { OUTCOMES, TITLE_MAX } = JournalEntryModel
const { validateJournalContent, summaryOf } = require('../services/journalContent')
const { parseStockKey, findForStock, parseStockFields, hasStockRecord } = require('../services/stockJournal')
const { taipeiDayKey } = require('../services/dailyCard')

// 一個對象最多幾篇（一般後續追蹤用不到這麼多，只是擋灌資料）
const MAX_ENTRIES_PER_TARGET = 100
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// 新增與修改的限速（api-reviewer 2026-11-20）：依帳號計，每分鐘 30 次，一般寫日記碰不到；
// 擋的是用程式灌資料（每天都是新的對象，每個對象 100 篇的上限擋不住總量）。計數在記憶體，Cloud Run 多實例各算各的
function defaultWriteLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => `journal:${req.auth?.userId}`,
    message: { message: '日記存太多次了，請稍後再試。' },
  })
}

// "reading:<id>" / "stock:<市場>:<代號>" → { kind, id }（股票另帶 stock）或 null。
// 舊的 stock:<分析 id> 不再收（啟動時已轉成股票鍵；前端舊網址會先查分析再轉到新網址）
function parseTarget(value) {
  if (typeof value !== 'string') return null
  const index = value.indexOf(':')
  if (index < 0) return null
  const kind = value.slice(0, index)
  const rest = value.slice(index + 1)
  if (kind === 'reading') return /^[a-f0-9]{24}$/i.test(rest) ? { kind, id: rest.toLowerCase() } : null
  if (kind === 'stock') {
    const stock = parseStockKey(rest)
    return stock ? { kind, id: stock.key, stock } : null
  }
  return null
}

function isRealDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && year >= 2000
}

function viewOf(entry) {
  return {
    id: String(entry._id),
    target: `${entry.targetKind}:${entry.targetId}`,
    title: entry.title || '',
    content: entry.content,
    text: entry.text || '',
    outcome: entry.outcome || null,
    entryDate: entry.entryDate,
    stock: entry.targetKind === 'stock' && hasStockRecord(entry.stock) ? stockView(entry.stock) : null,
    createdAt: new Date(entry.createdAt).toISOString(),
    updatedAt: new Date(entry.updatedAt || entry.createdAt).toISOString(),
  }
}

function stockView(stock) {
  const pick = (key) => stock[key] ?? null
  return {
    action: pick('action'),
    price: pick('price'),
    quantity: pick('quantity'),
    unit: pick('unit'),
    quoteAtWrite: pick('quoteAtWrite'),
    quoteDate: pick('quoteDate'),
    targetPrice: pick('targetPrice'),
    stopPrice: pick('stopPrice'),
  }
}

// 標題：沒帶就不改（undefined）；去頭尾空白、換行換成空白
function parseTitle(value) {
  if (value === undefined) return { value: undefined }
  if (typeof value !== 'string') return { error: '標題格式不對。' }
  const title = value.replace(/\s+/g, ' ').trim()
  if (title.length > TITLE_MAX) return { error: `標題最多 ${TITLE_MAX} 個字。` }
  return { value: title }
}

// 結果標記：沒帶就不改（undefined），null＝還不知道
function parseOutcome(value) {
  if (value === undefined) return { value: undefined }
  if (value === null || OUTCOMES.includes(value)) return { value }
  return { error: '結果標記只能是應驗了、部分應驗、沒有應驗或還不知道。' }
}

function createJournalRouter({
  ensureDatabase,
  requireAuth,
  JournalEntry = JournalEntryModel,
  Reading = ReadingModel,
  MarketAnalysis = MarketAnalysisModel,
  MarketWatch = MarketWatchModel,
  now = () => new Date(),
  writeLimiter = defaultWriteLimiter(),
}) {
  const router = express.Router()

  // 對象要是自己的：自己的塔羅紀錄；股票要是自己分析過或追蹤中的（不能寫任意代號灌資料）
  async function ownsTarget(userId, target) {
    if (target.kind === 'reading') return Boolean(await Reading.findOne({ _id: target.id, user: userId }).select('_id').lean())
    const [analyses, watches] = await Promise.all([
      findForStock(MarketAnalysis, userId, target.stock),
      findForStock(MarketWatch, userId, target.stock),
    ])
    return analyses.length > 0 || watches.length > 0
  }

  // 記錄股票的欄位只有股票日記收；回傳 false 時已回 400
  function readStockFields(body, kind, res) {
    const parsed = parseStockFields(body.stock)
    if (parsed.error) {
      res.status(400).json({ message: parsed.error })
      return null
    }
    if (parsed.value && kind !== 'stock') {
      res.status(400).json({ message: '只有股票日記可以記錄股票。' })
      return null
    }
    return parsed
  }

  function checkEntryDate(value, res) {
    if (!isRealDate(value)) {
      res.status(400).json({ message: '日期格式要是 YYYY-MM-DD。' })
      return false
    }
    if (value > taipeiDayKey(now())) {
      res.status(400).json({ message: '日記的日期不能在未來。' })
      return false
    }
    return true
  }

  router.get('/journal', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const target = parseTarget(req.query.target)
      if (!target) {
        res.status(400).json({ message: '要指定是哪一筆紀錄。' })
        return
      }
      const entries = await JournalEntry.find({ user: req.auth.userId, targetKind: target.kind, targetId: target.id })
        .sort({ entryDate: 1, createdAt: 1 })
        .limit(MAX_ENTRIES_PER_TARGET)
        .lean()
      res.json({ entries: entries.map(viewOf) })
    } catch (error) {
      next(error)
    }
  })

  router.post('/journal', requireAuth, writeLimiter, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const body = req.body || {}
      const target = parseTarget(body.target)
      if (!target) {
        res.status(400).json({ message: '要指定是哪一筆紀錄。' })
        return
      }
      const checked = validateJournalContent(body.content)
      if (checked.error) {
        res.status(400).json({ message: checked.error })
        return
      }
      const outcome = parseOutcome(body.outcome)
      if (outcome.error) {
        res.status(400).json({ message: outcome.error })
        return
      }
      const title = parseTitle(body.title)
      if (title.error) {
        res.status(400).json({ message: title.error })
        return
      }
      const stock = readStockFields(body, target.kind, res)
      if (!stock) return
      // 只填了股票欄位（例如買進 1 張）也算有寫
      if (!checked.text && !outcome.value && !title.value && !stock.value) {
        res.status(400).json({ message: '日記是空的。' })
        return
      }
      const entryDate = body.entryDate === undefined ? taipeiDayKey(now()) : body.entryDate
      if (!checkEntryDate(entryDate, res)) return

      const userId = req.auth.userId
      // 別人的紀錄、沒抽過的那天一律當成不存在
      if (!(await ownsTarget(userId, target))) {
        res.status(404).json({ message: target.kind === 'stock' ? '這檔股票要先分析過或加入追蹤，才能寫日記。' : '找不到這筆紀錄。' })
        return
      }
      const count = await JournalEntry.countDocuments({ user: userId, targetKind: target.kind, targetId: target.id })
      if (count >= MAX_ENTRIES_PER_TARGET) {
        res.status(409).json({ message: `同一筆最多寫 ${MAX_ENTRIES_PER_TARGET} 篇日記。` })
        return
      }

      const entry = await JournalEntry.create({
        user: userId,
        targetKind: target.kind,
        targetId: target.id,
        title: title.value ?? '',
        content: checked.content,
        text: summaryOf(checked.text),
        outcome: outcome.value ?? null,
        entryDate,
        stock: stock.value ?? null,
      })
      res.status(201).json({ entry: viewOf(entry) })
    } catch (error) {
      next(error)
    }
  })

  router.put('/journal/:id', requireAuth, writeLimiter, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這篇日記。' })
        return
      }
      const body = req.body || {}
      const update = {}
      if (body.content !== undefined) {
        const checked = validateJournalContent(body.content)
        if (checked.error) {
          res.status(400).json({ message: checked.error })
          return
        }
        update.content = checked.content
        update.text = summaryOf(checked.text)
      }
      const outcome = parseOutcome(body.outcome)
      if (outcome.error) {
        res.status(400).json({ message: outcome.error })
        return
      }
      if (outcome.value !== undefined) update.outcome = outcome.value
      const title = parseTitle(body.title)
      if (title.error) {
        res.status(400).json({ message: title.error })
        return
      }
      if (title.value !== undefined) update.title = title.value
      if (body.entryDate !== undefined) {
        if (!checkEntryDate(body.entryDate, res)) return
        update.entryDate = body.entryDate
      }
      if (!Object.keys(update).length && body.stock === undefined) {
        res.status(400).json({ message: '沒有要修改的內容。' })
        return
      }

      // 條件帶上 user，別人的日記一律當成不存在
      const entry = await JournalEntry.findOne({ _id: req.params.id, user: req.auth.userId })
      if (!entry) {
        res.status(404).json({ message: '找不到這篇日記。' })
        return
      }
      // 股票欄位要看這篇是不是股票日記才知道收不收；帶了就整組換掉，null＝清掉
      const stock = readStockFields(body, entry.targetKind, res)
      if (!stock) return
      if (stock.value !== undefined) update.stock = stock.value
      const nextText = update.text ?? entry.text
      const nextOutcome = update.outcome !== undefined ? update.outcome : entry.outcome
      const nextTitle = update.title ?? entry.title
      const nextStock = update.stock !== undefined ? update.stock : entry.stock
      if (!nextText && !nextOutcome && !nextTitle && !hasStockRecord(nextStock)) {
        res.status(400).json({ message: '日記是空的。' })
        return
      }
      Object.assign(entry, update)
      // content 是 Mixed，要明說改過了才會存
      if (update.content) entry.markModified('content')
      await entry.save()
      res.json({ entry: viewOf(entry) })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/journal/:id', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這篇日記。' })
        return
      }
      const result = await JournalEntry.deleteOne({ _id: req.params.id, user: req.auth.userId })
      if (result.deletedCount === 0) {
        res.status(404).json({ message: '找不到這篇日記。' })
        return
      }
      res.json({ deleted: true })
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createJournalRouter, parseTarget, MAX_ENTRIES_PER_TARGET }
