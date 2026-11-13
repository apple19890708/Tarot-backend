// 占卜紀錄（v13）：保存、列表、單筆回顧、補存 AI 解讀、刪除。都只看得到自己的紀錄。
// 注意：requireAuth 掛在各路由上，不用 router.use——這個 router 與
// POST /api/readings/draw 等公開端點共用 /api/readings 前綴，
// 用 router.use 會把那些未登入也能用的端點一起擋掉。
const express = require('express')
const mongoose = require('mongoose')

const ReadingModel = require('../models/Reading')
const spreads = require('../data/spreads')
const { loadCardsInOrder: defaultLoadCardsInOrder } = require('../services/cardLoader')
const { buildReadingWithDictionary } = require('../services/readingService')
const {
  saveReading,
  toReadingInput,
  isSameCards,
  followUpRelation,
  mergeFollowUpRecords,
} = require('../services/readingHistory')
const { loadFollowUps, buildFollowUpEntries } = require('../services/followUp')
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
  // 股市諮詢這類限 AI 權限的問題類型，由 server 注入檢查；測試沒注入時一律放行
  ensureDomainAllowed = async () => true,
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
      if (!(await ensureDomainAllowed(req, res, domain))) {
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

      const { narration, error: narrationError } = resolveNarration(req.body.narration, { allowMarket: domain === 'stock' })
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

      // 保存前已經追問過的，一起存（追問與它的 AI 延伸回答）
      const { followUps, error: followUpError } = await loadFollowUps(req.body.followUps, drawn, loadCardsInOrder)
      if (followUpError) {
        res.status(400).json({ message: followUpError })
        return
      }
      const { narration: followUpNarration, error: followUpNarrationError } = resolveFollowUpNarration(req.body.followUpNarration)
      if (followUpNarrationError) {
        res.status(400).json({ message: followUpNarrationError })
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
        followUps,
        followUpNarration,
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
        followUps: await restoreFollowUps(record, loadCardsInOrder),
        followUpNarration: record.followUpNarration
          ? {
              text: record.followUpNarration.text,
              model: record.followUpNarration.model || '',
              // 涵蓋了幾次追問（0＝舊資料沒記，前端當成全部涵蓋）
              rounds: record.followUpNarration.rounds || 0,
              createdAt: record.followUpNarration.createdAt,
            }
          : null,
        narration: record.narration
          ? {
              text: record.narration.text,
              model: record.narration.model || '',
              market: record.narration.market || null,
              createdAt: record.narration.createdAt,
            }
          : null,
      })
    } catch (error) {
      next(error)
    }
  })

  // 補存或更新這筆紀錄的 AI 解讀（2026-11-12）：AI 寫的過程中才按保存時，那次 AI 請求沒有紀錄 id，
  // 後端寫完不會存回；前端在 AI 完成後用這支補上。已經有解讀時直接覆蓋（重新產生的較新）。
  // 只收解讀文字與當時的行情（同 POST 的 narration 規則），牌與問題不能從這裡改。
  // body.cards 是這段解讀當時的牌（[{ id, orientation }]），和紀錄的牌不一樣就不存（409）：
  // 前端狀態錯亂時（例如重抽了），不會把另一組牌的解讀存進這筆
  router.put('/:id/narration', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) {
        return
      }
      const record = await findOwnReading(Reading, req.params.id, req.auth.userId)
      if (!record) {
        res.status(404).json({ message: '找不到這筆紀錄。' })
        return
      }
      if (!isSameCards(record.cards, req.body?.cards)) {
        res.status(409).json({ message: '這段 AI 解讀和紀錄的牌不一樣，沒有存。' })
        return
      }
      const { narration, error } = resolveNarration(req.body, { allowMarket: record.domain === 'stock' })
      if (error) {
        res.status(400).json({ message: error })
        return
      }
      if (!narration) {
        res.status(400).json({ message: '沒有 AI 解讀內容。' })
        return
      }
      record.narration = narration
      await record.save()
      res.json({ saved: true })
    } catch (error) {
      next(error)
    }
  })

  // 更新這筆紀錄的追問（v23）：已經保存的紀錄再追問、抽補充牌，或 AI 延伸回答寫完時由前端呼叫。
  // 整批取代（追問最多三次，前端手上的就是完整清單）。body.cards 是原牌陣的牌，和紀錄不一樣就不存（409）。
  // body.narration：有這個 key 才動延伸回答（物件＝存、null＝清掉）；沒有就保留原本的
  router.put('/:id/follow-ups', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) {
        return
      }
      const record = await findOwnReading(Reading, req.params.id, req.auth.userId)
      if (!record) {
        res.status(404).json({ message: '找不到這筆紀錄。' })
        return
      }
      if (!isSameCards(record.cards, req.body?.cards)) {
        res.status(409).json({ message: '這些追問和紀錄的牌不一樣，沒有存。' })
        return
      }
      const { followUps, error } = await loadFollowUps(req.body.followUps, req.body.cards, loadCardsInOrder)
      if (error) {
        res.status(400).json({ message: error })
        return
      }
      // 延伸回答要先檢查（有錯就整筆不寫）
      const hasNarrationKey = Boolean(req.body) && 'narration' in req.body
      let nextNarration = null
      if (hasNarrationKey) {
        const { narration, error: narrationError } = resolveFollowUpNarration(req.body.narration)
        if (narrationError) {
          res.status(400).json({ message: narrationError })
          return
        }
        nextNarration = narration ? { ...narration, rounds: followUps.length } : null
      }
      const relation = followUpRelation(record.followUps, followUps)
      record.followUps = followUps.length > 0 ? mergeFollowUpRecords(record.followUps, followUps) : undefined
      if (followUps.length === 0) {
        record.followUpNarration = null
      } else if (hasNarrationKey) {
        record.followUpNarration = nextNarration
      } else if (relation === 'behind' || relation === 'different') {
        // 追問被換成另一組或變少了：原本的延伸回答講的已經不是這些牌，不能留著配新的追問
        record.followUpNarration = null
      }
      await record.save()
      res.json({ saved: true })
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

// 解讀時查到的市場資料由前端帶回來（還沒保存成紀錄時，後端沒有地方先存）。
// 只有股市諮詢才收；只做形狀、大小與 key 的檢查，不合格就不存（解讀照存）。
// 內容只有本人讀得到，前端也只當數字與純文字顯示，不會當 HTML
// 含圖表與回測曲線，一個標的約 20KB，最多 4 個
const MARKET_MAX_LENGTH = 200000
const MARKET_MAX_DEPTH = 8

// Mongo 不接受以 $ 開頭或含 . 的 key（存進 Mixed 欄位會 save 失敗），結構也不該太深
function hasUnsafeKeys(value, depth = 0) {
  if (depth > MARKET_MAX_DEPTH) return true
  if (Array.isArray(value)) return value.some((v) => hasUnsafeKeys(v, depth + 1))
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, v]) => key.startsWith('$') || key.includes('.') || hasUnsafeKeys(v, depth + 1))
  }
  return false
}

function resolveMarket(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.items)) {
    return null
  }
  if (JSON.stringify(raw).length > MARKET_MAX_LENGTH || hasUnsafeKeys(raw)) {
    return null
  }
  return raw
}

// 保存時可以一起帶上剛才產生好的 AI 解讀；沒有就是 null（之後仍可在紀錄頁補做）
// allowMarket：只有股市諮詢的紀錄才收行情資料
function resolveNarration(raw, { allowMarket = false } = {}) {
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

  return { narration: { text, model, market: allowMarket ? resolveMarket(raw.market) : null, createdAt: new Date() } }
}

// 追問的 AI 延伸回答：規則同 narration，但不收行情資料
function resolveFollowUpNarration(raw) {
  const { narration, error } = resolveNarration(raw)
  if (error || !narration) return { narration: null, error }
  return { narration: { text: narration.text, model: narration.model, createdAt: narration.createdAt } }
}

// 把紀錄裡的追問還原成畫面要的樣子（含牌義）。牌已經不在牌庫的那一次略過，不讓整筆紀錄打不開
async function restoreFollowUps(record, loadCardsInOrder) {
  const stored = Array.isArray(record.followUps) ? record.followUps : []
  const restored = []
  for (const followUp of stored) {
    const drawn = followUp.cards.map((card) => ({ id: String(card.cardId), orientation: card.orientation }))
    const { cards, error } = await loadCardsInOrder(drawn)
    if (error) continue
    restored.push({ question: followUp.question, createdAt: followUp.createdAt, cards: buildFollowUpEntries(cards, drawn) })
  }
  return restored
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
