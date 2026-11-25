// 雷諾曼 API（v27，詳見 doc/v27-lenormand-plan.md 3-6、3-12）。掛在 /api/lenormand。
// 整個 router 先過 requireLenormandAccess：未登入 401、沒開通 403，admin 一律放行（例外：DELETE /readings/:id 與 /my-data 只要登入）。
// 不靠個別端點記得加權限；之後新增的 AI 解讀、紀錄端點都在這個 router 底下，自動受保護。
// 注意：寫在 router.use(requireLenormandAccess) 前面的路由不受這層保護（目前只有刪除紀錄與 /my-data），新增端點一律放在它後面。
//
//   GET  /cards           52 張牌與撲克花色解說表 → { cards, playingCardGuide }
//   GET  /spreads         5 種牌陣與 36 宮位      → { spreads, houses }
//   POST /readings/draw   後端洗牌抽牌            → 3-12 的回應
//   POST /readings/manual 扇形挑牌或輸入實體牌    → 3-12 的回應（依牌號重算分析）
//   POST /readings/narrate AI 解讀（階段 7，3-14） → NDJSON 串流；另外要 AI 權限
//   POST   /readings      保存紀錄（階段 6，3-13）  → { id, createdAt }
//   GET    /readings      紀錄列表                  → { page, pageSize, total, readings }
//   GET    /readings/:id  紀錄詳情（重算分析）      → 3-12 的回應 ＋ id、createdAt、narration
//   DELETE /readings/:id  刪除，連同它的日記        → { deleted: true }（只要登入，不要雷諾曼權限）
//   GET    /my-data       自己有幾筆雷諾曼紀錄與日記 → { readings, journals }（只要登入；帳號設定的「刪除我的雷諾曼紀錄」用）
//   DELETE /my-data       刪除自己所有雷諾曼紀錄與日記 → { deletedReadings, deletedJournals }（只要登入）
// 紀錄只看得到、動得到自己的；別人的、不存在的、格式不對的 id 一律 404。
// 大藍圖（階段 5）要選代表牌；draw 一定放入代表牌，manual 照使用者攤出的牌。
const crypto = require('crypto')
const express = require('express')

const { cards } = require('../data/lenormand/cards')
const { spreads } = require('../data/lenormand/spreads')
const { houses } = require('../data/lenormand/houses')
const { playingCardGuide } = require('../data/lenormand/playingCards')
const { cardById } = require('../data/lenormand/cards')
const { validateCommon, validateCardIds, drawCardIds, buildLenormandReading } = require('../services/lenormand/reading')
const LenormandReadingModel = require('../models/LenormandReading')
const JournalEntryModel = require('../models/JournalEntry')
const { MAX_LENORMAND_READINGS_PER_USER, MODES } = LenormandReadingModel
const { trimHistory } = require('../services/readingHistory')
const { resolveNarration } = require('./readings')
const { userCanUseAi } = require('../middleware/auth')
const { startNdjson } = require('../lib/ndjsonStream')
const { isNarrationAvailable, NarrationRefusedError } = require('../services/narrationService')
const { streamLenormandNarration } = require('../services/lenormand/narration')
const { checkLenormandNarration } = require('../services/lenormand/narrationCheck')
const { createTarotAiQuota } = require('../services/tarotAiQuota')
const MarketAiUsage = require('../models/MarketAiUsage')

const AI_DENIED = 'AI 解讀需要管理者開通，請聯絡管理者。'

const PAGE_SIZE_DEFAULT = 20
const PAGE_SIZE_MAX = 50
const NOT_FOUND = '找不到這筆紀錄。'
// 只收 24 碼 hex：isValidObjectId 連 12 個字元的字串都放行，日記的 targetId 會對不上（同塔羅 api-reviewer 2026-11-20）
const isRecordId = (id) => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id)

// rng：洗牌用的亂數（rng(max) → 0～max-1），測試可以注入
// LenormandReading、JournalEntry 可以注入，測試不必連資料庫；ensureDatabase 只有紀錄端點用（抽牌不用資料庫）
function createLenormandRouter({
  requireLenormandAccess,
  // 只有刪除紀錄用（見下方）；沒注入時退回 requireLenormandAccess（測試）
  requireAuth = requireLenormandAccess,
  rng = crypto.randomInt,
  ensureDatabase = () => true,
  LenormandReading = LenormandReadingModel,
  JournalEntry = JournalEntryModel,
  // AI 解讀（階段 7）：測試注入假的串流，絕不真的呼叫 OpenRouter
  ai = { isAvailable: isNarrationAvailable, stream: streamLenormandNarration },
  // 每日次數（和塔羅共用 tarotAiQuota，kind 是 lenormand）；server 傳入同一個實例
  aiQuota = createTarotAiQuota({ Usage: MarketAiUsage }),
}) {
  if (typeof requireLenormandAccess !== 'function') {
    throw new Error('createLenormandRouter 需要 requireLenormandAccess。')
  }
  const router = express.Router()

  // 刪除紀錄只要登入、不要雷諾曼權限（2026-11-25 使用者決定）：被收回權限的人仍可以清掉自己的資料，和日記一致。
  // 要放在 router.use(requireLenormandAccess) 前面才不會被擋；查詢條件仍帶 user，只刪得到自己的
  router.delete('/readings/:id', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!isRecordId(req.params.id)) {
        res.status(404).json({ message: NOT_FOUND })
        return
      }
      const result = await LenormandReading.deleteOne({ _id: req.params.id, user: req.auth.userId })
      if (result.deletedCount === 0) {
        res.status(404).json({ message: NOT_FOUND })
        return
      }
      // 這筆的日記一起刪；失敗只記錄（紀錄已經刪了，留下的日記也只有本人看得到）
      await JournalEntry.deleteMany({ user: req.auth.userId, targetKind: 'lenormand', targetId: req.params.id.toLowerCase() }).catch((error) => {
        console.error('[lenormand] 刪除紀錄的日記失敗：', error.message)
      })
      res.json({ deleted: true })
    } catch (error) {
      next(error)
    }
  })

  // 帳號設定的「刪除我的雷諾曼紀錄」（2026-11-25 使用者決定）：被收回權限的人看不到紀錄清單，用這兩支一次清掉。
  // 只要登入；條件一律帶 user，只算、只刪自己的
  router.get('/my-data', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const user = req.auth.userId
      const [readings, journals] = await Promise.all([
        LenormandReading.countDocuments({ user }),
        JournalEntry.countDocuments({ user, targetKind: 'lenormand' }),
      ])
      res.json({ readings, journals })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/my-data', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const user = req.auth.userId
      // 先刪日記再刪紀錄：中途失敗時，留下的紀錄仍可以再按一次刪除
      const journals = await JournalEntry.deleteMany({ user, targetKind: 'lenormand' })
      const readings = await LenormandReading.deleteMany({ user })
      res.json({ deletedReadings: readings?.deletedCount ?? 0, deletedJournals: journals?.deletedCount ?? 0 })
    } catch (error) {
      next(error)
    }
  })

  router.use(requireLenormandAccess)

  router.get('/cards', (_req, res) => {
    res.json({ cards, playingCardGuide })
  })

  router.get('/spreads', (_req, res) => {
    res.json({ spreads, houses })
  })

  router.post('/readings/draw', (req, res) => {
    const common = validateCommon(req.body || {})
    if (common.error) {
      res.status(400).json({ message: common.error })
      return
    }
    // 大藍圖一定放入代表牌（位置隨機），每次都有中心；小牌陣不強制
    const required = common.spread.requiresSignificator ? common.significator : null
    const cardIds = drawCardIds(common.spread.cardCount, rng, required)
    res.json(buildLenormandReading({ mode: 'draw', ...common, cardIds }))
  })

  router.post('/readings/manual', (req, res) => {
    const body = req.body || {}
    const common = validateCommon(body)
    if (common.error) {
      res.status(400).json({ message: common.error })
      return
    }
    const { cardIds, error } = validateCardIds(body.cards, common.spread)
    if (error) {
      res.status(400).json({ message: error })
      return
    }
    res.json(buildLenormandReading({ mode: 'manual', ...common, cardIds }))
  })

  // ---- AI 解讀（階段 7，3-14）----

  // 完整產生的解讀存回使用者自己的那筆紀錄；牌陣、牌號（順序也要一樣）、代表牌、問題類型都要一致，
  // 否則紀錄會配上別次的解讀（問題類型決定關鍵牌，api-reviewer 2026-11-25）。比對條件全放在 updateOne 的 filter，一次完成
  // 回傳 null（沒帶 readingId）、true（已存）、false（沒存成）
  async function saveNarration({ readingId, userId, spread, cardIds, significator, domain, text, model, checks }) {
    if (readingId === undefined || readingId === null || readingId === '') return null
    if (!isRecordId(readingId) || !text) return false
    try {
      const result = await LenormandReading.updateOne(
        { _id: readingId, user: userId, spreadKey: spread.key, significator: significator ?? null, domain: domain ?? null, cards: cardIds },
        { $set: { narration: { text, model: model || '', createdAt: new Date(), checks } } },
      )
      return (result?.matchedCount ?? 0) > 0
    } catch (error) {
      console.error('[lenormand] AI 解讀存檔失敗：', error.message)
      return false
    }
  }

  router.post('/readings/narrate', async (req, res, next) => {
    try {
      // 雷諾曼權限在 router 層；AI 權限用已掛好的 req.user 判斷，不再多查一次資料庫
      if (!userCanUseAi(req.user)) {
        res.status(403).json({ message: AI_DENIED })
        return
      }
      if (!ai.isAvailable()) {
        res.status(503).json({ message: 'AI 解讀尚未設定（缺少 OPENROUTER_API_KEY）。' })
        return
      }
      const body = req.body || {}
      const common = validateCommon(body)
      if (common.error) {
        res.status(400).json({ message: common.error })
        return
      }
      const { cardIds, error } = validateCardIds(body.cards, common.spread)
      if (error) {
        res.status(400).json({ message: error })
        return
      }
      // 依牌號重算，不使用前端傳來的分析
      const reading = buildLenormandReading({ mode: 'manual', ...common, cardIds })

      // 次數記在資料庫：沒連上時回 503（和塔羅一致），不呼叫 AI
      if (!ensureDatabase(res)) return
      const quota = await aiQuota.check(req.auth, 'lenormand')
      if (!quota.allowed) {
        res.status(429).json({ message: aiQuota.limitMessage('lenormand', quota.limit) })
        return
      }

      // 前端中斷連線（按停止、關閉頁面）時，連帶中斷對 AI 的請求以停止計費
      const controller = new AbortController()
      res.on('close', () => {
        if (!res.writableFinished) controller.abort()
      })
      const writeEvent = (event) => res.write(`${JSON.stringify(event)}\n`)
      let text = ''
      let usage = null
      try {
        const { model } = await ai.stream({
          reading,
          signal: controller.signal,
          onStart: () => {
            // 送出標頭並開始心跳；AI 開始產生（開始計費）才記一次
            startNdjson(res)
            usage = aiQuota.record(req.auth.userId, 'lenormand')
          },
          onDelta: (delta) => {
            text += delta
            writeEvent({ type: 'delta', text: delta })
          },
        })
        const checks = checkLenormandNarration(text, { spreadKey: common.spread.key, significator: common.significator })
        // 只有完整產生才存；中途被停止的半截文字不留
        const saved = await saveNarration({
          readingId: body.readingId,
          userId: req.auth.userId,
          spread: common.spread,
          cardIds,
          significator: common.significator,
          domain: common.domain,
          text,
          model,
          checks,
        })
        writeEvent({ type: 'done', model, saved, checks })
        res.end()
      } catch (streamError) {
        if (controller.signal.aborted) {
          console.log('[lenormand] AI 解讀已由使用者中斷')
          return
        }
        // 伺服器或 AI 出錯（不是使用者停止）：退還這次的次數
        void aiQuota.refund(usage)
        if (!res.headersSent) throw streamError
        console.error(streamError)
        writeEvent({
          type: 'error',
          message: streamError instanceof NarrationRefusedError ? 'AI 無法產生這次的解讀。' : 'AI 解讀中途發生錯誤，請再試一次。',
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

  // ---- 紀錄（階段 6）----

  // 保存：只收輸入，分析不收也不存；後端照抽牌的規則重新驗證（大藍圖要 36 張與代表牌）
  router.post('/readings', async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const body = req.body || {}
      const common = validateCommon(body)
      if (common.error) {
        res.status(400).json({ message: common.error })
        return
      }
      const { cardIds, error } = validateCardIds(body.cards, common.spread)
      if (error) {
        res.status(400).json({ message: error })
        return
      }
      // 選填：沒給或 null 都當 manual（和其他選填欄位一致）
      if (body.mode !== undefined && body.mode !== null && !MODES.includes(body.mode)) {
        res.status(400).json({ message: '抽牌方式不正確。' })
        return
      }
      const { narration, error: narrationError } = resolveNarration(body.narration)
      if (narrationError) {
        res.status(400).json({ message: narrationError })
        return
      }
      const userId = req.auth.userId
      const record = await LenormandReading.create({
        user: userId,
        question: common.question,
        domain: common.domain,
        spreadKey: common.spread.key,
        spreadName: common.spread.name,
        significator: common.significator,
        mode: body.mode || 'manual',
        cards: cardIds,
        // 前端送回來的文字（和塔羅一樣），照樣跑一次檢查；不能當成可信的 AI 輸出再送給 AI
        narration: narration
          ? {
              text: narration.text,
              model: narration.model,
              createdAt: narration.createdAt,
              checks: checkLenormandNarration(narration.text, { spreadKey: common.spread.key, significator: common.significator }),
            }
          : null,
      })
      await trimHistory(userId, LenormandReading, JournalEntry, 'lenormand', MAX_LENORMAND_READINGS_PER_USER)
      res.status(201).json({ id: String(record._id), createdAt: record.createdAt })
    } catch (error) {
      next(error)
    }
  })

  router.get('/readings', async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1)
      const requestedSize = Number.parseInt(req.query.pageSize || '', 10)
      const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.isNaN(requestedSize) ? PAGE_SIZE_DEFAULT : requestedSize))
      const filter = { user: req.auth.userId }
      const [total, records] = await Promise.all([
        LenormandReading.countDocuments(filter),
        // 同一毫秒的多筆用 _id 當第二個排序鍵，翻頁才不會重複或漏掉
        LenormandReading.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize),
      ])
      res.json({ page, pageSize, total, readings: records.map((record) => record.toSummaryJSON(cardById)) })
    } catch (error) {
      next(error)
    }
  })

  // 詳情：依存下來的牌號重算分析（形狀同 draw），加上 id、createdAt、AI 解讀
  router.get('/readings/:id', async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!isRecordId(req.params.id)) {
        res.status(404).json({ message: NOT_FOUND })
        return
      }
      // 條件帶上 user，別人的紀錄一律當成不存在
      const record = await LenormandReading.findOne({ _id: req.params.id, user: req.auth.userId })
      if (!record) {
        res.status(404).json({ message: NOT_FOUND })
        return
      }
      const common = validateCommon({ spreadKey: record.spreadKey, question: record.question, domain: record.domain, significator: record.significator })
      const checked = common.error ? null : validateCardIds([...record.cards], common.spread)
      if (common.error || checked.error) {
        res.status(409).json({ message: '這筆紀錄的資料不完整，無法重新解讀。' })
        return
      }
      const reading = buildLenormandReading({ mode: record.mode || 'manual', ...common, cardIds: checked.cardIds })
      res.json({
        id: String(record._id),
        createdAt: record.createdAt,
        ...reading,
        narration: record.narration?.text
          ? { text: record.narration.text, model: record.narration.model || '', createdAt: record.narration.createdAt, checks: [...(record.narration.checks || [])] }
          : null,
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createLenormandRouter }
