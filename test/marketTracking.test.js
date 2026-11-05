const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { evaluateCall, summarizeCalls, recordCalls } = require('../src/services/market/tracking')
const { describeChips, describeValuation, streak } = require('../src/services/market/twseData')
const { alignDates } = require('../src/services/market/prediction')
const { computeSeries } = require('../src/services/market/series')
const { backtestStrategies } = require('../src/services/market/backtest')
const { createMarketRouter } = require('../src/routes/market')

const bars = (closes, start = 1) =>
  closes.map((close, i) => ({
    date: `2026-01-${String(start + i).padStart(2, '0')}`,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
  }))

// ---- 自動對答案 ----

test('對答案：偏多之後上漲算命中，資料不足的天數標成未到期', () => {
  const series = bars([100, 101, 102, 103, 104, 106, 107, 108, 109, 110, 111])
  const result = evaluateCall({ date: '2026-01-01', price: 100, stance: 'bullish', stopLoss: 95, targets: [105] }, series)
  assert.deepEqual(result.outcomes[0], { days: 5, ready: true, return: 6, hit: true })
  assert.equal(result.outcomes[1].ready, true)
  assert.equal(result.outcomes[2].ready, false)
  // 第 5 天高點 107 先碰到目標 105
  assert.equal(result.path, 'target')
})

test('對答案：偏空之後下跌算命中；先跌破停損記為 stop', () => {
  const series = bars([100, 98, 96, 94, 92, 90, 89, 88, 87, 86, 85])
  const bear = evaluateCall({ date: '2026-01-01', price: 100, stance: 'bearish' }, series)
  assert.equal(bear.outcomes[0].hit, true)
  const bull = evaluateCall({ date: '2026-01-01', price: 100, stance: 'bullish', stopLoss: 95, targets: [110] }, series)
  assert.equal(bull.outcomes[0].hit, false)
  assert.equal(bull.path, 'stop')
})

test('對答案：統計整體命中率、各方向與各信心的命中率，觀望不算命中率', () => {
  const up = bars([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110])
  const barsBySymbol = new Map([['A', up]])
  const calls = [
    { _id: 1, symbol: 'A', date: '2026-01-01', price: 100, stance: 'bullish', confidence: 'high' },
    { _id: 2, symbol: 'A', date: '2026-01-02', price: 101, stance: 'bearish', confidence: 'low' },
    { _id: 3, symbol: 'A', date: '2026-01-03', price: 102, stance: 'neutral', confidence: 'low' },
    { _id: 4, symbol: 'A', date: '2026-01-09', price: 108, stance: 'bullish', confidence: 'high' },
  ]
  const summary = summarizeCalls(calls, barsBySymbol)
  const five = summary.horizons[0]
  assert.equal(five.evaluated, 2)
  assert.equal(five.hitRate, 50)
  assert.equal(five.bullish.hitRate, 100)
  assert.equal(five.bearish.hitRate, 0)
  assert.equal(five.neutral.count, 1)
  assert.equal(five.neutral.hitRate, null)
  assert.equal(five.byConfidence.high.hitRate, 100)
  assert.equal(summary.pending, 1)
})

test('對答案：只記錄有建議的標的，同一天同一標的覆蓋', async () => {
  const writes = []
  const MarketCall = { bulkWrite: async (ops) => writes.push(...ops) }
  await recordCalls(MarketCall, 'user-1', {
    items: [
      { symbol: '2330.TW', quote: { date: '2026-11-05', price: 2260 }, advice: { stance: 'bearish', confidence: 'high', levels: { stopLoss: { price: 2235 }, targets: [{ price: 2303 }] } } },
      { symbol: 'NOPE', quote: { date: '2026-11-05', price: 1 }, advice: null },
    ],
  })
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].updateOne.filter, { user: 'user-1', symbol: '2330.TW', date: '2026-11-05' })
  assert.equal(writes[0].updateOne.upsert, true)
  assert.deepEqual(writes[0].updateOne.update.$set.targets, [2303])
})

// ---- 籌碼與估值的判讀 ----

test('籌碼：連續買賣超天數與判讀文字', () => {
  assert.equal(streak([1, -2, -3, -4]), -3)
  assert.equal(streak([5, 6]), 2)
  assert.equal(streak([]), 0)
  const summary = describeChips(
    { unit: '張', dates: ['a', 'b', 'c'], foreign: [-10, -20, -30], trust: [5, -1, 2], dealer: [0, 0, 0], margin: { balance: 1100, change: 100, days: 5 } },
    -3,
  )
  assert.equal(summary.foreign.text, '外資 3 日賣超 60 張，連續 3 日賣超')
  assert.equal(summary.trust.total, 6)
  // 股價跌、融資增加 10%：偏空
  assert.equal(summary.margin.direction, -1)
  assert.match(summary.margin.text, /散戶在接刀/)
})

test('估值：本益比百分位 85 以上算偏貴', () => {
  assert.equal(describeValuation({ pe: 50, pePercentile: 90, dividendYield: 1, yieldPercentile: 10 }).expensive, true)
  assert.equal(describeValuation({ pe: 10, pePercentile: 15, dividendYield: 6, yieldPercentile: 90 }).notes.length, 2)
  assert.equal(describeValuation(null), null)
})

// ---- 大盤日期對齊、分段驗證 ----

test('大盤特徵：每一天對應到同一天或之前最近的大盤交易日', () => {
  assert.deepEqual(alignDates(['2026-01-02', '2026-01-03', '2026-01-05'], ['2026-01-01', '2026-01-03', '2026-01-04']), [0, 1, 2])
  assert.deepEqual(alignDates(['2025-12-31'], ['2026-01-01']), [-1])
})

test('策略：有分段驗證與停損版本，買進持有不適用', () => {
  const closes = Array.from({ length: 400 }, (_, i) => 100 + 20 * Math.sin(i / 15) + i * 0.05)
  const series = computeSeries(closes.map((close, i) => ({ date: `d${i}`, open: close, high: close + 1, low: close - 1, close, volume: 1000 })))
  const result = backtestStrategies(series, 'tw')
  const buyHold = result.strategies.find((s) => s.key === 'buyHold')
  const maCross = result.strategies.find((s) => s.key === 'maCross')
  assert.equal(buyHold.withStop, null)
  assert.equal(buyHold.robust, null)
  assert.ok(maCross.withStop && typeof maCross.withStop.totalReturn === 'number')
  assert.equal(typeof maCross.robust, 'boolean')
  assert.equal(maCross.periods.early.buyHold, buyHold.periods.early.totalReturn)
  assert.ok(result.splitDate)
})

// ---- 路由 ----

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function fakeAlertModel() {
  const docs = []
  let seq = 0
  const wrap = (doc) => ({ ...doc, save: async function save() { Object.assign(docs.find((d) => d._id === this._id), this) } })
  return {
    MAX_ALERTS_PER_USER: 2,
    docs,
    find: (query) => {
      const list = docs.filter((d) => d.user === query.user && (query.active === undefined || d.active === query.active)).map(wrap)
      const promise = Promise.resolve(list)
      promise.sort = () => Promise.resolve(list)
      return promise
    },
    countDocuments: async (query) => docs.filter((d) => d.user === query.user).length,
    create: async (data) => {
      seq += 1
      const doc = { _id: `a${seq}`, active: true, triggeredAt: null, triggeredPrice: null, createdAt: new Date(), ...data }
      docs.push(doc)
      return doc
    },
    deleteOne: async (query) => {
      const index = docs.findIndex((d) => d._id === query._id && d.user === query.user)
      if (index >= 0) docs.splice(index, 1)
      return { deletedCount: index >= 0 ? 1 : 0 }
    },
  }
}

function makeApp({ MarketAlert, quotes = {} }) {
  const app = express()
  app.use(express.json())
  app.use(
    '/api/market',
    createMarketRouter({
      requireStockAccess: (req, _res, next) => {
        req.auth = { userId: 'u1' }
        next()
      },
      ensureDatabase: () => true,
      marketService: {
        resolveTarget: async (query) => (query === '台積電' ? { symbol: '2330.TW', code: '2330', exchange: 'tse', market: 'tw', kind: 'stock', name: '台積電' } : null),
        getQuote: async (target) => (quotes[target.symbol] ? { price: quotes[target.symbol] } : null),
      },
      MarketCall: {},
      MarketAlert,
    }),
  )
  return app
}

const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('提醒：可以用代號或名稱建立；找不到標的、價格不對回 400；超過上限擋下', async () => {
  const MarketAlert = fakeAlertModel()
  await withServer(makeApp({ MarketAlert }), async (base) => {
    assert.equal((await post(base, '/api/market/alerts', { query: '台積電', condition: 'below', price: 2235 })).status, 201)
    assert.equal((await post(base, '/api/market/alerts', { query: '不存在', condition: 'below', price: 1 })).status, 400)
    assert.equal((await post(base, '/api/market/alerts', { query: '台積電', condition: 'sideways', price: 1 })).status, 400)
    assert.equal((await post(base, '/api/market/alerts', { query: '台積電', condition: 'above', price: -5 })).status, 400)
    const target = { symbol: 'NVDA', market: 'us', kind: 'stock', name: 'NVIDIA' }
    assert.equal((await post(base, '/api/market/alerts', { target, condition: 'above', price: 220 })).status, 201)
    // 上限 2 個
    assert.equal((await post(base, '/api/market/alerts', { target, condition: 'above', price: 230 })).status, 400)
  })
  assert.equal(MarketAlert.docs.length, 2)
  assert.equal(MarketAlert.docs[0].target.name, '台積電')
})

test('提醒：檢查時到價的標成已觸發，沒到的維持', async () => {
  const MarketAlert = fakeAlertModel()
  await MarketAlert.create({ user: 'u1', target: { symbol: '2330.TW', market: 'tw', kind: 'stock' }, condition: 'below', price: 2235 })
  await MarketAlert.create({ user: 'u1', target: { symbol: 'NVDA', market: 'us', kind: 'stock' }, condition: 'above', price: 250 })
  await withServer(makeApp({ MarketAlert, quotes: { '2330.TW': 2230, NVDA: 200 } }), async (base) => {
    const response = await post(base, '/api/market/alerts/check', {})
    const body = await response.json()
    assert.equal(body.triggered.length, 1)
    assert.equal(body.triggered[0].triggeredPrice, 2230)
    assert.equal(body.prices.NVDA, 200)
  })
  assert.equal(MarketAlert.docs[0].active, false)
  assert.equal(MarketAlert.docs[1].active, true)
})

test('提醒：標的欄位格式不對（交易所、代號、symbol）一律擋下', async () => {
  const MarketAlert = fakeAlertModel()
  await withServer(makeApp({ MarketAlert }), async (base) => {
    const bad = [
      { code: '2330', exchange: 'tse|otc_9999', market: 'tw', kind: 'stock' },
      { code: '../x', exchange: 'tse', market: 'tw', kind: 'stock' },
      { symbol: 'A B&c=1', market: 'us', kind: 'stock' },
    ]
    for (const target of bad) {
      assert.equal((await post(base, '/api/market/alerts', { target, condition: 'above', price: 1 })).status, 400)
    }
    const ok = { symbol: '00400A.TW', code: '00400A', exchange: 'tse', market: 'tw', kind: 'stock' }
    assert.equal((await post(base, '/api/market/alerts', { target: ok, condition: 'above', price: 1 })).status, 201)
  })
})
