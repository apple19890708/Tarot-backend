// 股市諮詢的 API：行情快照、建議追蹤（自動對答案）、價位提醒。
// 全部限 admin 與開通「金融股市」的會員（和股市諮詢本身一致）；都不呼叫 AI，不產生費用。
// 依賴以參數注入，測試時不必連資料庫或外部 API。
const express = require('express')
const mongoose = require('mongoose')

const { validateQuestion } = require('../services/manualDraw')
const { recordCalls, summarizeCalls } = require('../services/market/tracking')

// 追蹤只看最近這麼多筆建議
const TRACK_LIMIT = 300

// 標的欄位會拼進報價 API 的網址（已編碼），格式仍要先擋：
// 台股代號 4～6 碼（ETF 可能多一個字母，指數是 t00／o00）、交易所只有 tse／otc、Yahoo 代號只有英數與 .^=-
const CODE_PATTERN = /^(\d{4,6}[A-Z]?|[to]00)$/
const SYMBOL_PATTERN = /^[\w.^=-]{1,20}$/

function isTarget(raw) {
  if (!raw || typeof raw !== 'object') return false
  if (!['tw', 'us'].includes(raw.market) || !['index', 'stock'].includes(raw.kind)) return false
  const symbolOk = raw.symbol === null || raw.symbol === undefined || (typeof raw.symbol === 'string' && SYMBOL_PATTERN.test(raw.symbol))
  const codeOk = raw.code === null || raw.code === undefined || (typeof raw.code === 'string' && CODE_PATTERN.test(raw.code))
  const exchangeOk = raw.exchange === null || raw.exchange === undefined || ['tse', 'otc'].includes(raw.exchange)
  const hasId = typeof raw.symbol === 'string' || (typeof raw.code === 'string' && typeof raw.exchange === 'string')
  return symbolOk && codeOk && exchangeOk && hasId
}

function pickTarget(raw) {
  const str = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : null)
  return {
    symbol: str(raw.symbol),
    code: str(raw.code),
    exchange: str(raw.exchange, 10),
    market: raw.market,
    kind: raw.kind,
    name: str(raw.name, 60) || str(raw.symbol) || str(raw.code) || '',
  }
}

function alertJSON(alert) {
  return {
    id: String(alert._id),
    target: alert.target,
    condition: alert.condition,
    price: alert.price,
    note: alert.note || '',
    active: alert.active,
    triggeredAt: alert.triggeredAt,
    triggeredPrice: alert.triggeredPrice,
    createdAt: alert.createdAt,
  }
}

function createMarketRouter({ requireStockAccess, ensureDatabase, marketService, MarketCall, MarketAlert }) {
  const router = express.Router()

  // 行情快照：股市諮詢的結果頁一進來就顯示。查完順便記下這次的操作建議（自動對答案用）
  router.post('/snapshot', requireStockAccess, async (req, res, next) => {
    try {
      const { question, error } = validateQuestion(req.body.question)
      if (error) {
        res.status(400).json({ message: error })
        return
      }
      const snapshot = await marketService.buildMarketSnapshot(question)
      res.json({ snapshot })
      // 記錄失敗不影響回應
      if (mongoose.connection.readyState === 1) {
        recordCalls(MarketCall, req.auth.userId, snapshot).catch((err) => console.error('建議紀錄失敗：', err.message))
      }
    } catch (error) {
      next(error)
    }
  })

  // 建議追蹤：過去的建議和之後實際走勢的對照
  router.get('/track', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const calls = await MarketCall.find({ user: req.auth.userId }).sort({ date: -1 }).limit(TRACK_LIMIT).lean()

      const symbols = [...new Set(calls.map((call) => call.symbol))]
      const barsBySymbol = new Map()
      await Promise.all(
        symbols.map(async (symbol) => {
          try {
            barsBySymbol.set(symbol, await marketService.getHistoryBars(symbol))
          } catch (error) {
            console.error(`追蹤用的歷史資料失敗（${symbol}）：`, error.message)
          }
        }),
      )
      res.json(summarizeCalls(calls, barsBySymbol))
    } catch (error) {
      next(error)
    }
  })

  router.delete('/track', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const result = await MarketCall.deleteMany({ user: req.auth.userId })
      res.json({ deleted: result.deletedCount })
    } catch (error) {
      next(error)
    }
  })

  // ---- 價位提醒 ----

  router.get('/alerts', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const alerts = await MarketAlert.find({ user: req.auth.userId }).sort({ createdAt: -1 })
      res.json({ alerts: alerts.map(alertJSON) })
    } catch (error) {
      next(error)
    }
  })

  // 建立：帶 target（從操作建議一鍵設定）或 query（手動輸入代號或名稱）
  router.post('/alerts', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const { condition, note } = req.body
      const price = Number(req.body.price)
      if (!['above', 'below'].includes(condition) || !Number.isFinite(price) || price <= 0) {
        res.status(400).json({ message: '提醒條件或價格不正確。' })
        return
      }

      let target = null
      if (isTarget(req.body.target)) {
        target = pickTarget(req.body.target)
      } else if (typeof req.body.query === 'string' && req.body.query.trim()) {
        const found = await marketService.resolveTarget(req.body.query.trim().slice(0, 50))
        target = found ? pickTarget(found) : null
      }
      if (!target) {
        res.status(400).json({ message: '找不到這個標的，請輸入股票代號或名稱（例如 2330、台積電、$NVDA）。' })
        return
      }

      const count = await MarketAlert.countDocuments({ user: req.auth.userId })
      if (count >= MarketAlert.MAX_ALERTS_PER_USER) {
        res.status(400).json({ message: `提醒最多 ${MarketAlert.MAX_ALERTS_PER_USER} 個，請先刪除不需要的。` })
        return
      }

      const alert = await MarketAlert.create({
        user: req.auth.userId,
        target,
        condition,
        price,
        note: typeof note === 'string' ? note.slice(0, 100) : '',
      })
      res.status(201).json({ alert: alertJSON(alert) })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/alerts/:id', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這個提醒。' })
        return
      }
      const result = await MarketAlert.deleteOne({ _id: req.params.id, user: req.auth.userId })
      if (result.deletedCount === 0) {
        res.status(404).json({ message: '找不到這個提醒。' })
        return
      }
      res.json({ deleted: true })
    } catch (error) {
      next(error)
    }
  })

  // 檢查還沒觸發的提醒；回傳全部提醒與這次新觸發的
  router.post('/alerts/check', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const alerts = await MarketAlert.find({ user: req.auth.userId, active: true })

      // 同一個標的只查一次
      const quotes = new Map()
      const keyOf = (target) => target.symbol || `${target.exchange}_${target.code}`
      await Promise.all(
        [...new Map(alerts.map((a) => [keyOf(a.target), a.target])).entries()].map(async ([key, target]) => {
          try {
            quotes.set(key, await marketService.getQuote(target))
          } catch (error) {
            console.error(`提醒報價失敗（${key}）：`, error.message)
          }
        }),
      )

      const triggered = []
      for (const alert of alerts) {
        const quote = quotes.get(keyOf(alert.target))
        if (!quote) continue
        const hit = alert.condition === 'above' ? quote.price >= alert.price : quote.price <= alert.price
        if (hit) {
          alert.active = false
          alert.triggeredAt = new Date()
          alert.triggeredPrice = quote.price
          await alert.save()
          triggered.push(alertJSON(alert))
        }
      }

      const all = await MarketAlert.find({ user: req.auth.userId }).sort({ createdAt: -1 })
      res.json({
        alerts: all.map(alertJSON),
        triggered,
        // 每個標的目前的價格，畫面上顯示「距離提醒價還有多少」
        prices: Object.fromEntries([...quotes.entries()].filter(([, q]) => q).map(([key, q]) => [key, q.price])),
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createMarketRouter }
