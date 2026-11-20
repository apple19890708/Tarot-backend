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
      if (key === '$or') return value.some((sub) => match(doc, sub))
      if (key === 'createdAt') return doc.createdAt >= value.$gte
      if (key === '_id' && value?.$in) return value.$in.some((id) => String(id) === String(doc._id))
      // 'target.code' 這種巢狀欄位
      const actual = key.split('.').reduce((v, k) => (v == null ? v : v[k]), doc)
      return String(actual) === String(value)
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

function makeApp({ watches, MarketAnalysisModel = fakeAnalysisModel(), role = 'member', aiAllowed = true, stream, JournalEntry = null } = {}) {
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
      JournalEntry,
      ensureDatabase: () => true,
      marketService: {
        buildTargetSnapshot: async () => SNAPSHOT,
        // 任何台股的分析（v19）：只認得 2330 與 2317
        resolveTarget: async (code) =>
          ({ 2330: TARGET, 2317: { symbol: '2317.TW', code: '2317', exchange: 'tse', market: 'tw', kind: 'stock', name: '鴻海' } })[code] || null,
        // 股票日記頁的最新股價：MU 故意查不到（報價失敗也要回 200）
        getQuote: async (target) => {
          if (target.symbol === 'MU') throw new Error('Yahoo 逾時')
          return { price: 1015, time: '2026-11-20T05:30:00Z' }
        },
      },
      MarketWatch: {
        findOne: async (filter) =>
          watches.find((w) =>
            filter._id !== undefined
              ? String(w._id) === String(filter._id) && w.user === filter.user
              : w.user === filter.user && w.target.market === filter['target.market'] && w.target.code === filter['target.code'],
          ) || null,
        // 股票日記：先用市場縮小範圍，再由 stockKeyOf 比對
        find: (filter) => query(() => watches.filter((w) => w.user === filter.user && w.target.market === filter['target.market'])),
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

test('股票分析紀錄：列表不含全文、單筆有全文與快照、只能刪自己的、超過上限刪最舊；刪分析不刪日記（日記屬於這檔股票）', async () => {
  const model = fakeAnalysisModel()
  const journalCalls = []
  const JournalEntry = { deleteMany: async (filter) => (journalCalls.push(filter), { deletedCount: 0 }) }
  const mine = []
  for (let i = 0; i < 3; i += 1) {
    mine.push(await model.create({ user: USER, watch: null, target: TARGET, text: `第 ${i + 1} 篇`, snapshot: SNAPSHOT }))
  }
  const others = await model.create({ user: OTHER, target: TARGET, text: '別人的' })
  const watch = makeWatch()
  await withServer(makeApp({ watches: [watch], MarketAnalysisModel: model, JournalEntry }).app, async (base) => {
    const list = await (await fetch(`${base}/api/market/analyses`)).json()
    assert.equal(list.analyses.length, 3)
    assert.equal(list.analyses[0].text, undefined)

    // ?stock=：只回這檔（股票日記頁的左欄）；別檔是空的；格式不對回 400
    assert.equal((await (await fetch(`${base}/api/market/analyses?stock=tw:2330`)).json()).analyses.length, 3)
    assert.equal((await (await fetch(`${base}/api/market/analyses?stock=tw:0050`)).json()).analyses.length, 0)
    assert.equal((await (await fetch(`${base}/api/market/analyses?stock=us:2330`)).json()).analyses.length, 0)
    assert.equal((await fetch(`${base}/api/market/analyses?stock=2330`)).status, 400)

    const detail = await (await fetch(`${base}/api/market/analyses/${mine[0]._id}`)).json()
    assert.equal(detail.analysis.text, '第 1 篇')
    assert.equal(detail.analysis.snapshot.items[0].code, '2330')

    assert.equal((await fetch(`${base}/api/market/analyses/${others._id}`)).status, 404)
    assert.equal((await fetch(`${base}/api/market/analyses/${others._id}`, { method: 'DELETE' })).status, 404)
    assert.equal((await fetch(`${base}/api/market/analyses/${mine[1]._id}`, { method: 'DELETE' })).status, 200)
    // 刪分析不刪日記：日記屬於這檔股票（v26 計畫 2-2）
    assert.deepEqual(journalCalls, [])

    // 上限 3 筆（測試用）：目前 2 筆，再跑兩次 AI 後只留最新 3 筆
    const response = await fetch(`${base}/api/market/watchlist/${watch._id}/analysis/ai`, { method: 'POST' })
    await response.text()
  })
  await model.create({ user: USER, target: TARGET, text: '第 5 篇' })
  const watch2 = makeWatch()
  journalCalls.length = 0
  await withServer(makeApp({ watches: [watch2], MarketAnalysisModel: model, JournalEntry }).app, async (base) => {
    await (await fetch(`${base}/api/market/watchlist/${watch2._id}/analysis/ai`, { method: 'POST' })).text()
  })
  const left = model.docs.filter((d) => String(d.user) === USER)
  assert.equal(left.length, 3)
  assert.ok(!left.some((d) => d.text === '第 1 篇'))
  // 超過上限汰除最舊的分析：日記照樣不動
  assert.deepEqual(journalCalls, [])
})

test('AI 分析的提示：附上行情、持股、事件與重大訊息，並要求只用資料裡的數字', () => {
  const message = buildStockAnalysisMessage({
    snapshot: SNAPSHOT,
    holding: { market: 'tw', quantity: 2, avgCost: 900, costBasis: 1800000, marketValue: 2000000, unrealized: 190000, unrealizedPct: 10.5, realized: 0, dividends: 0, totalReturn: 190000 },
    news: [{ date: '2026-11-04', title: '公告董事會決議', detail: '說明' }],
    now: new Date('2026-11-06T07:30:00.000Z'),
  })
  assert.match(message, /^現在時間：2026\/11\/06（週五）15:30 台北時間/, '附上現在時間與星期')
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

test('任何台股的個股分析：沒追蹤的沒有持股、watchId 是 null；有追蹤的自動用追蹤項目；查不到的 404', async () => {
  const watch = makeWatch(USER, { trades: [{ side: 'buy', quantity: 2, price: 900, date: '2026-10-01' }] })
  const { app, MarketAnalysisModel } = makeApp({ watches: [watch] })
  await withServer(app, async (base) => {
    // 2317 沒追蹤
    const plain = (await (await fetch(`${base}/api/market/stock/2317/analysis`)).json()).analysis
    assert.equal(plain.holding, null)
    assert.equal(plain.watchId, null)
    // 2330 有追蹤：看得到持股
    const tracked = (await (await fetch(`${base}/api/market/stock/2330/analysis`)).json()).analysis
    assert.equal(tracked.holding.quantity, 2)
    assert.equal(tracked.watchId, String(watch._id))
    assert.equal((await fetch(`${base}/api/market/stock/9999/analysis`)).status, 404)
    assert.equal((await fetch(`${base}/api/market/stock/abc/analysis`)).status, 404)

    // 沒追蹤的 AI 分析：存的紀錄 watch 是 null、target 是那檔；冷卻照代號算
    const ai = await fetch(`${base}/api/market/stock/2317/analysis/ai`, { method: 'POST' })
    assert.equal(ai.status, 200)
    await readEvents(ai)
    assert.equal(MarketAnalysisModel.docs.length, 1)
    assert.equal(MarketAnalysisModel.docs[0].watch, null)
    assert.equal(MarketAnalysisModel.docs[0].target.code, '2317')
    assert.equal((await fetch(`${base}/api/market/stock/2317/analysis/ai`, { method: 'POST' })).status, 429)
    const again = (await (await fetch(`${base}/api/market/stock/2317/analysis`)).json()).analysis
    assert.equal(again.latest.text, '## 現況\n偏多。')
  })
})

test('個股 AI 提示詞：方向照抄操作建議（觀望不能寫成偏空）、回測照資料的結論、不用 5 個百分點重判（2026-11-19）', () => {
  assert.match(STOCK_ANALYSIS_PROMPT, /照抄操作建議的方向/)
  assert.match(STOCK_ANALYSIS_PROMPT, /操作建議是觀望時就寫觀望/)
  assert.match(STOCK_ANALYSIS_PROMPT, /照資料裡每個訊號的「結論」寫/)
  assert.doesNotMatch(STOCK_ANALYSIS_PROMPT, /差距不到 5 個百分點/)
})

test('股票日記頁：回這檔的名稱與最新股價；報價失敗回 null；沒分析也沒追蹤回 404（v26 計畫 2-2）', async () => {
  const model = fakeAnalysisModel()
  await model.create({ user: USER, watch: null, target: { symbol: 'MU', code: null, exchange: null, market: 'us', kind: 'stock', name: 'Micron' }, text: 'x' })
  const watch = makeWatch()
  await withServer(makeApp({ watches: [watch], MarketAnalysisModel: model }).app, async (base) => {
    // 追蹤中的台積電：用追蹤項目的 target、查到股價
    const tracked = await (await fetch(`${base}/api/market/stock-journal?stock=tw:2330`)).json()
    assert.equal(tracked.stock.key, 'tw:2330')
    assert.equal(tracked.stock.target.name, '台積電')
    assert.equal(tracked.stock.tracked, true)
    assert.deepEqual(tracked.stock.quote, { price: 1015, time: '2026-11-20T05:30:00.000Z' })
    // 只分析過、沒追蹤：用分析的 target；報價失敗照樣 200
    const analysed = await (await fetch(`${base}/api/market/stock-journal?stock=us:mu`)).json()
    assert.equal(analysed.stock.target.name, 'Micron')
    assert.equal(analysed.stock.tracked, false)
    assert.equal(analysed.stock.quote, null)
    assert.equal((await fetch(`${base}/api/market/stock-journal?stock=tw:0050`)).status, 404)
    assert.equal((await fetch(`${base}/api/market/stock-journal?stock=0050`)).status, 400)
    assert.equal((await fetch(`${base}/api/market/stock-journal`)).status, 400)
    // 別名 tw:2330.TW 對不到（不能另開一本，api-reviewer 2026-11-20）
    assert.equal((await fetch(`${base}/api/market/stock-journal?stock=tw:2330.TW`)).status, 404)
  })
})

test('股票鍵用真實的指數資料：加權指數 code t00＋^TWII、櫃買指數 o00 沒有 symbol（api-reviewer 2026-11-20）', async () => {
  const model = fakeAnalysisModel()
  await model.create({ user: USER, watch: null, target: { symbol: '^TWII', code: 't00', exchange: null, market: 'tw', kind: 'index', name: '加權指數' }, text: 'x' })
  const otc = makeWatch(USER, { target: { symbol: null, code: 'o00', exchange: 'otc', market: 'tw', kind: 'index', name: '櫃買指數' } })
  await withServer(makeApp({ watches: [otc], MarketAnalysisModel: model }).app, async (base) => {
    const list = await (await fetch(`${base}/api/market/analyses`)).json()
    assert.equal(list.analyses[0].stockKey, 'tw:^TWII')
    const taiex = await (await fetch(`${base}/api/market/stock-journal?stock=tw:%5ETWII`)).json()
    assert.equal(taiex.stock.key, 'tw:^TWII')
    assert.equal((await (await fetch(`${base}/api/market/analyses?stock=tw:%5ETWII`)).json()).analyses.length, 1)
    // 用代號 t00 不算同一本
    assert.equal((await fetch(`${base}/api/market/stock-journal?stock=tw:t00`)).status, 404)
    const tpex = await (await fetch(`${base}/api/market/stock-journal?stock=tw:o00`)).json()
    assert.equal(tpex.stock.key, 'tw:O00')
    assert.equal(tpex.stock.tracked, true)
  })
})
