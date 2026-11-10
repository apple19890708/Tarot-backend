// 股市諮詢的 API：行情快照、建議追蹤（自動對答案）、價位提醒、自訂股票追蹤。
// 全部限 admin 與開通「金融股市」的會員（和股市諮詢本身一致）；都不呼叫 AI，不產生費用。
// 依賴以參數注入，測試時不必連資料庫或外部 API。
const express = require('express')
const mongoose = require('mongoose')

const { validateQuestion } = require('../services/manualDraw')
const { recordCalls, summarizeCalls } = require('../services/market/tracking')
const { RULE_VERSION } = require('../services/market/advice')
const { evaluateAlerts, describeAlert, checkCondition } = require('../services/market/alertChecker')
const { nextRevenueDeadline } = require('../services/market/corporateEvents')
const { parseFilters } = require('../services/market/screener')
const { parseDashboard } = require('../services/market/dashboard')
const { taipeiNow } = require('../services/market/snapshots')
const { computePosition, validateSequence, normalizeFees, tradesOf, DEFAULT_FEES } = require('../services/market/portfolio')
const { buildIncomeReport, normalizeConcentration, normalizeIncomeSettings } = require('../services/market/income')
const { attachPastEstimates } = require('../services/market/forecastLog')

// 美元兌台幣（獲利與股利合併成台幣用）
const FX_TARGET = { symbol: 'TWD=X', market: 'us', kind: 'index', name: '美元兌台幣' }

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
    kind: alert.kind || 'price',
    condition: alert.condition,
    price: alert.price,
    params: alert.params && alert.params.direction ? { direction: alert.params.direction, value: alert.params.value ?? null, period: alert.params.period ?? null } : null,
    // 條件的文字（後端產生，前端直接顯示）
    description: describeAlert(alert),
    note: alert.note || '',
    active: alert.active,
    triggeredAt: alert.triggeredAt,
    triggeredPrice: alert.triggeredPrice,
    triggeredNote: alert.triggeredNote || '',
    notifiedAt: alert.notifiedAt || null,
    createdAt: alert.createdAt,
  }
}

// 提醒條件的驗證：回傳要存的欄位，或 { error }
function resolveAlertCondition(body) {
  const kind = body.kind === undefined ? 'price' : body.kind
  const p = body.params && typeof body.params === 'object' ? body.params : {}
  const value = Number(p.value)
  const empty = { condition: null, price: null, params: { direction: null, value: null, period: null } }
  switch (kind) {
    case 'price': {
      const price = Number(body.price)
      if (!['above', 'below'].includes(body.condition) || !Number.isFinite(price) || price <= 0) return { error: '提醒條件或價格不正確。' }
      return { ...empty, kind, condition: body.condition, price }
    }
    case 'changePct':
      if (!['up', 'down'].includes(p.direction) || !Number.isFinite(value) || value <= 0 || value > 20) return { error: '漲跌幅要在 0～20% 之間。' }
      return { ...empty, kind, params: { direction: p.direction, value, period: null } }
    case 'ma': {
      const period = Number(p.period)
      if (!['above', 'below'].includes(p.direction) || ![20, 60].includes(period)) return { error: '均線條件不正確（站上或跌破 MA20／MA60）。' }
      return { ...empty, kind, params: { direction: p.direction, value: null, period } }
    }
    case 'kd':
      if (!['golden', 'dead'].includes(p.direction)) return { error: 'KD 條件要選黃金交叉或死亡交叉。' }
      return { ...empty, kind, params: { direction: p.direction, value: null, period: null } }
    case 'rsi':
      if (!['above', 'below'].includes(p.direction) || !Number.isFinite(value) || value <= 0 || value >= 100) return { error: 'RSI 門檻要在 0～100 之間。' }
      return { ...empty, kind, params: { direction: p.direction, value, period: null } }
    case 'volume':
      if (!Number.isFinite(value) || value < 1 || value > 20) return { error: '量比要在 1～20 倍之間。' }
      return { ...empty, kind, params: { direction: 'above', value, period: null } }
    default:
      return { error: '不支援這種提醒條件。' }
  }
}

const targetKey = (target) => target.symbol || `${target.exchange}_${target.code}`

// 前端帶來的標的（下拉選單、操作建議）只當成「要找哪一檔」的提示，存進資料庫的一律是後端重新解析的結果，
// 避免存進不存在的代號或互相矛盾的欄位（例如 symbol 是 2330、code 是 2454）
function hintOf(raw, market) {
  if (!isTarget(raw) || raw.market !== market) return null
  if (market === 'tw') return raw.kind === 'index' ? raw.name || raw.code : raw.code || raw.symbol
  return raw.symbol
}

async function resolveFromRequest(marketService, body, market) {
  const hint = hintOf(body.target, market)
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 50) : ''
  const text = typeof hint === 'string' && hint ? hint.slice(0, 50) : query
  if (!text) return null
  const found = await marketService.resolveTarget(text, market)
  return found && isTarget(found) ? pickTarget(found) : null
}

// 持股：買賣紀錄與股利。數量、價格、金額都要是正數；上限只是擋掉打錯的值
const MAX_HOLDING_QUANTITY = 10_000_000
const MAX_HOLDING_PRICE = 10_000_000
const MAX_DIVIDEND_AMOUNT = 1_000_000_000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const toPositive = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN)

// 日期選填；格式不對或不是真的日期回傳 undefined（呼叫端當成錯誤）
function resolveDate(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  if (typeof raw !== 'string' || !DATE_PATTERN.test(raw) || Number.isNaN(Date.parse(raw))) return undefined
  return raw
}

function resolveTrade(raw, index) {
  const at = `第 ${index + 1} 筆`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: `${at}的格式不正確。` }
  if (!['buy', 'sell', 'stockDividend'].includes(raw.side)) return { error: `${at}要選買進、賣出或配股。` }
  const quantity = toPositive(raw.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: `${at}的數量要大於 0。` }
  if (quantity > MAX_HOLDING_QUANTITY) return { error: `${at}的數量太大，請確認單位（台股是張、美股是股）。` }
  // 配股沒有成交價（成本 0），一定要有除權日：應收股利靠日期判斷是不是同一次
  if (raw.side === 'stockDividend') {
    const date = resolveDate(raw.date)
    if (!date) return { error: `${at}配股要填除權日。` }
    return { trade: { side: 'stockDividend', quantity, price: 0, date } }
  }
  const price = toPositive(raw.price)
  if (!Number.isFinite(price) || price <= 0) return { error: `${at}的成交價要大於 0。` }
  if (price > MAX_HOLDING_PRICE) return { error: `${at}的成交價太大，請確認輸入是否正確。` }
  const date = resolveDate(raw.date)
  if (date === undefined) return { error: `${at}的日期格式不正確。` }
  return { trade: { side: raw.side, quantity, price, date } }
}

// trades：陣列（空陣列代表沒有持股），依順序先進先出沖銷，不能賣超過當時持有的數量
function resolveTrades(raw, max) {
  if (!Array.isArray(raw)) return { error: '買賣紀錄格式不正確。' }
  if (raw.length > max) return { error: `同一檔最多記錄 ${max} 筆買賣。` }
  const trades = []
  for (const [index, item] of raw.entries()) {
    const { trade, error } = resolveTrade(item, index)
    if (error) return { error }
    trades.push(trade)
  }
  const sequenceError = validateSequence(trades)
  return sequenceError ? { error: sequenceError } : { trades }
}

// 刪掉的應收股利：[{ type: 'cash'|'stock', exDate }]，整批替換；重複的只留一筆
function resolveDismissed(raw, max) {
  if (!Array.isArray(raw)) return { error: '刪除的應收股利格式不正確。' }
  if (raw.length > max) return { error: `同一檔最多刪除 ${max} 筆應收股利。` }
  const seen = new Set()
  const dismissed = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || !['cash', 'stock'].includes(item.type)) return { error: '刪除的應收股利格式不正確。' }
    const exDate = resolveDate(item.exDate)
    if (!exDate) return { error: '刪除的應收股利要有除息日。' }
    const key = `${item.type}:${exDate}`
    if (seen.has(key)) continue
    seen.add(key)
    dismissed.push({ type: item.type, exDate })
  }
  return { dismissed }
}

function resolveDividends(raw, max) {
  if (!Array.isArray(raw)) return { error: '股利紀錄格式不正確。' }
  if (raw.length > max) return { error: `同一檔最多記錄 ${max} 筆股利。` }
  const dividends = []
  for (const [index, item] of raw.entries()) {
    const at = `第 ${index + 1} 筆股利`
    if (!item || typeof item !== 'object' || Array.isArray(item)) return { error: `${at}的格式不正確。` }
    const amount = toPositive(item.amount)
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_DIVIDEND_AMOUNT) return { error: `${at}的金額要大於 0。` }
    const date = resolveDate(item.date)
    if (date === undefined) return { error: `${at}的日期格式不正確。` }
    // exDate：從應收股利帶入的那一次除息（v20）；舊版前端不會送，手動記的沒有
    const exDate = resolveDate(item.exDate)
    if (exDate === undefined) return { error: `${at}的除息日格式不正確。` }
    dividends.push({ amount, date, exDate })
  }
  return { dividends }
}

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

// 每個使用者每分鐘最多這麼多次：下拉搜尋 60 次（前端有 250ms 防抖，正常打字遠低於這個量）、選股 10 次
const SEARCH_WINDOW_MS = 60 * 1000
const SEARCH_MAX_PER_WINDOW = 60
function createSearchLimiter(max = SEARCH_MAX_PER_WINDOW, message = '搜尋太頻繁，請稍後再試。') {
  const hits = new Map()
  return function searchLimit(req, res, next) {
    const key = String(req.auth?.userId || req.ip || 'unknown')
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || now - entry.start > SEARCH_WINDOW_MS) {
      hits.set(key, { start: now, count: 1 })
      // 順手清掉過期的，Map 不會無限長大
      if (hits.size > 1000) {
        for (const [k, v] of hits) if (now - v.start > SEARCH_WINDOW_MS) hits.delete(k)
      }
      next()
      return
    }
    entry.count += 1
    if (entry.count > max) {
      res.status(429).json({ message })
      return
    }
    next()
  }
}

// position：依買賣紀錄、股利、交易成本與目前報價算出的損益（沒有任何紀錄時為 null）
// 這一檔所在的清單 id：新格式看 groups；舊資料只有 group（一檔一個清單）時當成唯一一個
function watchGroupIds(watch) {
  if (Array.isArray(watch.groups) && watch.groups.length) return watch.groups.map(String)
  return watch.group ? [String(watch.group)] : []
}

function watchJSON(watch, summary = null, fees = DEFAULT_FEES) {
  const trades = tradesOf(watch)
  const dividends = (watch.dividends || []).map((d) => ({ amount: d.amount, date: d.date || null, exDate: d.exDate || null }))
  const position =
    trades.length || dividends.length
      ? computePosition({
          target: watch.target,
          trades,
          dividends,
          fees,
          quote: summary?.quote ? { price: summary.quote.price, change: summary.quote.change, date: summary.quote.date } : null,
        })
      : null
  return {
    id: String(watch._id),
    target: watch.target,
    trades,
    dividends,
    // 應收股利裡刪掉、不想帶入的那幾次（2026-11-10；舊資料沒有）
    dismissedEntitlements: (watch.dismissedEntitlements || []).map((d) => ({ type: d.type, exDate: d.exDate })),
    position,
    groups: watchGroupIds(watch),
    // 舊版前端只認單一清單：給第一個
    group: watchGroupIds(watch)[0] ?? null,
    order: watch.order ?? 0,
    createdAt: watch.createdAt,
    summary,
  }
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

  async function groupsOf(userId) {
    if (!MarketWatchGroup) return []
    const groups = await MarketWatchGroup.find({ user: userId }).sort({ order: 1, createdAt: 1 })
    return groups.map((g) => ({ id: String(g._id), name: g.name, order: g.order ?? 0 }))
  }

  // 清單 id 陣列（去掉重複）；空陣列＝未分類。有任何一個不是自己的清單就回 undefined（呼叫端回 400）
  async function resolveGroups(userId, raw) {
    if (raw === undefined || raw === null) return []
    if (!Array.isArray(raw) || raw.length > 50) return undefined
    const ids = [...new Set(raw.filter((id) => id !== '' && id !== null))]
    if (ids.length === 0) return []
    if (!MarketWatchGroup || !ids.every((id) => typeof id === 'string' && mongoose.isValidObjectId(id))) return undefined
    const owned = await MarketWatchGroup.find({ user: userId })
    const byId = new Map(owned.map((g) => [String(g._id), g._id]))
    return ids.every((id) => byId.has(id)) ? ids.map((id) => byId.get(id)) : undefined
  }
  // 請求裡的清單：新版送 groups（陣列），舊版前端送 group（單一 id，null／空字串＝未分類）
  const requestedGroups = (body) => ('groups' in body ? body.groups : body.group ? [body.group] : [])

  async function feesOf(userId) {
    if (!MarketProfile) return DEFAULT_FEES
    const profile = await MarketProfile.findOne({ user: userId })
    return normalizeFees(profile?.fees)
  }

  async function incomeSettingsOf(userId) {
    if (!MarketProfile) return normalizeIncomeSettings(null)
    const profile = await MarketProfile.findOne({ user: userId })
    return normalizeIncomeSettings(profile?.income)
  }

  async function concentrationSettingsOf(userId) {
    if (!MarketProfile) return normalizeConcentration(null)
    const profile = await MarketProfile.findOne({ user: userId })
    return normalizeConcentration(profile?.concentration)
  }

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
      const { note } = req.body
      const condition = resolveAlertCondition(req.body)
      if (condition.error) {
        res.status(400).json({ message: condition.error })
        return
      }

      let target = null
      if (isTarget(req.body.target)) {
        target = await resolveFromRequest(marketService, req.body, req.body.target.market)
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

      // 均線提醒：先記下目前在均線哪一側，之後穿越才觸發（查不到就等第一次檢查時再記）
      let lastSide = null
      if (condition.kind === 'ma' && marketService.getAlertSignals) {
        try {
          const signals = await marketService.getAlertSignals(target)
          lastSide = signals ? checkCondition({ kind: 'ma', params: condition.params }, signals).side || null : null
        } catch (error) {
          console.error('均線提醒的初始狀態失敗：', error.message)
        }
      }

      const alert = await MarketAlert.create({
        user: req.auth.userId,
        target,
        ...condition,
        lastSide,
        note: typeof note === 'string' ? note.slice(0, 100) : '',
      })
      res.status(201).json({ alert: alertJSON(alert) })
    } catch (error) {
      next(error)
    }
  })

  // 重新啟用已觸發的提醒（清掉觸發紀錄；均線提醒的側別重新記錄）
  router.post('/alerts/:id/reactivate', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這個提醒。' })
        return
      }
      const alert = await MarketAlert.findOneAndUpdate(
        { _id: req.params.id, user: req.auth.userId },
        { $set: { active: true, triggeredAt: null, triggeredPrice: null, triggeredNote: '', notifiedAt: null, lastSide: null } },
        { new: true },
      )
      if (!alert) {
        res.status(404).json({ message: '找不到這個提醒。' })
        return
      }
      res.json({ alert: alertJSON(alert) })
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
      // 同一個標的只查一次；和外部排程共用同一套判斷
      const { triggered, quotes } = await evaluateAlerts(alerts, (target) => marketService.getQuote(target), {
        Model: MarketAlert,
        getSignals: marketService.getAlertSignals ? (target) => marketService.getAlertSignals(target) : null,
      })
      // 有開啟推播的話也送出（手機上不一定開著這個網頁）（手機上不一定開著這個網頁）；失敗不影響回應
      if (notifier && triggered.length) {
        notifier.notifyAlerts(triggered).catch((error) => console.error('提醒推播失敗：', error.message))
      }

      const all = await MarketAlert.find({ user: req.auth.userId }).sort({ createdAt: -1 })
      res.json({
        alerts: all.map(alertJSON),
        triggered: triggered.map(alertJSON),
        // 每個標的目前的價格，畫面上顯示「距離提醒價還有多少」
        prices: Object.fromEntries([...quotes.entries()].filter(([, q]) => q).map(([key, q]) => [key, q.price])),
      })
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

  // ---- 到價推播：瀏覽器推播（所有人）、Discord Webhook（只給 admin）----

  const requireNotifier = (req, res, next) => {
    if (!notifier || !MarketProfile) {
      res.status(503).json({ message: '推播通知尚未設定。' })
      return
    }
    next()
  }
  // requireStockAccess 每次都重新讀使用者，req.auth.role 是最新的
  const isAdminRequest = (req) => req.auth?.role === 'admin'
  const requireAdminRole = (req, res, next) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ message: 'Discord 通知只開放管理者使用。' })
      return
    }
    next()
  }

  router.get('/notify', requireStockAccess, requireNotifier, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      res.json(await notifier.status(req.auth.userId, { admin: isAdminRequest(req) }))
    } catch (error) {
      next(error)
    }
  })

  // 這台裝置開啟瀏覽器推播：body 是瀏覽器給的 PushSubscription（JSON）與裝置名稱
  router.post('/notify/push', requireStockAccess, requireNotifier, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const { error } = await notifier.addDevice(req.auth.userId, req.body?.subscription, req.body?.label)
      if (error) {
        res.status(400).json({ message: error })
        return
      }
      res.json(await notifier.status(req.auth.userId, { admin: isAdminRequest(req) }))
    } catch (error) {
      next(error)
    }
  })

  router.delete('/notify/push/:id', requireStockAccess, requireNotifier, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id) || !(await notifier.removeDevice(req.auth.userId, req.params.id))) {
        res.status(404).json({ message: '找不到這台裝置。' })
        return
      }
      res.json(await notifier.status(req.auth.userId, { admin: isAdminRequest(req) }))
    } catch (error) {
      next(error)
    }
  })

  // Discord：綁定（或換一個）Webhook，先送確認訊息，成功才存。回應只有遮罩後的提示，不回傳網址
  router.put('/notify/discord', requireStockAccess, requireAdminRole, requireNotifier, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const { error } = await notifier.linkDiscord(req.auth.userId, req.body?.webhookUrl)
      if (error) {
        res.status(400).json({ message: error })
        return
      }
      res.json(await notifier.status(req.auth.userId, { admin: true }))
    } catch (error) {
      next(error)
    }
  })

  router.delete('/notify/discord', requireStockAccess, requireAdminRole, requireNotifier, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      await notifier.unlinkDiscord(req.auth.userId)
      res.json(await notifier.status(req.auth.userId, { admin: true }))
    } catch (error) {
      next(error)
    }
  })

  // 測試通知：送到所有已開啟的管道
  router.post('/notify/test', requireStockAccess, requireNotifier, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const result = await notifier.sendTest(req.auth.userId)
      if (!result.push && !result.discord) {
        // 有失敗原因就直接告訴使用者；完全沒有管道才是「還沒開啟」
        if (result.errors.length) {
          res.status(502).json({ message: `沒有送出：${result.errors.join('；')}` })
        } else {
          res.status(400).json({ message: '還沒有開啟任何推播。' })
        }
        return
      }
      res.json(result)
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

  // 清單與每個標的的輕量摘要（報價、區間漲跌、52 週位置、技術判讀）
  router.get('/watchlist', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const watches = await MarketWatch.find({ user: req.auth.userId }).sort({ order: 1, createdAt: 1 })
      const [summaries, fees, groups] = await Promise.all([
        watches.length ? marketService.getWatchSummaries(watches.map((w) => w.target)) : [],
        feesOf(req.auth.userId),
        groupsOf(req.auth.userId),
      ])
      const items = watches.map((watch, index) => watchJSON(watch, summaries[index] ?? null, fees))
      // 下一次月營收公布的截止日（每月 10 日前公布上個月）
      const revenueDeadline = nextRevenueDeadline(taipeiNow().date)
      res.json({ asOf: new Date().toISOString(), fees, revenueDeadline, groups, items })
      // 台股收盤後第一次開頁面時順便記今天的資產快照（排程沒跑到也不會漏）；失敗不影響回應
      if (snapshots) {
        snapshots.recordFromItems(req.auth.userId, items).catch((error) => console.error('資產快照失敗：', error.message))
      }
    } catch (error) {
      next(error)
    }
  })

  // 獲利與股利（v20）：持股損益、持有期間的應收股利、未來 12 個月的股利預估。
  // group：只看某個自選清單（不帶是全部追蹤）。外部資料（股利歷史、預告、匯率）抓不到時照樣回應，在各檔標示
  router.get('/income', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const userId = req.auth.userId
      if (req.query.group !== undefined && typeof req.query.group !== 'string') {
        res.status(400).json({ message: '一次只能看一個清單。' })
        return
      }
      const groupId = req.query.group || null
      const groups = await groupsOf(userId)
      if (groupId && !groups.some((g) => g.id === groupId)) {
        res.status(404).json({ message: '找不到這個清單。' })
        return
      }
      const all = await MarketWatch.find({ user: userId }).sort({ order: 1, createdAt: 1 })
      const watches = groupId ? all.filter((w) => watchGroupIds(w).includes(groupId)) : all
      const targets = watches.map((w) => w.target)
      const twCodes = targets.filter((t) => t.market === 'tw' && t.kind === 'stock' && t.code).map((t) => t.code)
      const [summaries, fees, settings, histories, notices, usdTwd, industries, concentration] = await Promise.all([
        // 報價抓不到也照樣回應（市值相關顯示「—」），不讓整頁 500
        targets.length ? marketService.getWatchSummaries(targets).catch(() => targets.map(() => null)) : [],
        feesOf(userId),
        incomeSettingsOf(userId),
        targets.length ? marketService.getDividendHistories(targets) : [],
        targets.some((t) => t.market === 'tw' && t.kind === 'stock') ? marketService.getExDividendNotices().catch(() => null) : null,
        targets.some((t) => t.market === 'us')
          ? marketService
              .getQuote(FX_TARGET)
              .then((quote) => quote?.price ?? null)
              .catch(() => null)
          : null,
        // 集中度提醒（v20 2.9.8）：台股個股的產業別、使用者設的門檻
        marketService.getIndustryMap ? marketService.getIndustryMap(twCodes).catch(() => new Map()) : new Map(),
        concentrationSettingsOf(userId),
      ])
      const items = watches.map((watch, index) => watchJSON(watch, summaries[index] ?? null, fees))
      // 填息追蹤用的日 K：摘要剛抓過（5 分鐘快取），這裡多半直接命中；抓不到的那一檔不算填息
      const barsList = await Promise.all(
        targets.map((target) =>
          target.kind === 'stock' && target.symbol && marketService.getHistoryBars
            ? marketService.getHistoryBars(target.symbol).catch(() => null)
            : null,
        ),
      )
      const report = buildIncomeReport({
        items,
        histories,
        barsList,
        notices,
        settings,
        usdTwd,
        industries,
        concentration,
        today: taipeiNow().date,
      })
      // 預估準不準：先查已經有實際數字的比較，再把這次的推估記下來（不等寫完，失敗也不影響回應）
      const forecastChecks = forecastLog ? await forecastLog.checks(report.items, report.today).catch(() => null) : null
      if (forecastLog) void forecastLog.record(report)
      if (forecastChecks) attachPastEstimates(report, forecastChecks)
      res.json({
        asOf: new Date().toISOString(),
        group: groupId,
        groups,
        fees,
        // 除權息預告有沒有抓到（台股「已公告」靠它）
        noticesAvailable: notices !== null,
        ...report,
        // 預估 vs 實際（近 24 個月，有推估也有實際的）；沒有啟用時是 null
        forecastChecks,
      })
    } catch (error) {
      next(error)
    }
  })

  // 新增：market 指定台股或美股，query 是代號或名稱；可以同時帶持股
  router.post('/watchlist', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const { market, query } = req.body
      if (!['tw', 'us'].includes(market) || typeof query !== 'string' || !query.trim()) {
        res.status(400).json({ message: '請選擇台股或美股，並輸入代號或名稱。' })
        return
      }
      // 新增時可以順便帶第一筆買進（trades 陣列，通常只有一筆）
      let trades = []
      if (req.body.trades !== undefined && req.body.trades !== null) {
        const resolved = resolveTrades(req.body.trades, MarketWatch.MAX_TRADES_PER_WATCH)
        if (resolved.error) {
          res.status(400).json({ message: resolved.error })
          return
        }
        trades = resolved.trades
      }

      const target = await resolveFromRequest(marketService, req.body, market)
      if (!target) {
        res.status(400).json({
          message:
            market === 'tw'
              ? '台股裡找不到這個標的，請輸入代號或名稱（例如 2330、台積電、0050）。'
              : '美股裡找不到這個代號，請輸入代號（例如 NVDA、AAPL）。',
        })
        return
      }
      const key = targetKey(target)

      // 已經在追蹤：新增表單選了它還沒在的清單，就把清單加上去（一檔可以在好幾個清單）；
      // 持股不動，免得同一筆買進記兩次（existing: true、tradesIgnored 讓前端說明）
      const existing = await MarketWatch.findOne({ user: req.auth.userId, key })
      if (existing) {
        const wanted = await resolveGroups(req.auth.userId, requestedGroups(req.body))
        if (wanted === undefined) {
          res.status(400).json({ message: '找不到這個清單。' })
          return
        }
        const current = watchGroupIds(existing)
        const added = wanted.filter((id) => !current.includes(String(id)))
        if (added.length === 0) {
          const names = (await groupsOf(req.auth.userId)).filter((g) => current.includes(g.id)).map((g) => `「${g.name}」`)
          const where = wanted.length && names.length ? `，而且已經在${names.join('、')}清單裡` : names.length ? `（在${names.join('、')}清單）` : ''
          res.status(409).json({ message: `${target.name} 已經在追蹤清單裡${where}。` })
          return
        }
        const watch = await MarketWatch.findOneAndUpdate(
          { _id: existing._id, user: req.auth.userId },
          { $set: { groups: [...current, ...added.map(String)], group: null } },
          { new: true },
        )
        const [summaries, fees] = await Promise.all([
          marketService.getWatchSummaries([watch.target]).catch(() => [null]),
          feesOf(req.auth.userId),
        ])
        res.json({ item: watchJSON(watch, summaries[0] ?? null, fees), existing: true, tradesIgnored: trades.length > 0 })
        return
      }
      const count = await MarketWatch.countDocuments({ user: req.auth.userId })
      if (count >= MarketWatch.MAX_WATCHES_PER_USER) {
        res.status(400).json({ message: `自訂追蹤最多 ${MarketWatch.MAX_WATCHES_PER_USER} 檔，請先移除不需要的。` })
        return
      }

      let watch
      try {
        const groups = await resolveGroups(req.auth.userId, requestedGroups(req.body))
        if (groups === undefined) {
          res.status(400).json({ message: '找不到這個清單。' })
          return
        }
        const last = await MarketWatch.findOne({ user: req.auth.userId }).sort({ order: -1 })
        watch = await MarketWatch.create({ user: req.auth.userId, key, target, trades, groups, group: null, order: (last?.order ?? 0) + 1 })
      } catch (error) {
        // 同時送出兩次時由唯一索引擋下
        if (error?.code === 11000) {
          res.status(409).json({ message: `${target.name} 已經在追蹤清單裡。` })
          return
        }
        throw error
      }
      // 摘要查不到不影響新增，畫面上會顯示「暫時取不到報價」
      const [summaries, fees] = await Promise.all([
        marketService.getWatchSummaries([watch.target]).catch(() => [null]),
        feesOf(req.auth.userId),
      ])
      res.status(201).json({ item: watchJSON(watch, summaries[0] ?? null, fees) })
    } catch (error) {
      next(error)
    }
  })

  // 展開卡片：價格走勢圖（均線、支撐壓力）、籌碼與估值（台股）。點開才查，不放進清單摘要
  router.get('/watchlist/:id/detail', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這個追蹤項目。' })
        return
      }
      const watch = await MarketWatch.findOne({ _id: req.params.id, user: req.auth.userId })
      if (!watch) {
        res.status(404).json({ message: '找不到這個追蹤項目。' })
        return
      }
      const detail = await marketService.getWatchDetail(watch.target)
      if (!detail) {
        res.status(502).json({ message: '這檔的行情暫時取不到，稍後再試。' })
        return
      }
      res.json({ detail })
    } catch (error) {
      next(error)
    }
  })

  // 更新持股：trades（買賣紀錄）、dividends（股利）、dismissedEntitlements（刪掉的應收股利）各自整批替換，可以只送其中一個；空陣列代表清除
  router.patch('/watchlist/:id', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這個追蹤項目。' })
        return
      }
      const hasTrades = Boolean(req.body) && 'trades' in req.body
      const hasDividends = Boolean(req.body) && 'dividends' in req.body
      const hasGroup = Boolean(req.body) && ('groups' in req.body || 'group' in req.body)
      const hasDismissed = Boolean(req.body) && 'dismissedEntitlements' in req.body
      if (!hasTrades && !hasDividends && !hasGroup && !hasDismissed) {
        res.status(400).json({ message: '沒有要更新的內容。' })
        return
      }
      const update = {}
      if (hasGroup) {
        const groups = await resolveGroups(req.auth.userId, requestedGroups(req.body))
        if (groups === undefined) {
          res.status(400).json({ message: '找不到這個清單。' })
          return
        }
        // 舊格式的單一清單一併清掉，之後只看 groups
        Object.assign(update, { groups, group: null })
      }
      if (hasTrades) {
        const { trades, error } = resolveTrades(req.body.trades, MarketWatch.MAX_TRADES_PER_WATCH)
        if (error) {
          res.status(400).json({ message: error })
          return
        }
        // 舊格式的 lots 已經轉進 trades，一併清掉
        Object.assign(update, { trades, lots: [] })
      }
      if (hasDividends) {
        const { dividends, error } = resolveDividends(req.body.dividends, MarketWatch.MAX_DIVIDENDS_PER_WATCH)
        if (error) {
          res.status(400).json({ message: error })
          return
        }
        // 舊版（和目前的）前端編輯持股時只送 amount、date：金額與入帳日都和原本某一筆相同的，沿用原本的 exDate，
        // 否則存一次持股就把「從應收股利帶入」的標記清掉，同一次股利會被要求再帶入一次（v20 審查）
        if (dividends.some((d) => !d.exDate)) {
          const existing = await MarketWatch.findOne({ _id: req.params.id, user: req.auth.userId })
          const pool = (existing?.dividends || []).filter((d) => d.exDate)
          for (const dividend of dividends) {
            if (dividend.exDate) continue
            const index = pool.findIndex((d) => d.amount === dividend.amount && (d.date || null) === dividend.date)
            if (index >= 0) dividend.exDate = pool.splice(index, 1)[0].exDate
          }
        }
        update.dividends = dividends
      }
      if (hasDismissed) {
        const { dismissed, error } = resolveDismissed(req.body.dismissedEntitlements, MarketWatch.MAX_DISMISSED_PER_WATCH)
        if (error) {
          res.status(400).json({ message: error })
          return
        }
        update.dismissedEntitlements = dismissed
      }
      const watch = await MarketWatch.findOneAndUpdate(
        { _id: req.params.id, user: req.auth.userId },
        { $set: update },
        { new: true },
      )
      if (!watch) {
        res.status(404).json({ message: '找不到這個追蹤項目。' })
        return
      }
      const [summaries, fees] = await Promise.all([
        marketService.getWatchSummaries([watch.target]).catch(() => [null]),
        feesOf(req.auth.userId),
      ])
      res.json({ item: watchJSON(watch, summaries[0] ?? null, fees) })
    } catch (error) {
      next(error)
    }
  })

  // 自訂順序：ids 依序寫入 order（只處理自己的；沒列到的維持原本的值）
  router.put('/watchlist/order', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const ids = req.body?.ids
      if (!Array.isArray(ids) || ids.length > 200 || !ids.every((id) => mongoose.isValidObjectId(id))) {
        res.status(400).json({ message: '排序資料格式不正確。' })
        return
      }
      await Promise.all(ids.map((id, index) => MarketWatch.updateOne({ _id: id, user: req.auth.userId }, { $set: { order: index + 1 } })))
      res.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  // ---- 自選清單 ----

  const requireGroups = (req, res, next) => {
    if (!MarketWatchGroup) {
      res.status(503).json({ message: '自選清單尚未啟用。' })
      return
    }
    next()
  }
  const groupJSON = (group) => ({ id: String(group._id), name: group.name, order: group.order ?? 0 })
  const groupName = (raw) => (typeof raw === 'string' ? raw.trim().slice(0, 20) : '')

  router.get('/groups', requireStockAccess, requireGroups, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      res.json({ groups: await groupsOf(req.auth.userId) })
    } catch (error) {
      next(error)
    }
  })

  router.post('/groups', requireStockAccess, requireGroups, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const name = groupName(req.body?.name)
      if (!name) {
        res.status(400).json({ message: '請輸入清單名稱（最多 20 字）。' })
        return
      }
      const existing = await MarketWatchGroup.find({ user: req.auth.userId }).sort({ order: 1 })
      if (existing.length >= MarketWatchGroup.MAX_GROUPS_PER_USER) {
        res.status(400).json({ message: `清單最多 ${MarketWatchGroup.MAX_GROUPS_PER_USER} 個。` })
        return
      }
      if (existing.some((g) => g.name === name)) {
        res.status(409).json({ message: `已經有「${name}」這個清單了。` })
        return
      }
      let group
      try {
        group = await MarketWatchGroup.create({ user: req.auth.userId, name, order: (existing.at(-1)?.order ?? 0) + 1 })
      } catch (error) {
        // 同時送出兩次時由唯一索引擋下
        if (error?.code === 11000) {
          res.status(409).json({ message: `已經有「${name}」這個清單了。` })
          return
        }
        throw error
      }
      res.status(201).json({ group: groupJSON(group) })
    } catch (error) {
      next(error)
    }
  })

  router.patch('/groups/:id', requireStockAccess, requireGroups, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const name = groupName(req.body?.name)
      if (!mongoose.isValidObjectId(req.params.id) || !name) {
        res.status(400).json({ message: '請輸入清單名稱（最多 20 字）。' })
        return
      }
      if (await MarketWatchGroup.findOne({ user: req.auth.userId, name, _id: { $ne: req.params.id } })) {
        res.status(409).json({ message: `已經有「${name}」這個清單了。` })
        return
      }
      let group
      try {
        group = await MarketWatchGroup.findOneAndUpdate({ _id: req.params.id, user: req.auth.userId }, { $set: { name } }, { new: true })
      } catch (error) {
        if (error?.code === 11000) {
          res.status(409).json({ message: `已經有「${name}」這個清單了。` })
          return
        }
        throw error
      }
      if (!group) {
        res.status(404).json({ message: '找不到這個清單。' })
        return
      }
      res.json({ group: groupJSON(group) })
    } catch (error) {
      next(error)
    }
  })

  // 刪除清單：裡面的股票移到「未分類」，不會被刪掉
  router.delete('/groups/:id', requireStockAccess, requireGroups, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這個清單。' })
        return
      }
      const result = await MarketWatchGroup.deleteOne({ _id: req.params.id, user: req.auth.userId })
      if (result.deletedCount === 0) {
        res.status(404).json({ message: '找不到這個清單。' })
        return
      }
      // 只把這個清單從各檔拿掉；同時在別的清單的照樣留著，一個都不剩的就是未分類
      await MarketWatch.updateMany({ user: req.auth.userId, groups: req.params.id }, { $pull: { groups: req.params.id } })
      await MarketWatch.updateMany({ user: req.auth.userId, group: req.params.id }, { $set: { group: null } })
      res.json({ groups: await groupsOf(req.auth.userId) })
    } catch (error) {
      next(error)
    }
  })

  router.put('/groups/order', requireStockAccess, requireGroups, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const ids = req.body?.ids
      if (!Array.isArray(ids) || ids.length > 20 || !ids.every((id) => mongoose.isValidObjectId(id))) {
        res.status(400).json({ message: '排序資料格式不正確。' })
        return
      }
      await Promise.all(ids.map((id, index) => MarketWatchGroup.updateOne({ _id: id, user: req.auth.userId }, { $set: { order: index + 1 } })))
      res.json({ groups: await groupsOf(req.auth.userId) })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/watchlist/:id', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這個追蹤項目。' })
        return
      }
      const result = await MarketWatch.deleteOne({ _id: req.params.id, user: req.auth.userId })
      if (result.deletedCount === 0) {
        res.status(404).json({ message: '找不到這個追蹤項目。' })
        return
      }
      res.json({ deleted: true })
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createMarketRouter }
