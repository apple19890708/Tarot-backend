// 股市諮詢的 API：行情快照、建議追蹤（自動對答案）、大盤概況與選股、設定，以及掛在底下的三組子路由：
// 價位提醒（marketAlerts.js）、推播設定（marketNotify.js）、自訂股票追蹤（marketWatchlist.js）。
// 2026-11-21 從 1,438 行拆開；網址不變，server.js 與測試照舊只呼叫 createMarketRouter。
// 全部限 admin 與開通「金融股市」的會員（和股市諮詢本身一致）；都不呼叫 AI，不產生費用。
// 依賴以參數注入，測試時不必連資料庫或外部 API。
const express = require('express')
const mongoose = require('mongoose')

const { validateQuestion } = require('../services/manualDraw')
const { recordCalls, summarizeCalls } = require('../services/market/tracking')
const { RULE_VERSION } = require('../services/market/advice')
const { parseFilters } = require('../services/market/screener')
const { parseDashboard } = require('../services/market/dashboard')
const { normalizeFees } = require('../services/market/portfolio')
const { normalizeConcentration, normalizeIncomeSettings } = require('../services/market/income')
const { createSearchLimiter, toPositive } = require('./marketHelpers')
const { createMarketAlertsRouter } = require('./marketAlerts')
const { createMarketNotifyRouter } = require('./marketNotify')
const { createMarketWatchlistRouter } = require('./marketWatchlist')

// 追蹤只看最近這麼多筆建議
const TRACK_LIMIT = 300


// 交易成本設定（台股手續費折扣、最低手續費、美股每筆手續費）
function resolveFees(raw) {
  if (!raw || typeof raw !== 'object') return { error: '設定格式不正確。' }
  const twDiscount = toPositive(raw.twDiscount)
  const twMinFee = raw.twMinFee === 0 || raw.twMinFee === '0' ? 0 : toPositive(raw.twMinFee)
  const usFee = raw.usFee === 0 || raw.usFee === '0' ? 0 : toPositive(raw.usFee)
  if (!Number.isFinite(twDiscount) || twDiscount < 0.1 || twDiscount > 1) return { error: '手續費折扣要在 0.1～1 之間（例如 2.8 折填 0.28）。' }
  if (!Number.isFinite(twMinFee) || twMinFee < 0 || twMinFee > 1000) return { error: '最低手續費要在 0～1000 元之間。' }
  if (!Number.isFinite(usFee) || usFee < 0 || usFee > 100) return { error: '美股手續費要在 0～100 美元之間。' }
  return { fees: { twDiscount, twMinFee, usFee } }
}

// 領股利時的扣款設定（v20）：比例用小數（2.11% 填 0.0211）
function resolveIncomeSettings(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: '股利扣款設定格式不正確。' }
  if (typeof raw.nhi !== 'boolean') return { error: '要選擇是否扣二代健保補充保費。' }
  const nhiRate = toPositive(raw.nhiRate)
  const nhiThreshold = raw.nhiThreshold === 0 || raw.nhiThreshold === '0' ? 0 : toPositive(raw.nhiThreshold)
  const usWithholding = raw.usWithholding === 0 || raw.usWithholding === '0' ? 0 : toPositive(raw.usWithholding)
  if (!Number.isFinite(nhiRate) || nhiRate < 0 || nhiRate > 0.1) return { error: '健保補充保費率要在 0～10% 之間。' }
  if (!Number.isFinite(nhiThreshold) || nhiThreshold < 0 || nhiThreshold > 1_000_000) return { error: '健保補充保費的門檻要在 0～100 萬元之間。' }
  if (!Number.isFinite(usWithholding) || usWithholding < 0 || usWithholding > 0.5) return { error: '美股預扣稅率要在 0～50% 之間。' }
  return { income: { nhi: raw.nhi, nhiRate, nhiThreshold, usWithholding } }
}

// notifier、MarketProfile：推播（瀏覽器、Discord）與個人設定（測試可以不傳，相關端點回 503）
function createMarketRouter({
  requireStockAccess,
  ensureDatabase,
  marketService,
  MarketCall,
  MarketAlert,
  MarketWatch,
  // 自選清單（v17 階段 2）；測試可以不傳，相關端點回 503
  MarketWatchGroup = null,
  MarketProfile = null,
  notifier = null,
  // 每日資產快照（v16 階段 3）；測試可以不傳
  snapshots = null,
  // 重大訊息（v17 階段 4）；測試可以不傳，端點回 503
  news = null,
  // 股利預估的紀錄與驗證（v20）；測試可以不傳，就不記也不比
  forecastLog = null,
}) {
  const router = express.Router()
  const searchLimit = createSearchLimiter()
  const screenLimit = createSearchLimiter(10, '選股太頻繁，請稍後再試。')

  // 子路由（網址不變）：價位提醒、推播設定、自訂股票追蹤
  router.use(createMarketAlertsRouter({ requireStockAccess, ensureDatabase, marketService, MarketAlert, notifier }))
  router.use(createMarketNotifyRouter({ requireStockAccess, ensureDatabase, notifier, MarketProfile }))
  router.use(
    createMarketWatchlistRouter({ requireStockAccess, ensureDatabase, marketService, MarketWatch, MarketWatchGroup, MarketProfile, snapshots, news, forecastLog, searchLimit }),
  )

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
      // ?version=current：只統計目前規則版本的紀錄
      res.json(summarizeCalls(calls, barsBySymbol, { ruleVersion: RULE_VERSION, onlyCurrent: req.query.version === 'current' }))
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

  // ---- 重大訊息 ----

  // 追蹤清單裡台股公司最近 30 天的重大訊息（新的在前）。來源 30 分鐘最多抓一次，抓不到就只回資料庫裡已有的
  router.get('/news', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!news) {
        res.status(503).json({ message: '重大訊息尚未啟用。' })
        return
      }
      const watches = await MarketWatch.find({ user: req.auth.userId })
      const codes = [...new Set(watches.filter((w) => w.target.market === 'tw' && w.target.kind === 'stock' && w.target.code).map((w) => w.target.code))]
      try {
        await news.sync()
      } catch (error) {
        console.error('重大訊息同步失敗：', error.message)
      }
      res.json({ news: await news.listFor(codes) })
    } catch (error) {
      next(error)
    }
  })

  // ---- 選股 ----

  router.post('/screen', requireStockAccess, screenLimit, async (req, res, next) => {
    try {
      if (!marketService.screenStocks) {
        res.status(503).json({ message: '選股尚未啟用。' })
        return
      }
      const { filters, error } = parseFilters(req.body?.filters)
      if (error) {
        res.status(400).json({ message: error })
        return
      }
      res.json({ result: await marketService.screenStocks(filters) })
    } catch (error) {
      next(error)
    }
  })

  // ---- 當日推薦個股（股市總覽的區塊，v19）：固定規則挑的，不是投資建議 ----

  router.get('/daily-picks', requireStockAccess, async (req, res, next) => {
    try {
      if (!marketService.getDailyPicks) {
        res.status(503).json({ message: '當日推薦個股尚未啟用。' })
        return
      }
      const type = typeof req.query.type === 'string' ? req.query.type : undefined
      res.json({ picks: await marketService.getDailyPicks(type) })
    } catch (error) {
      next(error)
    }
  })

  // 任何一檔台股的卡片（推薦／熱門股票用）：報價摘要＋日 K
  router.get('/stock/:code/card', requireStockAccess, async (req, res, next) => {
    try {
      if (!marketService.getStockCard) {
        res.status(503).json({ message: '股票卡片尚未啟用。' })
        return
      }
      const card = await marketService.getStockCard(req.params.code)
      if (!card) {
        res.status(404).json({ message: '找不到這檔台股，或行情暫時取不到。' })
        return
      }
      res.json({ card })
    } catch (error) {
      next(error)
    }
  })

  // ---- 大盤概況 ----

  router.get('/overview', requireStockAccess, async (req, res, next) => {
    try {
      if (!marketService.getMarketOverview) {
        res.status(503).json({ message: '大盤概況尚未啟用。' })
        return
      }
      res.json({ overview: await marketService.getMarketOverview() })
    } catch (error) {
      next(error)
    }
  })

  // 大盤概況重點卡點開的走勢彈窗：GET /index-chart?symbol=^TWII&range=1d（代號只限大盤概況裡的那幾個）
  router.get('/index-chart', requireStockAccess, async (req, res, next) => {
    try {
      if (!marketService.getIndexChart) {
        res.status(503).json({ message: '指數走勢尚未啟用。' })
        return
      }
      const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : ''
      const range = typeof req.query.range === 'string' ? req.query.range : '1d'
      let chart = await marketService.getIndexChart(symbol, range)
      // 股市總覽的重點卡可以放自己追蹤的個股（v19）：只限自己追蹤清單裡的，不能拿來查任意代號
      if (!chart && symbol && MarketWatch?.findOne) {
        const watch = await MarketWatch.findOne({ user: req.auth.userId, 'target.symbol': symbol })
        if (watch) chart = await marketService.getIndexChart(symbol, range, { name: watch.target.name || symbol })
      }
      if (!chart) {
        res.status(404).json({ message: '只能查大盤概況裡的指數與匯率，或自己追蹤的股票。' })
        return
      }
      res.json({ chart })
    } catch (error) {
      next(error)
    }
  })

  // 台指期夜盤的分鐘走勢（期交所）：大盤概況的「台指期夜盤」卡點開用
  router.get('/futures-chart', requireStockAccess, async (req, res, next) => {
    try {
      if (!marketService.getFuturesNightChart) {
        res.status(503).json({ message: '台指期走勢尚未啟用。' })
        return
      }
      const chart = await marketService.getFuturesNightChart()
      if (!chart) {
        res.status(404).json({ message: '目前查不到台指期夜盤的資料。' })
        return
      }
      res.json({ chart })
    } catch (error) {
      next(error)
    }
  })

  // ---- 資產走勢 ----

  router.get('/history', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!snapshots) {
        res.status(503).json({ message: '資產走勢尚未啟用。' })
        return
      }
      res.json(await snapshots.history(req.auth.userId))
    } catch (error) {
      next(error)
    }
  })

  // ---- 交易成本設定 ----

  router.get('/settings', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const profile = MarketProfile ? await MarketProfile.findOne({ user: req.auth.userId }) : null
      // dashboard：股市總覽的版面（v19）；沒自訂過是 null
      res.json({
        fees: normalizeFees(profile?.fees),
        // 領股利時的扣款（v20）
        income: normalizeIncomeSettings(profile?.income),
        // 提醒（v20）
        reminders: { exDividend: Boolean(profile?.reminders?.exDividend) },
        // 集中度提醒的門檻（v20 2.9.8，%）
        concentration: normalizeConcentration(profile?.concentration),
        dashboard: profile?.dashboard ?? null,
      })
    } catch (error) {
      next(error)
    }
  })

  router.put('/settings', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!MarketProfile) {
        res.status(503).json({ message: '設定功能尚未啟用。' })
        return
      }
      // fees（交易成本）與 income（股利扣款，v20）可以只送其中一個；舊版前端只送 fees
      const body = req.body || {}
      if (body.fees === undefined && body.income === undefined && body.reminders === undefined && body.concentration === undefined) {
        res.status(400).json({ message: '設定格式不正確。' })
        return
      }
      const $set = {}
      if (body.fees !== undefined) {
        const { fees, error } = resolveFees(body.fees)
        if (error) {
          res.status(400).json({ message: error })
          return
        }
        $set.fees = fees
      }
      if (body.reminders !== undefined) {
        if (!body.reminders || typeof body.reminders.exDividend !== 'boolean') {
          res.status(400).json({ message: '提醒設定格式不正確。' })
          return
        }
        $set.reminders = { exDividend: body.reminders.exDividend }
      }
      if (body.concentration !== undefined) {
        const raw = body.concentration
        const valid = (value) => Number.isFinite(value) && value >= 5 && value <= 100
        if (!raw || !valid(raw.holding) || !valid(raw.industry)) {
          res.status(400).json({ message: '集中度門檻要在 5～100% 之間。' })
          return
        }
        $set.concentration = { holding: raw.holding, industry: raw.industry }
      }
      if (body.income !== undefined) {
        const { income, error } = resolveIncomeSettings(body.income)
        if (error) {
          res.status(400).json({ message: error })
          return
        }
        $set.income = income
      }
      const profile = await MarketProfile.findOneAndUpdate(
        { user: req.auth.userId },
        { $set },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      res.json({
        fees: normalizeFees(profile?.fees),
        income: normalizeIncomeSettings(profile?.income),
        reminders: { exDividend: Boolean(profile?.reminders?.exDividend) },
        concentration: normalizeConcentration(profile?.concentration),
      })
    } catch (error) {
      next(error)
    }
  })

  // ---- 股市總覽的版面（v19）：整份替換；null＝恢復預設 ----

  router.put('/dashboard', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!MarketProfile) {
        res.status(503).json({ message: '設定功能尚未啟用。' })
        return
      }
      const { dashboard, error } = parseDashboard(req.body?.dashboard)
      if (error) {
        res.status(400).json({ message: error })
        return
      }
      await MarketProfile.findOneAndUpdate(
        { user: req.auth.userId },
        { $set: { dashboard } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      res.json({ dashboard })
    } catch (error) {
      next(error)
    }
  })

  // ---- 自訂股票追蹤 ----

  // 輸入框的下拉候選：GET /search?market=tw|us&q=…
  router.get('/search', requireStockAccess, searchLimit, async (req, res, next) => {
    try {
      const { market } = req.query
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 30) : ''
      if (!['tw', 'us'].includes(market)) {
        res.status(400).json({ message: '請選擇台股或美股。' })
        return
      }
      res.json({ results: q ? await marketService.searchTargets(q, market) : [] })
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createMarketRouter }
