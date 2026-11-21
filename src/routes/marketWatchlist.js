// 自訂股票追蹤 API（2026-11-21 從 routes/market.js 拆出來；網址不變）：追蹤清單與持股、自選清單、獲利與股利、存股試算自選一檔
//   GET/POST /watchlist、GET /watchlist/:id/detail、PATCH/DELETE /watchlist/:id、PUT /watchlist/order
//   GET/POST /groups、PATCH/DELETE /groups/:id、PUT /groups/order、GET /income、GET /dividend-profile
// searchLimit 由 createMarketRouter 傳進來，和 /search 共用同一份計數
const express = require('express')
const mongoose = require('mongoose')

const { nextRevenueDeadline } = require('../services/market/corporateEvents')
const { taipeiNow } = require('../services/market/snapshots')
const { computePosition, validateSequence, normalizeFees, tradesOf, DEFAULT_FEES } = require('../services/market/portfolio')
const { buildIncomeReport, normalizeConcentration, normalizeIncomeSettings } = require('../services/market/income')
const { attachPastEstimates } = require('../services/market/forecastLog')
const { resolveFromRequest, toPositive } = require('./marketHelpers')

// 美元兌台幣（獲利與股利合併成台幣用）
const FX_TARGET = { symbol: 'TWD=X', market: 'us', kind: 'index', name: '美元兌台幣' }

const targetKey = (target) => target.symbol || `${target.exchange}_${target.code}`

// 持股：買賣紀錄與股利。數量、價格、金額都要是正數；上限只是擋掉打錯的值
const MAX_HOLDING_QUANTITY = 10_000_000
const MAX_HOLDING_PRICE = 10_000_000
const MAX_DIVIDEND_AMOUNT = 1_000_000_000
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

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

function createMarketWatchlistRouter({
  requireStockAccess,
  ensureDatabase,
  marketService,
  MarketWatch,
  // 自選清單（v17 階段 2）；測試可以不傳，相關端點回 503
  MarketWatchGroup = null,
  MarketProfile = null,
  // 每日資產快照（v16 階段 3）；測試可以不傳
  snapshots = null,
  // 重大訊息（股利決議，v20）；測試可以不傳
  news = null,
  // 股利預估的紀錄與驗證（v20）；測試可以不傳，就不記也不比
  forecastLog = null,
  searchLimit,
}) {
  const router = express.Router()

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
      const [summaries, fees, settings, histories, notices, usdTwd, industries, concentration, decisions] = await Promise.all([
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
        // 董事會的股利分派決議（重大訊息，v20 2.9.10）：股利預估先用決議的金額；抓不到就照舊推估
        news?.listDecisions && twCodes.length ? news.listDecisions(twCodes).catch(() => null) : null,
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
        decisions,
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

  // 存股試算自選一檔（v20 2.9.9，2026-11-11 使用者要求「輸入代號自選，跟加入追蹤一樣」）：不用先加入追蹤。
  // GET /dividend-profile?market=tw|us&q=代號或名稱 → 現價、配息頻率、近 12 個月與多年平均殖利率。
  // 把這一檔當成「沒有持股的追蹤項目」丟進 buildIncomeReport，數字和股利頁清單裡的股票同一套算法；
  // 美股另外給美元兌台幣（試算的金額都是台幣），取不到是 null
  router.get('/dividend-profile', requireStockAccess, searchLimit, async (req, res, next) => {
    try {
      const { market } = req.query
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 30) : ''
      if (!['tw', 'us'].includes(market) || !q) {
        res.status(400).json({ message: '請選擇台股或美股，並輸入代號或名稱。' })
        return
      }
      const target = await marketService.resolveTarget(q, market)
      if (!target) {
        res.status(404).json({ message: `找不到「${q}」。` })
        return
      }
      if (target.kind !== 'stock' || !target.symbol) {
        res.status(400).json({ message: `${target.name || q} 不是個股或 ETF，沒有股利可以試算。` })
        return
      }
      const [quote, histories, usdTwd] = await Promise.all([
        marketService.getQuote(target).catch(() => null),
        marketService.getDividendHistories([target]),
        market === 'us'
          ? marketService
              .getQuote(FX_TARGET)
              .then((fx) => fx?.price ?? null)
              .catch(() => null)
          : null,
      ])
      const price = quote?.price ?? null
      const item = { id: 'simulate', target, groups: [], trades: [], dividends: [], dismissedEntitlements: [], position: null, summary: price === null ? null : { quote: { price } } }
      const row = buildIncomeReport({ items: [item], histories, today: taipeiNow().date }).items[0]
      res.json({
        profile: {
          target,
          price,
          usdTwd,
          dividendStatus: row.dividendStatus,
          frequency: row.projection?.frequency ?? 'none',
          currentYield: row.currentYield,
          dividendAverage: row.dividendAverage,
        },
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

module.exports = { createMarketWatchlistRouter, watchJSON, watchGroupIds }
