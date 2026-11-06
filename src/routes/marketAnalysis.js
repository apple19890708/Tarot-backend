// 個股分析（v17 規格 F）：追蹤卡片的「個股分析」彈窗、AI 深度分析，以及「我的紀錄」的「股票分析」。
// 分析本身不呼叫 AI；只有 POST /watchlist/:id/analysis/ai 會呼叫（要 AI 權限、有次數限制）。
// 依賴以參數注入，測試時不必連資料庫、外部 API 或 AI。
const express = require('express')
const mongoose = require('mongoose')

const { computePosition, normalizeFees, tradesOf, DEFAULT_FEES } = require('../services/market/portfolio')
const { buildStockAnalysisMessages } = require('../services/market/stockAnalysis')
const { NarrationRefusedError } = require('../services/narrationService')

// 每人每天最多幾次 AI 深度分析（admin 不限）；同一檔要隔多久才能再跑一次
const DAILY_LIMIT = 20
const COOLDOWN_MS = 5 * 60 * 1000
// 彈窗與 AI 都只附最近幾則重大訊息
const NEWS_LIMIT = 3
const TW_TIMEZONE = 'Asia/Taipei'

// 台北時間今天 00:00 的 Date（每日次數以台北的一天計算）
function startOfTaipeiDay(nowMs) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TW_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(nowMs),
  )
  return new Date(`${ymd}T00:00:00+08:00`)
}

// 存進紀錄與交給 AI 的持股摘要；沒有任何買賣或股利時為 null
function holdingOf(watch, item, fees) {
  const trades = tradesOf(watch)
  const dividends = (watch.dividends || []).map((d) => ({ amount: d.amount, date: d.date || null }))
  if (!trades.length && !dividends.length) return null
  const position = computePosition({
    target: watch.target,
    trades,
    dividends,
    fees,
    quote: item?.quote ? { price: item.quote.price, change: item.quote.change, date: item.quote.date } : null,
  })
  return {
    market: watch.target.market,
    currency: item?.currency || (watch.target.market === 'tw' ? 'TWD' : 'USD'),
    quantity: position.quantity,
    avgCost: position.avgCost,
    costBasis: position.costBasis,
    marketValue: position.marketValue,
    unrealized: position.unrealized,
    unrealizedPct: position.unrealizedPct,
    realized: position.realized,
    dividends: position.dividends,
    totalReturn: position.totalReturn,
  }
}

function createMarketAnalysisRouter({
  requireStockAccess,
  requireAiAccess,
  ensureDatabase,
  marketService,
  MarketWatch,
  MarketAnalysis,
  MarketProfile = null,
  // 重大訊息（materialNews）；沒有時不附
  news = null,
  // AI：isAvailable() 與 stream({ messages, signal, onStart, onDelta }) → { model }
  ai,
  // AI 用量紀錄（每日次數）：AI 開始產生就記一筆，中途停止的也算。沒傳時改數存下來的分析（只有完整產生的）
  MarketAiUsage = null,
  now = () => Date.now(),
}) {
  const router = express.Router()

  // AI 開始產生（開始計費）時記一筆用量；記錄失敗只寫 log，不中斷分析
  function recordUsage(userId) {
    if (!MarketAiUsage) return
    const expireAt = new Date(now() + (MarketAiUsage.KEEP_DAYS || 2) * 86400000)
    Promise.resolve(MarketAiUsage.create({ user: userId, kind: 'stock', expireAt })).catch((error) =>
      console.error('AI 用量記錄失敗：', error.message),
    )
  }
  // 同一個人同時只能跑一個 AI 分析；最近一次開始的時間（中斷的也算，避免中斷再重來繞過冷卻）
  const running = new Set()
  const startedAt = new Map()

  async function feesOf(userId) {
    if (!MarketProfile) return DEFAULT_FEES
    const profile = await MarketProfile.findOne({ user: userId })
    return normalizeFees(profile?.fees)
  }

  async function findWatch(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: '找不到這個追蹤項目。' })
      return null
    }
    const watch = await MarketWatch.findOne({ _id: req.params.id, user: req.auth.userId })
    if (!watch) res.status(404).json({ message: '找不到這個追蹤項目。' })
    return watch
  }

  async function newsOf(target) {
    if (!news || target.market !== 'tw' || target.kind !== 'stock' || !target.code) return []
    try {
      await news.sync()
    } catch (error) {
      console.error('重大訊息同步失敗：', error.message)
    }
    try {
      return await news.listFor([target.code], { limit: NEWS_LIMIT })
    } catch (error) {
      console.error('重大訊息讀取失敗：', error.message)
      return []
    }
  }

  // 今天用了幾次、上限（admin 為 null）、這一檔什麼時候可以再跑
  async function quotaOf(req, watchId) {
    const userId = req.auth.userId
    const [usedToday, latest] = await Promise.all([
      (MarketAiUsage || MarketAnalysis).countDocuments({
        user: userId,
        ...(MarketAiUsage ? { kind: 'stock' } : {}),
        createdAt: { $gte: startOfTaipeiDay(now()) },
      }),
      MarketAnalysis.findOne({ user: userId, watch: watchId }).sort({ createdAt: -1 }),
    ])
    const lastStart = Math.max(latest ? new Date(latest.createdAt).getTime() : 0, startedAt.get(`${userId}:${watchId}`) || 0)
    const retryAt = lastStart && lastStart + COOLDOWN_MS > now() ? new Date(lastStart + COOLDOWN_MS).toISOString() : null
    return {
      quota: { dailyLimit: req.auth.role === 'admin' ? null : DAILY_LIMIT, usedToday, retryAt },
      latest,
    }
  }

  // ---- 個股分析彈窗（不呼叫 AI）----

  router.get('/watchlist/:id/analysis', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const watch = await findWatch(req, res)
      if (!watch) return
      const [snapshot, fees, newsList, { quota, latest }] = await Promise.all([
        marketService.buildTargetSnapshot(watch.target),
        feesOf(req.auth.userId),
        newsOf(watch.target),
        quotaOf(req, watch._id),
      ])
      const item = snapshot.items[0] || null
      res.json({
        analysis: {
          asOf: snapshot.asOf,
          item,
          notes: snapshot.notes,
          events: snapshot.events || null,
          news: newsList,
          holding: holdingOf(watch, item, fees),
          quota,
          // 這檔最近一次的 AI 分析（重新打開彈窗先顯示，不必再付費）
          latest: latest ? { ...latest.toSummaryJSON(), text: latest.text } : null,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  // ---- AI 深度分析（會計費）----

  router.post('/watchlist/:id/analysis/ai', requireStockAccess, requireAiAccess, async (req, res, next) => {
    const userId = req.auth.userId
    let lockKey = null
    let locked = false
    try {
      if (!ai?.isAvailable()) {
        res.status(503).json({ message: 'AI 分析尚未設定（缺少 OPENROUTER_API_KEY）。' })
        return
      }
      if (!ensureDatabase(res)) return
      const watch = await findWatch(req, res)
      if (!watch) return

      if (running.has(userId)) {
        res.status(409).json({ message: '上一個 AI 分析還在進行，請等它完成。' })
        return
      }
      // 檢查完立刻上鎖（同步執行），同時送多個請求也只有一個能往下走；早退時由 finally 釋放
      running.add(userId)
      locked = true
      // 一開始就監聽中斷：查行情時使用者已經關掉彈窗的話，就不呼叫 AI
      const controller = new AbortController()
      res.on('close', () => {
        if (!res.writableFinished) controller.abort()
      })
      const { quota } = await quotaOf(req, watch._id)
      if (quota.retryAt) {
        res.status(429).json({ message: '這檔股票剛分析過，請稍後再試。', retryAt: quota.retryAt })
        return
      }
      if (quota.dailyLimit !== null && quota.usedToday >= quota.dailyLimit) {
        res.status(429).json({ message: `今天的 AI 分析已用完（每天 ${quota.dailyLimit} 次），明天再試。` })
        return
      }

      lockKey = `${userId}:${watch._id}`
      startedAt.set(lockKey, now())

      // 不信任前端的數字：重新查一次（有 10 分鐘快取）
      const [snapshot, fees, newsList] = await Promise.all([
        marketService.buildTargetSnapshot(watch.target),
        feesOf(userId),
        newsOf(watch.target),
      ])
      const item = snapshot.items[0] || null
      if (!item) {
        startedAt.delete(lockKey)
        res.status(502).json({ message: '這檔的行情暫時取不到，無法分析，稍後再試。' })
        return
      }
      const holding = holdingOf(watch, item, fees)
      // 還沒呼叫 AI 就斷線：不計費，也不算冷卻
      if (controller.signal.aborted) {
        startedAt.delete(lockKey)
        return
      }
      // NDJSON：delta（一段文字）、done（完成，附存好的紀錄摘要）、error（串流途中失敗）
      const writeEvent = (event) => res.write(`${JSON.stringify(event)}\n`)
      let text = ''

      try {
        const { model } = await ai.stream({
          messages: buildStockAnalysisMessages({ snapshot, holding, news: newsList }),
          signal: controller.signal,
          onStart: () => {
            res.status(200).set({
              'Content-Type': 'application/x-ndjson; charset=utf-8',
              'Cache-Control': 'no-cache',
              'X-Accel-Buffering': 'no',
            })
            res.flushHeaders()
            recordUsage(userId)
          },
          onDelta: (delta) => {
            text += delta
            writeEvent({ type: 'delta', text: delta })
          },
        })
        // 只有完整產生才存；存檔失敗也要讓前端知道（文字已經顯示，但紀錄裡不會有）
        let saved = null
        try {
          const record = await MarketAnalysis.create({
            user: userId,
            watch: watch._id,
            target: watch.target,
            quote: { price: item.quote.price, change: item.quote.change, changePct: item.quote.changePct, date: item.quote.date },
            text,
            model: model || '',
            snapshot,
            holding,
          })
          saved = record.toSummaryJSON()
          await trimOldest(userId)
        } catch (error) {
          console.error('股票分析存檔失敗：', error.message)
        }
        writeEvent({ type: 'done', model, analysis: saved })
        res.end()
      } catch (error) {
        if (controller.signal.aborted) {
          console.log('股票 AI 分析已由使用者中斷')
          return
        }
        // 還沒開始產生就失敗（例如 AI 服務錯誤）不算冷卻
        if (!text) startedAt.delete(lockKey)
        if (!res.headersSent) throw error
        console.error(error)
        writeEvent({
          type: 'error',
          message: error instanceof NarrationRefusedError ? 'AI 無法產生這次的分析。' : 'AI 分析中途發生錯誤，請再試一次。',
        })
        res.end()
      }
    } catch (error) {
      if (error instanceof NarrationRefusedError) {
        res.status(422).json({ message: 'AI 無法產生這次的分析。' })
        return
      }
      next(error)
    } finally {
      if (locked) running.delete(userId)
    }
  })

  async function trimOldest(userId) {
    const max = MarketAnalysis.MAX_ANALYSES_PER_USER || 100
    const extra = await MarketAnalysis.find({ user: userId }).sort({ createdAt: -1, _id: -1 }).skip(max).select('_id')
    if (extra.length) await MarketAnalysis.deleteMany({ _id: { $in: extra.map((doc) => doc._id) } })
  }

  // ---- 我的紀錄：股票分析 ----
  // 看紀錄只要股市權限，不看 AI 權限：權限收回後，已經付費產生的紀錄還是看得到

  router.get('/analyses', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const records = await MarketAnalysis.find({ user: req.auth.userId })
        .sort({ createdAt: -1, _id: -1 })
        .select('-snapshot -text')
      res.json({ analyses: records.map((record) => record.toSummaryJSON()) })
    } catch (error) {
      next(error)
    }
  })

  router.get('/analyses/:id', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這筆分析紀錄。' })
        return
      }
      const record = await MarketAnalysis.findOne({ _id: req.params.id, user: req.auth.userId })
      if (!record) {
        res.status(404).json({ message: '找不到這筆分析紀錄。' })
        return
      }
      res.json({ analysis: record.toDetailJSON() })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/analyses/:id', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這筆分析紀錄。' })
        return
      }
      const result = await MarketAnalysis.deleteOne({ _id: req.params.id, user: req.auth.userId })
      if (result.deletedCount === 0) {
        res.status(404).json({ message: '找不到這筆分析紀錄。' })
        return
      }
      res.json({ deleted: true })
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createMarketAnalysisRouter, DAILY_LIMIT, COOLDOWN_MS, startOfTaipeiDay }
