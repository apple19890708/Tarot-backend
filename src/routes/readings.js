// 占卜紀錄（v13）：列表、單筆回顧、刪除。都只看得到自己的紀錄。
// 注意：requireAuth 掛在各路由上，不用 router.use——這個 router 與
// POST /api/readings/draw 等公開端點共用 /api/readings 前綴，
// 用 router.use 會把那些未登入也能用的端點一起擋掉。
const express = require('express')
const mongoose = require('mongoose')

const ReadingModel = require('../models/Reading')
const spreads = require('../data/spreads')
const { loadCardsInOrder: defaultLoadCardsInOrder } = require('../services/cardLoader')
const { buildReadingWithDictionary } = require('../services/readingService')
const { saveReading, toReadingInput } = require('../services/readingHistory')
const {
  validateManualCards,
  validateQuestion,
  resolveDomain,
  resolveCustomSpread,
} = require('../services/manualDraw')

const PAGE_SIZE_DEFAULT = 20
const PAGE_SIZE_MAX = 50
// AI 解讀是由本服務產生後送給前端的，保存時再送回來；長度仍要擋，避免被塞無關的大量文字
const NARRATION_MAX_LENGTH = 20000

// Reading 與 loadCardsInOrder 可以注入，測試才不必連資料庫
function createReadingsRouter({
  ensureDatabase,
  requireAuth,
  Reading = ReadingModel,
  loadCardsInOrder = defaultLoadCardsInOrder,
}) {
  const router = express.Router()

  // 保存：由使用者在結果頁按「保存紀錄」才建立。
  // 只收輸入（問題、牌與正逆位、牌陣或自訂位置），分析不收也不存，之後一律重算。
  // 例外是 narration：AI 解讀是本服務剛剛產生給他的，無法重算，所以接受一起存回來。
  router.post('/', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) {
        return
      }

      const { question, error: questionError } = validateQuestion(req.body.question)
      if (questionError) {
        res.status(400).json({ message: questionError })
        return
      }

      const { drawn, error: cardsError } = validateManualCards(req.body.cards)
      if (cardsError) {
        res.status(400).json({ message: cardsError })
        return
      }

      const { domain, error: domainError } = resolveDomain(req.body.domain)
      if (domainError) {
        res.status(400).json({ message: domainError })
        return
      }

      // 有牌陣就用牌陣，沒有就看使用者有沒有自訂位置；兩者都沒有則是自選牌
      let spread = null
      if (req.body.spreadKey && req.body.spreadKey !== 'manual' && req.body.spreadKey !== 'custom') {
        spread = spreads.find((item) => item.key === req.body.spreadKey) || null
        if (!spread) {
          res.status(400).json({ message: '找不到指定牌陣。' })
          return
        }
        if (drawn.length !== spread.cardCount) {
          res.status(400).json({
            message: `${spread.name} 需要 ${spread.cardCount} 張牌，目前有 ${drawn.length} 張。`,
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

      const { narration, error: narrationError } = resolveNarration(req.body.narration)
      if (narrationError) {
        res.status(400).json({ message: narrationError })
        return
      }

      // 牌名要存一份給列表顯示，所以還是要回牌庫確認這些牌真的存在
      const { cards, error: loadError } = await loadCardsInOrder(drawn)
      if (loadError) {
        res.status(400).json({ message: loadError })
        return
      }

      const record = await saveReading({
        userId: req.auth.userId,
        question,
        domain,
        spread,
        drawn,
        cards,
        narration,
        Reading,
      })

      res.status(201).json({ id: String(record._id), createdAt: record.createdAt })
    } catch (error) {
      next(error)
    }
  })

  // 列表：只回摘要（問題、牌名、有沒有 AI 解讀），分析一律等點開才重算
  router.get('/', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) {
        return
      }

      const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1)
      const requestedSize = Number.parseInt(req.query.pageSize || '', 10)
      const pageSize = Math.min(
        PAGE_SIZE_MAX,
        Math.max(1, Number.isNaN(requestedSize) ? PAGE_SIZE_DEFAULT : requestedSize),
      )

      const filter = { user: req.auth.userId }
      const [total, records] = await Promise.all([
        Reading.countDocuments(filter),
        Reading.find(filter)
          // createdAt 只到毫秒，同一毫秒的多筆順序未定義，用 _id 當第二個排序鍵，翻頁才不會重複或漏掉
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize),
      ])

      res.json({
        page,
        pageSize,
        total,
        readings: records.map((record) => record.toSummaryJSON()),
      })
    } catch (error) {
      next(error)
    }
  })

  // 單筆回顧：依存下來的牌與正逆位重算分析，再把 AI 解讀（如果有）一起回傳
  router.get('/:id', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) {
        return
      }

      const record = await findOwnReading(Reading, req.params.id, req.auth.userId)
      if (!record) {
        res.status(404).json({ message: '找不到這筆紀錄。' })
        return
      }

      const { drawn, spread } = toReadingInput(record, spreads)
      const { cards, error } = await loadCardsInOrder(drawn)
      if (error) {
        res.status(409).json({ message: '這筆紀錄的牌卡已經不在牌庫中，無法重新解讀。' })
        return
      }

      const reading = await buildReadingWithDictionary({
        question: record.question,
        spread,
        cards,
        drawOrientation: (index) => drawn[index].orientation,
        domain: record.domain || null,
      })

      res.json({
        id: String(record._id),
        createdAt: record.createdAt,
        domain: record.domain || null,
        reading,
        narration: record.narration
          ? {
              text: record.narration.text,
              model: record.narration.model || '',
              createdAt: record.narration.createdAt,
            }
          : null,
      })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/:id', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) {
        return
      }

      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這筆紀錄。' })
        return
      }

      // 條件帶上 user，別人的紀錄一律當成不存在
      const result = await Reading.deleteOne({ _id: req.params.id, user: req.auth.userId })
      if (result.deletedCount === 0) {
        res.status(404).json({ message: '找不到這筆紀錄。' })
        return
      }

      res.json({ deleted: true })
    } catch (error) {
      next(error)
    }
  })

  return router
}

// 保存時可以一起帶上剛才產生好的 AI 解讀；沒有就是 null（之後仍可在紀錄頁補做）
function resolveNarration(raw) {
  if (raw === undefined || raw === null) {
    return { narration: null }
  }
  const text = typeof raw.text === 'string' ? raw.text.trim() : ''
  if (!text) {
    return { narration: null }
  }
  if (text.length > NARRATION_MAX_LENGTH) {
    return { error: 'AI 解讀內容過長，無法保存。' }
  }
  const model = typeof raw.model === 'string' ? raw.model.slice(0, 100) : ''

  return { narration: { text, model, createdAt: new Date() } }
}

// id 不合法時直接當成找不到，避免 CastError。
// 查詢條件就帶上 user，不是查到之後才比對——別人的紀錄一律當成不存在。
async function findOwnReading(Reading, id, userId) {
  if (!mongoose.isValidObjectId(id)) {
    return null
  }
  return Reading.findOne({ _id: id, user: userId })
}

module.exports = { createReadingsRouter, findOwnReading }
