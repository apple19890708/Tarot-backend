const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const mongoose = require('mongoose')

const MarketAnalysis = require('../src/models/MarketAnalysis')
const { createMarketAnalysisRouter, DAILY_LIMIT, startOfTaipeiDay } = require('../src/routes/marketAnalysis')
const { buildStockAnalysisMessage, STOCK_ANALYSIS_PROMPT } = require('../src/services/market/stockAnalysis')

const USER = new mongoose.Types.ObjectId().toString()
const OTHER = new mongoose.Types.ObjectId().toString()
const TARGET = { symbol: '2330.TW', code: '2330', exchange: 'tse', market: 'tw', kind: 'stock', name: '台積電' }

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    const { port } = server.address()
    await run(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

// 查詢鏈：find / findOne 回傳可以 sort、skip、select 的物件，await 時才真的過濾
function query(run) {
  const state = { sort: null, skip: 0 }
  const q = {
    sort(spec) {
      state.sort = spec
      return q
    },
    skip(n) {
      state.skip = n
      return q
    },
    select() {
      return q
    },
    then(resolve, reject) {
      return Promise.resolve(run(state)).then(resolve, reject)
    },
  }
  return q
}

// 用真的 mongoose document（不連資料庫）存在記憶體，方法（toSummaryJSON）照常可用
function fakeAnalysisModel() {
  const docs = []
  const match = (doc, filter) =>
    Object.entries(filter).every(([key, value]) => {
      if (key === 'createdAt') return doc.createdAt >= value.$gte
      if (key === '_id' && value?.$in) return value.$in.some((id) => String(id) === String(doc._id))
      return String(doc[key]) === String(value)
    })
  const sorted = (list) => [...list].sort((a, b) => b.createdAt - a.createdAt || String(b._id).localeCompare(String(a._id)))
  return {
    docs,
    MAX_ANALYSES_PER_USER: 3,
    countDocuments: async (filter) => docs.filter((d) => match(d, filter)).length,
    find: (filter) => query((state) => sorted(docs.filter((d) => match(d, filter))).slice(state.skip)),
    findOne: (filter) => query(() => sorted(docs.filter((d) => match(d, filter)))[0] || null),
    create: async (data) => {
      const doc = new MarketAnalysis(data)
      doc.createdAt = new Date(Date.now() + docs.length)
      docs.push(doc)
      return doc
    },
    deleteOne: async (filter) => {
      const index = docs.findIndex((d) => match(d, filter))
      if (index >= 0) docs.splice(index, 1)
      return { deletedCount: index >= 0 ? 1 : 0 }
    },
    deleteMany: async (filter) => {
      for (let i = docs.length - 1; i >= 0; i -= 1) if (match(docs[i], filter)) docs.splice(i, 1)
    },
  }
}

function makeWatch(user = USER, extra = {}) {
  return { _id: new mongoose.Types.ObjectId(), user, target: TARGET, trades: [], dividends: [], ...extra }
}

const SNAPSHOT = {
  asOf: '2026-11-05T06:00:00.000Z',
  items: [
    {
      symbol: '2330.TW',
      code: '2330',
      name: '台積電',
      market: 'tw',
      kind: 'stock',
      currency: 'TWD',
      session: 'closed',
      quote: { price: 1000, prevClose: 990, change: 10, changePct: 1.01, open: 990, high: 1005, low: 985, date: '2026-11-05' },
      indicators: null,
      analysis: null,
    },
  ],
  notes: [],
  events: { exDividend: null, revenue: { month: '2026-10', revenue: 300000000, mom: 5, yoy: 30, cumYoy: 35, note: '' } },
}

function makeApp({ watches, MarketAnalysisModel = fakeAnalysisModel(), role = 'member', aiAllowed = true, stream } = {}) {
  const app = express()
  app.use(express.json())
  const auth = (req, _res, next) => {
    req.auth = { userId: USER, role }
    next()
  }
  app.use(
    '/api/market',
    createMarketAnalysisRouter({
      requireStockAccess: auth,
      requireAiAccess: (req, res, next) => (aiAllowed ? auth(req, res, next) : res.status(403).json({ message: 'AI 解讀需要管理者開通，請聯絡管理者。' })),
      ensureDatabase: () => true,
      marketService: { buildTargetSnapshot: async () => SNAPSHOT },
      MarketWatch: {
        findOne: async (filter) => watches.find((w) => String(w._id) === String(filter._id) && w.user === filter.user) || null,
      },
      MarketAnalysis: MarketAnalysisModel,
      ai: {
        isAvailable: () => true,
        stream:
          stream ||
          (async ({ onStart, onDelta }) => {
            onStart()
            onDelta('## 現況\n')
            onDelta('偏多。')
            return { model: 'test-model' }
          }),
      },
    }),
  )
  return { app, MarketAnalysisModel }
}

const readEvents = async (response) =>
  (await response.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))

test('個股分析：回傳快照、持股與額度；別人的追蹤項目回 404', async () => {
  const watch = makeWatch(USER, { trades: [{ side: 'buy', quantity: 1, price: 900, date: '2026-10-01' }] })
  const others = makeWatch(OTHER)
  const { app } = makeApp({ watches: [watch, others] })
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/market/watchlist/${watch._id}/analysis`)
    assert.equal(response.status, 200)
    const { analysis } = await response.json()
    assert.equal(analysis.item.code, '2330')
    assert.equal(analysis.holding.quantity, 1)
    assert.equal(analysis.events.revenue.yoy, 30)
    assert.deepEqual(analysis.quota, { dailyLimit: DAILY_LIMIT, usedToday: 0, retryAt: null })
    assert.equal(analysis.latest, null)

    assert.equal((await fetch(`${base}/api/market/watchlist/${others._id}/analysis`)).status, 404)
    assert.equal((await fetch(`${base}/api/market/watchlist/not-an-id/analysis`)).status, 404)
  })
})

test('AI 分析：串流完成後存一筆紀錄，再按一次在冷卻中回 429', async () => {
  const watch = makeWatch()
  const { app, MarketAnalysisModel } = makeApp({ watches: [watch] })
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/market/watchlist/${watch._id}/analysis/ai`, { method: 'POST' })
    assert.equal(response.status, 200)
    const events = await readEvents(response)
    assert.equal(events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), '## 現況\n偏多。')
    const done = events.find((e) => e.type === 'done')
    assert.equal(done.analysis.target.code, '2330')
    assert.equal(done.analysis.quote.price, 1000)

    const again = await fetch(`${base}/api/market/watchlist/${watch._id}/analysis/ai`, { method: 'POST' })
    assert.equal(again.status, 429)
    assert.ok((await again.json()).retryAt)

    // 重新打開彈窗：帶出最近一次的結果
    const { analysis } = await (await fetch(`${base}/api/market/watchlist/${watch._id}/analysis`)).json()
    assert.equal(analysis.latest.text, '## 現況\n偏多。')
    assert.equal(analysis.quota.usedToday, 1)
  })
  assert.equal(MarketAnalysisModel.docs.length, 1)
  assert.equal(MarketAnalysisModel.docs[0].snapshot.items[0].code, '2330')
})

test('AI 分析：沒有 AI 權限回 403，訊息照後端給的', async () => {
  const watch = makeWatch()
  const { app } = makeApp({ watches: [watch], aiAllowed: false })
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/market/watchlist/${watch._id}/analysis/ai`, { method: 'POST' })
    assert.equal(response.status, 403)
    assert.match((await response.json()).message, /管理者開通/)
  })
})

test('AI 分析：每日上限用完回 429；admin 不受每日上限限制', async () => {
  const watches = Array.from({ length: 2 }, () => makeWatch())
  const model = fakeAnalysisModel()
  for (let i = 0; i < DAILY_LIMIT; i += 1) {
    await model.create({ user: USER, watch: new mongoose.Types.ObjectId(), target: TARGET, text: 'x' })
  }
  model.MAX_ANALYSES_PER_USER = 100
  await withServer(makeApp({ watches, MarketAnalysisModel: model }).app, async (base) => {
    const response = await fetch(`${base}/api/market/watchlist/${watches[0]._id}/analysis/ai`, { method: 'POST' })
    assert.equal(response.status, 429)
    assert.match((await response.json()).message, /今天的 AI 分析已用完/)
  })
  await withServer(makeApp({ watches, MarketAnalysisModel: model, role: 'admin' }).app, async (base) => {
    const response = await fetch(`${base}/api/market/watchlist/${watches[1]._id}/analysis/ai`, { method: 'POST' })
    assert.equal(response.status, 200)
    await response.text()
  })
})

test('AI 分析：服務還沒開始產生就失敗，不算冷卻、不存紀錄', async () => {
  const watch = makeWatch()
  let calls = 0
  const stream = async ({ onStart, onDelta }) => {
    calls += 1
    if (calls === 1) throw new Error('OpenRouter 500')
    onStart()
    onDelta('ok')
    return { model: 'm' }
  }
  const { app, MarketAnalysisModel } = makeApp({ watches: [watch], stream })
  app.use((_error, _req, res, _next) => res.status(500).json({ message: '伺服器錯誤' }))
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/market/watchlist/${watch._id}/analysis/ai`, { method: 'POST' })).status, 500)
    assert.equal(MarketAnalysisModel.docs.length, 0)
    const retry = await fetch(`${base}/api/market/watchlist/${watch._id}/analysis/ai`, { method: 'POST' })
    assert.equal(retry.status, 200)
    await retry.text()
  })
  assert.equal(MarketAnalysisModel.docs.length, 1)
})

test('股票分析紀錄：列表不含全文、單筆有全文與快照、只能刪自己的、超過上限刪最舊', async () => {
  const model = fakeAnalysisModel()
  const mine = []
  for (let i = 0; i < 3; i += 1) {
    mine.push(await model.create({ user: USER, watch: null, target: TARGET, text: `第 ${i + 1} 篇`, snapshot: SNAPSHOT }))
  }
  const others = await model.create({ user: OTHER, target: TARGET, text: '別人的' })
  const watch = makeWatch()
  await withServer(makeApp({ watches: [watch], MarketAnalysisModel: model }).app, async (base) => {
    const list = await (await fetch(`${base}/api/market/analyses`)).json()
    assert.equal(list.analyses.length, 3)
    assert.equal(list.analyses[0].text, undefined)

    const detail = await (await fetch(`${base}/api/market/analyses/${mine[0]._id}`)).json()
    assert.equal(detail.analysis.text, '第 1 篇')
    assert.equal(detail.analysis.snapshot.items[0].code, '2330')

    assert.equal((await fetch(`${base}/api/market/analyses/${others._id}`)).status, 404)
    assert.equal((await fetch(`${base}/api/market/analyses/${others._id}`, { method: 'DELETE' })).status, 404)
    assert.equal((await fetch(`${base}/api/market/analyses/${mine[1]._id}`, { method: 'DELETE' })).status, 200)

    // 上限 3 筆（測試用）：目前 2 筆，再跑兩次 AI 後只留最新 3 筆
    const response = await fetch(`${base}/api/market/watchlist/${watch._id}/analysis/ai`, { method: 'POST' })
    await response.text()
  })
  await model.create({ user: USER, target: TARGET, text: '第 5 篇' })
  const watch2 = makeWatch()
  await withServer(makeApp({ watches: [watch2], MarketAnalysisModel: model }).app, async (base) => {
    await (await fetch(`${base}/api/market/watchlist/${watch2._id}/analysis/ai`, { method: 'POST' })).text()
  })
  const left = model.docs.filter((d) => String(d.user) === USER)
  assert.equal(left.length, 3)
  assert.ok(!left.some((d) => d.text === '第 1 篇'))
})

test('AI 分析的提示：附上行情、持股、事件與重大訊息，並要求只用資料裡的數字', () => {
  const message = buildStockAnalysisMessage({
    snapshot: SNAPSHOT,
    holding: { market: 'tw', quantity: 2, avgCost: 900, costBasis: 1800000, marketValue: 2000000, unrealized: 190000, unrealizedPct: 10.5, realized: 0, dividends: 0, totalReturn: 190000 },
    news: [{ date: '2026-11-04', title: '公告董事會決議', detail: '說明' }],
  })
  assert.match(message, /<market_data>[\s\S]*台積電（2330）/)
  assert.match(message, /<holding>[\s\S]*持有 2 張，平均成本 900/)
  assert.match(message, /<events>[\s\S]*年增 30%/)
  assert.match(message, /<news>[\s\S]*公告董事會決議/)
  assert.match(STOCK_ANALYSIS_PROMPT, /只能用資料裡有的/)
  assert.match(STOCK_ANALYSIS_PROMPT, /不是投資建議/)

  const bare = buildStockAnalysisMessage({ snapshot: { ...SNAPSHOT, events: null } })
  assert.ok(!bare.includes('<holding>'))
  assert.ok(!bare.includes('<news>'))
})

test('每日次數以台北時間的一天計算', () => {
  // 台北 11/05 07:00 = UTC 11/04 23:00
  assert.equal(startOfTaipeiDay(Date.parse('2026-11-04T23:00:00Z')).toISOString(), '2026-11-04T16:00:00.000Z')
})
