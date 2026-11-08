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
    // 條件式更新：只有 active 還是 true 的那一筆會被觸發
    findOneAndUpdate: async (query, update) => {
      const doc = docs.find((d) => d._id === query._id && (query.active === undefined || d.active === query.active) && (query.user === undefined || d.user === query.user))
      if (!doc) return null
      Object.assign(doc, update.$set)
      return wrap(doc)
    },
    updateOne: async (query, update) => {
      const doc = docs.find((d) => d._id === query._id)
      if (doc) Object.assign(doc, update.$set)
      return { modifiedCount: doc ? 1 : 0 }
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
        // 帶 target 時路由會依市場重新解析：台股用代號、美股用 symbol
        resolveTarget: async (query, market) => {
          if (query === '台積電' || (market === 'tw' && query === '2330')) return { symbol: '2330.TW', code: '2330', exchange: 'tse', market: 'tw', kind: 'stock', name: '台積電' }
          if (market === 'tw' && query === '00400A') return { symbol: '00400A.TW', code: '00400A', exchange: 'tse', market: 'tw', kind: 'stock', name: '主動ETF' }
          if (market === 'us' && /^[A-Z]{1,5}$/.test(query)) return { symbol: query, market: 'us', kind: 'stock', name: query }
          return null
        },
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

// ---- 自訂股票追蹤 ----

const { resolveTargetIn } = require('../src/services/market/symbols')

test('自訂追蹤找標的：台股用代號或名稱（含部分名稱），美股用代號或中文名，市場不對就找不到', () => {
  const directory = [
    { code: '2330', name: '台積電', exchange: 'tse' },
    { code: '2454', name: '聯發科', exchange: 'tse' },
    { code: '0050', name: '元大台灣50', exchange: 'tse' },
    { code: '6488', name: '環球晶', exchange: 'otc' },
  ]
  assert.equal(resolveTargetIn('2330', 'tw', { directory }).symbol, '2330.TW')
  assert.equal(resolveTargetIn('聯發', 'tw', { directory }).code, '2454')
  assert.equal(resolveTargetIn('環球晶', 'tw', { directory }).symbol, '6488.TWO')
  assert.equal(resolveTargetIn('加權指數', 'tw', { directory }).symbol, '^TWII')
  assert.equal(resolveTargetIn('台', 'tw', { directory }), null)
  assert.equal(resolveTargetIn('NVDA', 'tw', { directory }), null)
  assert.equal(resolveTargetIn('$nvda', 'us', { directory }).symbol, 'NVDA')
  assert.equal(resolveTargetIn('輝達', 'us', { directory }).symbol, 'NVDA')
  assert.equal(resolveTargetIn('BRK-B', 'us', { directory }).symbol, 'BRK-B')
  assert.equal(resolveTargetIn('那斯達克', 'us', { directory }).symbol, '^IXIC')
  assert.equal(resolveTargetIn('台積電', 'us', { directory }), null)
})

function fakeWatchModel() {
  const docs = []
  let seq = 0
  return {
    MAX_WATCHES_PER_USER: 2,
    MAX_TRADES_PER_WATCH: 3,
    MAX_DIVIDENDS_PER_WATCH: 2,
    docs,
    find: (query) => {
      const list = docs.filter((d) => d.user === query.user)
      return { sort: async () => list }
    },
    findOne: (query) => {
      const list = docs.filter((d) => d.user === query.user && (query.key === undefined || d.key === query.key))
      const promise = Promise.resolve(list[0] || null)
      // findOne({ user }).sort({ order: -1 })：順序最大的那一筆
      promise.sort = async () => [...list].sort((a, b) => (b.order ?? 0) - (a.order ?? 0))[0] || null
      return promise
    },
    countDocuments: async (query) => docs.filter((d) => d.user === query.user).length,
    create: async (data) => {
      seq += 1
      const doc = { _id: `507f1f77bcf86cd79943901${seq}`, createdAt: new Date(), trades: [], dividends: [], lots: [], ...data }
      docs.push(doc)
      return doc
    },
    findOneAndUpdate: async (query, update) => {
      const doc = docs.find((d) => d._id === query._id && d.user === query.user)
      if (!doc) return null
      Object.assign(doc, update.$set)
      return doc
    },
    deleteOne: async (query) => {
      const index = docs.findIndex((d) => d._id === query._id && d.user === query.user)
      if (index >= 0) docs.splice(index, 1)
      return { deletedCount: index >= 0 ? 1 : 0 }
    },
  }
}

function makeWatchApp(MarketWatch) {
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
        resolveTarget: async (query, market) => {
          if (market === 'tw' && query === '2330') return { symbol: '2330.TW', code: '2330', exchange: 'tse', market: 'tw', kind: 'stock', name: '台積電' }
          if (market === 'us' && query === 'NVDA') return { symbol: 'NVDA', market: 'us', kind: 'stock', name: 'NVIDIA' }
          if (market === 'us' && query === 'AAPL') return { symbol: 'AAPL', market: 'us', kind: 'stock', name: 'Apple' }
          if (market === 'us' && query === '^GSPC') return { symbol: '^GSPC', market: 'us', kind: 'index', name: '標普 500 指數' }
          if (market === 'tw' && query === '2454') return { symbol: '2454.TW', code: '2454', exchange: 'tse', market: 'tw', kind: 'stock', name: '聯發科' }
          return null
        },
        getWatchSummaries: async (targets) => targets.map((t) => ({ name: t.name, quote: { price: 100 } })),
      },
      MarketCall: {},
      MarketAlert: {},
      MarketWatch,
    }),
  )
  return app
}

const send = (base, path, method, body) =>
  fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('自訂追蹤：依市場新增、重複擋下、上限擋下、持股驗證，清單帶摘要', async () => {
  const MarketWatch = fakeWatchModel()
  await withServer(makeWatchApp(MarketWatch), async (base) => {
    const created = await send(base, '/api/market/watchlist', 'POST', { market: 'tw', query: '2330', trades: [{ side: 'buy', quantity: 2, price: 980 }] })
    assert.equal(created.status, 201)
    const { item } = await created.json()
    assert.deepEqual(item.trades, [{ side: 'buy', quantity: 2, price: 980, date: null }])
    // 2 張 × 100 元的市值，成本 1,960,000 + 手續費 2,793
    assert.equal(item.position.quantity, 2)
    assert.equal(item.position.costBasis, 1962793)
    assert.equal(item.summary.quote.price, 100)

    // 市場選錯、找不到、重複、格式不對
    assert.equal((await send(base, '/api/market/watchlist', 'POST', { market: 'us', query: '2330' })).status, 400)
    assert.equal((await send(base, '/api/market/watchlist', 'POST', { market: 'jp', query: '2330' })).status, 400)
    assert.equal((await send(base, '/api/market/watchlist', 'POST', { market: 'tw', query: '2330' })).status, 409)
    assert.equal((await send(base, '/api/market/watchlist', 'POST', { market: 'us', query: 'NVDA', trades: [{ side: 'buy', quantity: -1, price: 1 }] })).status, 400)

    assert.equal((await send(base, '/api/market/watchlist', 'POST', { market: 'us', query: 'NVDA' })).status, 201)
    // 上限 2 檔
    assert.equal((await send(base, '/api/market/watchlist', 'POST', { market: 'us', query: 'AAPL' })).status, 400)

    const list = await (await fetch(`${base}/api/market/watchlist`)).json()
    assert.equal(list.items.length, 2)
    assert.equal(list.items[1].target.market, 'us')
    assert.deepEqual(list.items[1].trades, [])
    assert.equal(list.items[1].position, null)
  })
  assert.equal(MarketWatch.docs[0].key, '2330.TW')
})

test('自訂追蹤：更新與清除持股、刪除；別人的或不存在的回 404', async () => {
  const MarketWatch = fakeWatchModel()
  const own = await MarketWatch.create({ user: 'u1', key: 'NVDA', target: { symbol: 'NVDA', market: 'us', kind: 'stock', name: 'NVIDIA' } })
  const other = await MarketWatch.create({ user: 'u2', key: 'NVDA', target: { symbol: 'NVDA', market: 'us', kind: 'stock', name: 'NVIDIA' } })
  await withServer(makeWatchApp(MarketWatch), async (base) => {
    const trades = [
      { side: 'buy', quantity: 10, price: 180.5, date: '2026-10-01' },
      { side: 'sell', quantity: 4, price: 200 },
    ]
    const updated = await send(base, `/api/market/watchlist/${own._id}`, 'PATCH', { trades, dividends: [{ amount: 3.2 }] })
    assert.equal(updated.status, 200)
    const updatedItem = (await updated.json()).item
    assert.deepEqual(updatedItem.trades, [
      { side: 'buy', quantity: 10, price: 180.5, date: '2026-10-01' },
      { side: 'sell', quantity: 4, price: 200, date: null },
    ])
    assert.deepEqual(updatedItem.dividends, [{ amount: 3.2, date: null }])
    // 美股手續費預設 0：已實現 = 4 × (200 − 180.5)
    assert.equal(updatedItem.position.realized, 78)
    assert.equal(updatedItem.position.quantity, 6)
    assert.equal(updatedItem.position.dividends, 3.2)
    // 賣超過持有數量擋下
    assert.equal(
      (await send(base, `/api/market/watchlist/${own._id}`, 'PATCH', { trades: [{ side: 'buy', quantity: 1, price: 1 }, { side: 'sell', quantity: 2, price: 1 }] })).status,
      400,
    )
    assert.equal((await send(base, `/api/market/watchlist/${own._id}`, 'PATCH', { trades: [{ side: 'hold', quantity: 1, price: 1 }] })).status, 400)
    assert.equal((await send(base, `/api/market/watchlist/${own._id}`, 'PATCH', { dividends: [{ amount: 0 }] })).status, 400)
    assert.equal((await send(base, `/api/market/watchlist/${own._id}`, 'PATCH', { dividends: Array(3).fill({ amount: 1 }) })).status, 400)
    // 任一筆不合格整批擋下；日期格式；超過筆數上限（測試設 3）；不是陣列
    assert.equal((await send(base, `/api/market/watchlist/${own._id}`, 'PATCH', { trades: [{ side: 'buy', quantity: 1, price: 1 }, { side: 'buy', quantity: 1, price: 0 }] })).status, 400)
    assert.equal((await send(base, `/api/market/watchlist/${own._id}`, 'PATCH', { trades: [{ side: 'buy', quantity: 1, price: 1, date: '10/01' }] })).status, 400)
    assert.equal((await send(base, `/api/market/watchlist/${own._id}`, 'PATCH', { trades: Array(4).fill({ side: 'buy', quantity: 1, price: 1 }) })).status, 400)
    assert.equal((await send(base, `/api/market/watchlist/${own._id}`, 'PATCH', { trades: { side: 'buy', quantity: 1, price: 1 } })).status, 400)
    assert.equal((await send(base, `/api/market/watchlist/${own._id}`, 'PATCH', { trades: [{ side: 'buy', quantity: 1, price: 0 }] })).status, 400)
    assert.equal((await send(base, `/api/market/watchlist/${own._id}`, 'PATCH', {})).status, 400)
    const cleared = await send(base, `/api/market/watchlist/${own._id}`, 'PATCH', { trades: [], dividends: [] })
    const clearedItem = (await cleared.json()).item
    assert.deepEqual(clearedItem.trades, [])
    assert.equal(clearedItem.position, null)

    assert.equal((await send(base, `/api/market/watchlist/${other._id}`, 'PATCH', { trades: [] })).status, 404)
    assert.equal((await send(base, `/api/market/watchlist/${other._id}`, 'DELETE')).status, 404)
    assert.equal((await send(base, '/api/market/watchlist/not-an-id', 'DELETE')).status, 404)
    assert.equal((await send(base, `/api/market/watchlist/${own._id}`, 'DELETE')).status, 200)
  })
  assert.equal(MarketWatch.docs.length, 1)
  assert.equal(MarketWatch.docs[0].user, 'u2')
})

test('下拉候選：台股比對代號開頭與名稱，完全相同排最前；美股比對中文名與指數', () => {
  const { searchTargets } = require('../src/services/market/symbols')
  const directory = [
    { code: '2330', name: '台積電', exchange: 'tse' },
    { code: '2303', name: '聯電', exchange: 'tse' },
    { code: '2454', name: '聯發科', exchange: 'tse' },
    { code: '1459', name: '聯發', exchange: 'tse' },
  ]
  assert.deepEqual(searchTargets('23', 'tw', { directory }).map((t) => t.code), ['2303', '2330'])
  assert.deepEqual(searchTargets('聯發', 'tw', { directory }).map((t) => t.code), ['1459', '2454'])
  assert.equal(searchTargets('加權', 'tw', { directory })[0].symbol, '^TWII')
  assert.equal(searchTargets('輝', 'us', { directory })[0].symbol, 'NVDA')
  assert.equal(searchTargets('標普', 'us', { directory })[0].kind, 'index')
  assert.deepEqual(searchTargets('', 'tw', { directory }), [])
})

test('自訂追蹤：下拉選的 target 由後端重新解析（市場要一致），搜尋要指定市場', async () => {
  const MarketWatch = fakeWatchModel()
  const app = makeWatchApp(MarketWatch)
  await withServer(app, async (base) => {
    const target = { symbol: '^GSPC', market: 'us', kind: 'index', name: '標普 500 指數' }
    assert.equal((await send(base, '/api/market/watchlist', 'POST', { market: 'tw', query: 'x', target })).status, 400)
    const created = await send(base, '/api/market/watchlist', 'POST', { market: 'us', query: '標普', target })
    assert.equal(created.status, 201)
    assert.equal((await created.json()).item.target.kind, 'index')
    assert.equal((await fetch(`${base}/api/market/search?market=jp&q=a`)).status, 400)
  })
})

test('自訂追蹤：前端帶來互相矛盾的 target 以後端解析為準；持股數量不是數字擋下', async () => {
  const MarketWatch = fakeWatchModel()
  await withServer(makeWatchApp(MarketWatch), async (base) => {
    const forged = { symbol: '2330.TW', code: '2454', exchange: 'tse', market: 'tw', kind: 'stock', name: '亂寫的名字' }
    const created = await send(base, '/api/market/watchlist', 'POST', { market: 'tw', query: 'x', target: forged })
    const { item } = await created.json()
    assert.equal(item.target.symbol, '2454.TW')
    assert.equal(item.target.name, '聯發科')
    assert.equal((await send(base, '/api/market/watchlist', 'POST', { market: 'us', query: 'NVDA', trades: [{ side: 'buy', quantity: true, price: 1 }] })).status, 400)
    assert.equal((await send(base, '/api/market/watchlist', 'POST', { market: 'us', query: 'NVDA', trades: [{ side: 'buy', quantity: 1, price: 1e300 }] })).status, 400)
  })
})

test('自訂追蹤找標的：美股指數用代號也找得到，不會被當成個股', () => {
  assert.equal(resolveTargetIn('^GSPC', 'us', {}).kind, 'index')
})

test('自訂追蹤摘要：同一檔同時查只打一次 Yahoo；查不到時一分鐘內不重打；light 不含建議與研究', async () => {
  const { createMarketService } = require('../src/services/market/marketService')
  let chartCalls = 0
  const closes = Array.from({ length: 80 }, (_, i) => 100 + i)
  const fetchImpl = async (url) => {
    if (url.includes('/v8/finance/chart/')) {
      chartCalls += 1
      if (url.includes('NOPE')) return { ok: false, status: 404, json: async () => ({}) }
      const timestamp = closes.map((_, i) => 1767225600 + i * 86400)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          chart: { result: [{ meta: { currency: 'USD', shortName: 'Fake' }, timestamp, indicators: { quote: [{ open: closes, high: closes.map((c) => c + 1), low: closes.map((c) => c - 1), close: closes, volume: closes.map(() => 1000) }] } }] },
        }),
      }
    }
    return { ok: false, status: 500, json: async () => ({}) }
  }
  const service = createMarketService({ fetchImpl })
  const fake = { symbol: 'FAKE', market: 'us', kind: 'stock', name: 'FAKE' }
  const [a, b] = await Promise.all([service.getWatchSummaries([fake]), service.getWatchSummaries([fake])])
  assert.equal(chartCalls, 1)
  assert.equal(a[0].spark.length, 60)
  assert.ok(a[0].range52w.position >= 95)
  assert.equal(b[0].quote.price, 179)
  assert.equal('advice' in a[0], false)

  const missing = { symbol: 'NOPE', market: 'us', kind: 'stock', name: 'NOPE' }
  assert.deepEqual(await service.getWatchSummaries([missing]), [null])
  assert.deepEqual(await service.getWatchSummaries([missing]), [null])
  assert.equal(chartCalls, 2)
})

test('展開卡片詳情：只能看自己的；查不到行情回 502', async () => {
  const MarketWatch = fakeWatchModel()
  const own = await MarketWatch.create({ user: 'u1', key: 'NVDA', target: { symbol: 'NVDA', market: 'us', kind: 'stock', name: 'NVIDIA' } })
  const missing = await MarketWatch.create({ user: 'u1', key: 'GONE', target: { symbol: 'GONE', market: 'us', kind: 'stock', name: 'GONE' } })
  const other = await MarketWatch.create({ user: 'u2', key: 'NVDA', target: { symbol: 'NVDA', market: 'us', kind: 'stock', name: 'NVIDIA' } })
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
      marketService: { getWatchDetail: async (target) => (target.symbol === 'NVDA' ? { chart: { dates: [] }, analysis: null, chips: null, valuation: null, notes: [] } : null) },
      MarketCall: {},
      MarketAlert: {},
      MarketWatch: { ...MarketWatch, findOne: async (q) => MarketWatch.docs.find((d) => d._id === q._id && d.user === q.user) || null },
    }),
  )
  await withServer(app, async (base) => {
    const ok = await fetch(`${base}/api/market/watchlist/${own._id}/detail`)
    assert.equal(ok.status, 200)
    assert.deepEqual((await ok.json()).detail.chart, { dates: [] })
    assert.equal((await fetch(`${base}/api/market/watchlist/${missing._id}/detail`)).status, 502)
    assert.equal((await fetch(`${base}/api/market/watchlist/${other._id}/detail`)).status, 404)
    assert.equal((await fetch(`${base}/api/market/watchlist/nope/detail`)).status, 404)
  })
})

test('提醒：各種條件的驗證、均線提醒建立時記下側別、重新啟用', async () => {
  const MarketAlert = fakeAlertModel()
  MarketAlert.MAX_ALERTS_PER_USER = 20
  const originalCreate = MarketAlert.create
  let hex = 0
  MarketAlert.create = async (data) => {
    const doc = await originalCreate(data)
    hex += 1
    doc._id = String(hex).padStart(24, '0')
    return doc
  }
  MarketAlert.findOneAndUpdate = async (query, update) => {
    const doc = MarketAlert.docs.find((d) => d._id === query._id && d.user === query.user)
    if (!doc) return null
    Object.assign(doc, update.$set)
    return doc
  }
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
        resolveTarget: async (q, market) => (market === 'us' && q === 'NVDA' ? { symbol: 'NVDA', market: 'us', kind: 'stock', name: 'NVIDIA' } : null),
        getAlertSignals: async () => ({ price: 110, ma20: 100, ma60: 120 }),
      },
      MarketCall: {},
      MarketAlert,
    }),
  )
  const target = { symbol: 'NVDA', market: 'us', kind: 'stock', name: 'NVIDIA' }
  await withServer(app, async (base) => {
    const create = (body) => post(base, '/api/market/alerts', { target, ...body })
    assert.equal((await create({ kind: 'changePct', params: { direction: 'up', value: 5 } })).status, 201)
    assert.equal((await create({ kind: 'changePct', params: { direction: 'up', value: 50 } })).status, 400)
    assert.equal((await create({ kind: 'kd', params: { direction: 'sideways' } })).status, 400)
    assert.equal((await create({ kind: 'rsi', params: { direction: 'below', value: 30 } })).status, 201)
    assert.equal((await create({ kind: 'volume', params: { value: 0.5 } })).status, 400)
    assert.equal((await create({ kind: 'magic' })).status, 400)
    const ma = await create({ kind: 'ma', params: { direction: 'below', period: 20 } })
    assert.equal(ma.status, 201)
    const { alert } = await ma.json()
    assert.equal(alert.description, '跌破月線（MA20）')
    // 價格 110 在 MA20 100 之上 → 記成 above
    assert.equal(MarketAlert.docs.find((d) => d._id === alert.id).lastSide, 'above')

    const doc = MarketAlert.docs.find((d) => d._id === alert.id)
    Object.assign(doc, { active: false, triggeredAt: new Date(), triggeredNote: 'MA20 100' })
    const reactivated = await post(base, `/api/market/alerts/${alert.id}/reactivate`, {})
    assert.equal(reactivated.status, 200)
    assert.equal((await reactivated.json()).alert.active, true)
    assert.equal(doc.lastSide, null)
  })
})

// ---- 自選清單（v17 階段 2）----

function fakeGroupModel() {
  const docs = []
  let seq = 0
  const matches = (doc, query) =>
    Object.entries(query).every(([k, v]) => (v && typeof v === 'object' && '$ne' in v ? String(doc[k]) !== String(v.$ne) : String(doc[k]) === String(v)))
  const chain = (list) => {
    const promise = Promise.resolve(list)
    promise.sort = async () => [...list].sort((a, b) => a.order - b.order)
    return promise
  }
  return {
    MAX_GROUPS_PER_USER: 2,
    docs,
    find: (query) => chain(docs.filter((d) => matches(d, query))),
    findOne: async (query) => docs.find((d) => matches(d, query)) || null,
    create: async (data) => {
      seq += 1
      const doc = { _id: String(seq).padStart(24, 'a'), createdAt: new Date(), ...data }
      docs.push(doc)
      return doc
    },
    findOneAndUpdate: async (query, update) => {
      const doc = docs.find((d) => matches(d, query))
      if (doc) Object.assign(doc, update.$set)
      return doc || null
    },
    updateOne: async (query, update) => {
      const doc = docs.find((d) => matches(d, query))
      if (doc) Object.assign(doc, update.$set)
    },
    deleteOne: async (query) => {
      const index = docs.findIndex((d) => matches(d, query))
      if (index >= 0) docs.splice(index, 1)
      return { deletedCount: index >= 0 ? 1 : 0 }
    },
  }
}

test('自選清單：新增、重複名稱與上限、改名、排序；一檔可以放進多個清單；刪除清單只從各檔拿掉；舊格式 group 照樣讀得到', async () => {
  const MarketWatch = fakeWatchModel()
  MarketWatch.updateMany = async (query, update) => {
    for (const d of MarketWatch.docs) {
      if (d.user !== query.user) continue
      if ('groups' in query && (d.groups || []).map(String).includes(String(query.groups)) && update.$pull) {
        d.groups = d.groups.filter((id) => String(id) !== String(update.$pull.groups))
      }
      if ('group' in query && String(d.group) === String(query.group) && update.$set) Object.assign(d, update.$set)
    }
  }
  MarketWatch.updateOne = async (query, update) => {
    const d = MarketWatch.docs.find((x) => x._id === query._id && x.user === query.user)
    if (d) Object.assign(d, update.$set)
  }
  const MarketWatchGroup = fakeGroupModel()
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
        resolveTarget: async (q, market) => (market === 'us' ? { symbol: q, market: 'us', kind: 'stock', name: q } : null),
        getWatchSummaries: async (targets) => targets.map(() => null),
      },
      MarketCall: {},
      MarketAlert: {},
      MarketWatch,
      MarketWatchGroup,
    }),
  )
  const send2 = (base, path, method, body) =>
    fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })

  await withServer(app, async (base) => {
    const longTerm = (await (await send2(base, '/api/market/groups', 'POST', { name: '長期存股' })).json()).group
    assert.equal((await send2(base, '/api/market/groups', 'POST', { name: '長期存股' })).status, 409)
    const shortTerm = (await (await send2(base, '/api/market/groups', 'POST', { name: '短線' })).json()).group
    assert.equal((await send2(base, '/api/market/groups', 'POST', { name: '第三個' })).status, 400)
    assert.equal((await send2(base, '/api/market/groups', 'POST', { name: '   ' })).status, 400)

    // 新增股票到清單；別人的或不存在的清單擋下
    const nvda = (await (await send2(base, '/api/market/watchlist', 'POST', { market: 'us', query: 'NVDA', group: longTerm.id })).json()).item
    assert.equal(nvda.group, longTerm.id)
    assert.deepEqual(nvda.groups, [longTerm.id])
    assert.equal((await send2(base, '/api/market/watchlist', 'POST', { market: 'us', query: 'AAPL', group: 'bbbbbbbbbbbbbbbbbbbbbbbb' })).status, 400)
    const aapl = (await (await send2(base, '/api/market/watchlist', 'POST', { market: 'us', query: 'AAPL' })).json()).item
    assert.equal(aapl.group, null)
    assert.deepEqual(aapl.groups, [])

    // 已經在追蹤的從新增表單再加一次、選另一個清單：把清單加上去，持股不動（不記第二次買進）
    const again = await send2(base, '/api/market/watchlist', 'POST', {
      market: 'us',
      query: 'NVDA',
      group: shortTerm.id,
      trades: [{ side: 'buy', quantity: 1, price: 100 }],
    })
    assert.equal(again.status, 200)
    const againBody = await again.json()
    assert.equal(againBody.existing, true)
    assert.equal(againBody.tradesIgnored, true)
    assert.deepEqual(againBody.item.groups, [longTerm.id, shortTerm.id])
    assert.equal(MarketWatch.docs[0].trades.length, 0)
    assert.equal(MarketWatch.docs.length, 2)
    // 已經在選的清單裡、或沒選清單：照舊 409，並說在哪些清單
    const dup = await send2(base, '/api/market/watchlist', 'POST', { market: 'us', query: 'NVDA', group: shortTerm.id })
    assert.equal(dup.status, 409)
    assert.match((await dup.json()).message, /已經在「長期存股」、「短線」清單裡/)
    assert.equal((await send2(base, '/api/market/watchlist', 'POST', { market: 'us', query: 'NVDA' })).status, 409)
    // 還原成只在長期存股，後面的步驟照原本的假設
    assert.equal((await send2(base, `/api/market/watchlist/${MarketWatch.docs[0]._id}`, 'PATCH', { groups: [longTerm.id] })).status, 200)
    assert.ok(aapl.order > nvda.order)

    // 舊版前端換清單（送單一 group）：寫成 groups，舊欄位清成 null
    const moved = await send2(base, `/api/market/watchlist/${MarketWatch.docs[1]._id}`, 'PATCH', { group: shortTerm.id })
    assert.equal(moved.status, 200)
    assert.deepEqual(MarketWatch.docs[1].groups.map(String), [shortTerm.id])
    assert.equal(MarketWatch.docs[1].group, null)

    // 一檔放進兩個清單；重複的 id 去掉；有一個不是自己的清單就整個擋下；空陣列＝未分類
    const both = await send2(base, `/api/market/watchlist/${MarketWatch.docs[0]._id}`, 'PATCH', { groups: [longTerm.id, shortTerm.id, longTerm.id] })
    assert.deepEqual((await both.json()).item.groups, [longTerm.id, shortTerm.id])
    assert.equal((await send2(base, `/api/market/watchlist/${MarketWatch.docs[0]._id}`, 'PATCH', { groups: [longTerm.id, 'bbbbbbbbbbbbbbbbbbbbbbbb'] })).status, 400)
    assert.equal((await send2(base, `/api/market/watchlist/${MarketWatch.docs[0]._id}`, 'PATCH', { groups: 'nope' })).status, 400)

    // 改名與排序
    assert.equal((await (await send2(base, `/api/market/groups/${shortTerm.id}`, 'PATCH', { name: '短線觀察' })).json()).group.name, '短線觀察')
    // 改成和另一個清單同名擋下；改回自己原本的名字可以
    assert.equal((await send2(base, `/api/market/groups/${shortTerm.id}`, 'PATCH', { name: '長期存股' })).status, 409)
    assert.equal((await send2(base, `/api/market/groups/${shortTerm.id}`, 'PATCH', { name: '短線觀察' })).status, 200)
    const ordered = await (await send2(base, '/api/market/groups/order', 'PUT', { ids: [shortTerm.id, longTerm.id] })).json()
    assert.deepEqual(ordered.groups.map((g) => g.name), ['短線觀察', '長期存股'])

    // 股票排序
    assert.equal((await send2(base, '/api/market/watchlist/order', 'PUT', { ids: [MarketWatch.docs[1]._id, MarketWatch.docs[0]._id] })).status, 200)
    assert.equal(MarketWatch.docs[1].order, 1)
    assert.equal(MarketWatch.docs[0].order, 2)
    assert.equal((await send2(base, '/api/market/watchlist/order', 'PUT', { ids: ['nope'] })).status, 400)

    // 刪掉清單：只從各檔拿掉，NVDA 還留在短線觀察；只在被刪清單的舊格式資料變成未分類
    MarketWatch.docs.push({ _id: 'cccccccccccccccccccccccc', user: 'u1', key: 'TSM', target: { symbol: 'TSM', market: 'us', kind: 'stock', name: 'TSM' }, trades: [], group: longTerm.id, order: 9 })
    const afterDelete = await (await send2(base, `/api/market/groups/${longTerm.id}`, 'DELETE')).json()
    assert.deepEqual(afterDelete.groups.map((g) => g.name), ['短線觀察'])
    assert.deepEqual(MarketWatch.docs[0].groups.map(String), [shortTerm.id])
    assert.equal(MarketWatch.docs[2].group, null)

    const list = await (await fetch(`${base}/api/market/watchlist`)).json()
    assert.deepEqual(list.groups.map((g) => g.name), ['短線觀察'])
    // 舊格式（只有 group、沒有 groups）讀出來也是陣列
    MarketWatch.docs[2].group = shortTerm.id
    const legacy = (await (await fetch(`${base}/api/market/watchlist`)).json()).items.find((item) => item.target.symbol === 'TSM')
    assert.deepEqual(legacy.groups, [shortTerm.id])
  })
})
