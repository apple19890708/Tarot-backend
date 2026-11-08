const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { parseDashboard } = require('../src/services/market/dashboard')
const { createMarketRouter } = require('../src/routes/market')

test('股市總覽版面：整理區塊與卡片；顯示預設 true、卡片去重', () => {
  const { dashboard, error } = parseDashboard({
    blocks: [
      { type: 'highlights', options: { cards: ['^TWII', 'TPEX', '^TWII', 'watch:6560f0c2a1b2c3d4e5f60718'] } },
      { type: 'sectors', visible: false, options: { top: 12, junk: 1 } },
      { type: 'macro', options: { cards: ['nfp', 'cpi'] } },
      { type: 'institutional', options: { cards: ['x'] } },
      { type: 'watchGroup', options: { group: '6560f0c2a1b2c3d4e5f60718' } },
      { type: 'picks', visible: false, options: { pickType: 'dividend', view: 'table' } },
    ],
  })
  assert.equal(error, undefined)
  assert.equal(dashboard.version, 2)
  assert.deepEqual(dashboard.blocks[0], { type: 'highlights', visible: true, options: { cards: ['^TWII', 'TPEX', 'watch:6560f0c2a1b2c3d4e5f60718'] } })
  // 不認得的設定（junk、三大法人的 cards）不存
  assert.deepEqual(dashboard.blocks[1], { type: 'sectors', visible: false, options: { top: 12 } })
  assert.deepEqual(dashboard.blocks[3].options, {})
  assert.deepEqual(dashboard.blocks[4].options, { group: '6560f0c2a1b2c3d4e5f60718' })
  assert.equal(dashboard.blocks[5].visible, false)
  assert.deepEqual(dashboard.blocks[5].options, { pickType: 'dividend', view: 'table' })
  assert.deepEqual(parseDashboard(null), { dashboard: null })
})

test('股市總覽版面：不合格的整份擋下', () => {
  const bad = [
    undefined,
    {},
    { blocks: 'x' },
    { blocks: [{ type: 'nope' }] },
    { blocks: [{ type: 'macro' }, { type: 'macro' }] },
    { blocks: [{ type: 'macro', options: { cards: ['gdp'] } }] },
    { blocks: [{ type: 'breadth', options: { cards: 'tse' } }] },
    { blocks: [{ type: 'highlights', options: { cards: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] } }] },
    { blocks: [{ type: 'us', options: { cards: ['<script>'] } }] },
    { blocks: [{ type: 'sectors', options: { top: 0 } }] },
    // 卡片 0 張（整塊會消失、回不來）
    { blocks: [{ type: 'us', options: { cards: [] } }] },
    { blocks: [{ type: 'watchGroup', options: { group: 'not-an-id' } }] },
    { blocks: [{ type: 'picks', options: { pickType: 'meme' } }] },
    // 已經拿掉的區塊
    { blocks: [{ type: 'holdings' }] },
    { blocks: [{ type: 'picks', options: { view: 'grid' } }] },
    { blocks: [{ type: 'sectors', options: { top: 2.5 } }] },
    { blocks: Array.from({ length: 21 }, () => ({ type: 'macro' })) },
  ]
  for (const raw of bad) assert.ok(parseDashboard(raw).error, JSON.stringify(raw))
})

function fakeProfiles() {
  const docs = []
  return {
    docs,
    findOne: async (query) => docs.find((d) => d.user === query.user) || null,
    findOneAndUpdate: async (query, update) => {
      let doc = docs.find((d) => d.user === query.user)
      if (!doc) {
        doc = { user: query.user, fees: { twDiscount: 1, twMinFee: 20, usFee: 0 } }
        docs.push(doc)
      }
      Object.assign(doc, update.$set)
      return doc
    },
  }
}

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

test('PUT /dashboard：存進個人設定、GET /settings 讀得到；格式錯 400；null 恢復預設', async () => {
  const MarketProfile = fakeProfiles()
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
      marketService: {},
      MarketCall: {},
      MarketAlert: {},
      MarketWatch: {},
      MarketProfile,
    }),
  )
  await withServer(app, async (base) => {
    const put = (dashboard) =>
      fetch(`${base}/api/market/dashboard`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dashboard }) })
    // 沒自訂過
    assert.equal((await (await fetch(`${base}/api/market/settings`)).json()).dashboard, null)

    const saved = await put({ blocks: [{ type: 'sectors' }, { type: 'highlights', visible: false }] })
    assert.equal(saved.status, 200)
    const settings = await (await fetch(`${base}/api/market/settings`)).json()
    assert.deepEqual(settings.dashboard.blocks.map((b) => [b.type, b.visible]), [['sectors', true], ['highlights', false]])
    assert.ok(settings.fees)

    const bad = await put({ blocks: [{ type: 'nope' }] })
    assert.equal(bad.status, 400)
    // 擋下的不會蓋掉原本存的
    assert.equal(MarketProfile.docs[0].dashboard.blocks.length, 2)

    assert.equal((await put(null)).status, 200)
    assert.equal((await (await fetch(`${base}/api/market/settings`)).json()).dashboard, null)
  })
})

test('GET /index-chart：大盤清單的代號可以查；自己追蹤的個股可以查（重點卡）；別人的或沒追蹤的 404', async () => {
  const calls = []
  const marketService = {
    getIndexChart: async (symbol, range, options = {}) => {
      calls.push({ symbol, options })
      if (symbol === '^TWII') return { symbol, name: '加權指數', range }
      return options.name ? { symbol, name: options.name, range } : null
    },
  }
  const watches = [
    { user: 'u1', target: { symbol: '2330.TW', name: '台積電' } },
    { user: 'u2', target: { symbol: 'NVDA', name: 'NVIDIA' } },
  ]
  const MarketWatch = {
    findOne: async (query) => watches.find((w) => w.user === query.user && w.target.symbol === query['target.symbol']) || null,
  }
  const app = express()
  app.use(
    '/api/market',
    createMarketRouter({
      requireStockAccess: (req, _res, next) => {
        req.auth = { userId: 'u1' }
        next()
      },
      ensureDatabase: () => true,
      marketService,
      MarketCall: {},
      MarketAlert: {},
      MarketWatch,
    }),
  )
  await withServer(app, async (base) => {
    const get = (symbol) => fetch(`${base}/api/market/index-chart?symbol=${encodeURIComponent(symbol)}&range=1mo`)
    assert.equal((await (await get('^TWII')).json()).chart.name, '加權指數')
    assert.equal((await (await get('2330.TW')).json()).chart.name, '台積電')
    // 別人追蹤的、誰都沒追蹤的都不行
    assert.equal((await get('NVDA')).status, 404)
    assert.equal((await get('AAPL')).status, 404)
  })
})
