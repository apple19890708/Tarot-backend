// 占卜日記（v26 計畫 2）：內容白名單、權限（只動得到自己的）、對象要是自己的紀錄或抽過的那天
const test = require('node:test')
const assert = require('node:assert')
const express = require('express')

const { validateJournalContent, summaryOf } = require('../src/services/journalContent')
const { createJournalRouter, parseTarget } = require('../src/routes/journal')
const { stockKeyOf, parseStockFields, migrateStockJournalTargets } = require('../src/services/stockJournal')
const { USER_DATA_MODELS } = require('../src/services/accountDeletion')

const OWNER = '507f1f77bcf86cd799439011'
const OTHER = '507f1f77bcf86cd799439022'
const READING_ID = '507f1f77bcf86cd799439033'
const ANALYSIS_ID = '507f1f77bcf86cd799439044'

const doc = (...content) => ({ type: 'doc', content })
const p = (text, marks) => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks } : {}) }] })

// ---- 內容驗證 ----

test('內容：編輯器會產生的節點都收，摘要是純文字', () => {
  const content = doc(
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '後來' }] },
    p('他真的', [{ type: 'bold' }, { type: 'highlight' }]),
    { type: 'bulletList', content: [{ type: 'listItem', content: [p('第一點')] }] },
    { type: 'orderedList', attrs: { start: 1, type: null }, content: [{ type: 'listItem', content: [p('第二點')] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [p('問清楚')] }] },
    { type: 'blockquote', content: [p('引用')] },
    { type: 'horizontalRule' },
    { type: 'paragraph' },
  )
  const result = validateJournalContent(content)
  assert.strictEqual(result.error, undefined)
  assert.strictEqual(result.text, '後來\n他真的\n第一點\n第二點\n問清楚\n引用')
  assert.strictEqual(summaryOf(result.text), '後來 他真的 第一點 第二點 問清楚 引用')
})

test('內容：不在白名單的節點、標記、屬性一律拒絕', () => {
  const bad = [
    null,
    'text',
    { type: 'paragraph' },
    doc({ type: 'image', attrs: { src: 'https://evil.example/x.png' } }),
    doc({ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }),
    doc(p('連結', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])),
    doc(p('x', [{ type: 'bold', attrs: { style: 'x' } }])),
    doc({ type: 'heading', attrs: { level: 7 }, content: [{ type: 'text', text: 'x' }] }),
    doc({ type: 'paragraph', attrs: { onclick: 'x' } }),
    doc({ type: 'paragraph', html: '<b>x</b>' }),
    doc({ type: 'paragraph', content: [{ type: 'text', text: '' }] }),
    doc({ type: 'taskItem', attrs: { checked: 'yes' } }),
  ]
  for (const content of bad) assert.ok(validateJournalContent(content).error, JSON.stringify(content))
})

test('內容：原型鏈名稱（constructor、__proto__、toString）不能混進白名單（api-reviewer）', () => {
  const bad = [
    doc({ type: 'paragraph', attrs: { constructor: { $where: 'x', 'a.b': { deep: 1 } } } }),
    doc({ type: 'constructor', attrs: { keys: {} } }),
    doc({ type: 'toString' }),
    JSON.parse('{"type":"doc","content":[{"type":"paragraph","attrs":{"__proto__":1}}]}'),
    JSON.parse('{"type":"doc","content":[{"type":"__proto__"}]}'),
  ]
  for (const content of bad) assert.ok(validateJournalContent(content).error, JSON.stringify(content))
})

test('內容：結構不對也拒絕（doc 只在最上層、清單裡只放清單項目、葉節點沒有子節點）', () => {
  const bad = [
    doc({ type: 'text', text: 'x' }, { type: 'doc', content: [] }),
    doc({ type: 'listItem', content: [p('x')] }),
    doc({ type: 'bulletList', content: [p('x')] }),
    doc({ type: 'taskList', content: [{ type: 'listItem', content: [p('x')] }] }),
    doc({ type: 'bulletList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [p('x')] }] }),
    doc({ type: 'horizontalRule', content: [p('x')] }),
    doc({ type: 'paragraph', content: [{ type: 'hardBreak', content: [] }] }),
  ]
  for (const content of bad) assert.ok(validateJournalContent(content).error, JSON.stringify(content))
  // 巢狀清單是可以的
  const nested = doc({ type: 'bulletList', content: [{ type: 'listItem', content: [p('a'), { type: 'bulletList', content: [{ type: 'listItem', content: [p('b')] }] }] }] })
  assert.strictEqual(validateJournalContent(nested).error, undefined)
})

test('內容：超過 50KB 或層次太深都拒絕', () => {
  assert.match(validateJournalContent(doc(p('字'.repeat(20000)))).error, /50KB/)
  let deep = p('x')
  for (let i = 0; i < 25; i += 1) deep = { type: 'blockquote', content: [deep] }
  assert.match(validateJournalContent(doc(deep)).error, /太深/)
})

test('對象格式：reading:<ObjectId> 或 stock:<市場>:<代號>；每日一牌（daily）與舊的 stock:<分析 id> 已經不收', () => {
  assert.deepStrictEqual(parseTarget(`reading:${READING_ID}`), { kind: 'reading', id: READING_ID })
  assert.strictEqual(parseTarget('daily:2026-11-20'), null)
  assert.strictEqual(parseTarget('stock:tw:0050').id, 'tw:0050')
  assert.strictEqual(parseTarget('stock:us:nvda').id, 'us:NVDA')
  assert.strictEqual(parseTarget('stock:tw:^TWII').id, 'tw:^TWII')
  assert.strictEqual(parseTarget('stock:TW:00679b').id, 'tw:00679B')
  const bad = [undefined, '', 'reading:', 'reading:abc', 'daily:2026/11/20', 'stock:2330', `stock:${ANALYSIS_ID}`, `reading:${READING_ID}:x`,
    'stock:jp:7203', 'stock:tw:', 'stock:tw:a b', 'stock:tw:<script>', 'stock:tw:12345678901234567', { $ne: 1 }]
  for (const value of bad) assert.strictEqual(parseTarget(value), null, String(value))
})

test('股票鍵：台股用代號、美股與指數用 symbol；和分析紀錄的 target 對得上', () => {
  assert.strictEqual(stockKeyOf({ market: 'tw', code: '0050', symbol: '0050.TW' }), 'tw:0050')
  assert.strictEqual(stockKeyOf({ market: 'us', code: null, symbol: 'nvda' }), 'us:NVDA')
  assert.strictEqual(stockKeyOf({ market: 'tw', code: null, symbol: '^TWII' }), 'tw:^TWII')
  // 真實的指數資料：加權 code 't00'＋symbol '^TWII'，櫃買 'o00' 沒有 symbol
  assert.strictEqual(stockKeyOf({ market: 'tw', kind: 'index', code: 't00', symbol: '^TWII' }), 'tw:^TWII')
  assert.strictEqual(stockKeyOf({ market: 'tw', kind: 'index', code: 'o00', symbol: null }), 'tw:O00')
  assert.strictEqual(stockKeyOf({ market: 'jp', symbol: '7203' }), null)
  assert.strictEqual(stockKeyOf(null), null)
})

test('記錄股票的欄位：可選填、數值要大於 0、動作與單位只收清單裡的', () => {
  assert.deepStrictEqual(parseStockFields(undefined), { value: undefined })
  assert.deepStrictEqual(parseStockFields(null), { value: null })
  // 全部沒填＝沒有
  assert.deepStrictEqual(parseStockFields({ action: null, price: '' }), { value: null })
  const ok = parseStockFields({ action: 'buy', price: 152.35, quantity: 2, unit: 'lot', quoteAtWrite: 150, quoteDate: '2026-11-20', targetPrice: 180, stopPrice: 140 })
  assert.deepStrictEqual(ok.value, { action: 'buy', unit: 'lot', quoteDate: '2026-11-20', price: 152.35, quantity: 2, quoteAtWrite: 150, targetPrice: 180, stopPrice: 140 })
  for (const bad of [{ action: 'short' }, { unit: 'kg' }, { price: -1 }, { price: '100' }, { price: 0 }, { quantity: Infinity },
    { targetPrice: 1e9 }, { quoteDate: '20261120' }, { extra: 1 }, [], 'buy', { action: { $ne: null } },
    // 四捨五入到小數 4 位後是 0 的也不收（api-reviewer）
    { price: 0.00001 }, { quantity: 0.00004 }]) {
    assert.ok(parseStockFields(bad).error, JSON.stringify(bad))
  }
})

test('刪除帳號時日記一起刪', () => {
  assert.ok(USER_DATA_MODELS.includes('JournalEntry'))
})

// ---- API（假資料庫）----

function query(result) {
  const q = { sort: () => q, limit: () => q, select: () => q, lean: () => Promise.resolve(result), then: (ok, bad) => Promise.resolve(result).then(ok, bad) }
  return q
}

let nextId = 1
function fakeModels({ entries = [] } = {}) {
  const rows = [...entries]
  const match = (row, filter) => Object.entries(filter).every(([key, value]) => String(row[key]) === String(value))
  const JournalEntry = {
    rows,
    find: (filter) => query(rows.filter((row) => match(row, filter)).sort((a, b) => a.entryDate.localeCompare(b.entryDate))),
    findOne: (filter) => {
      const row = rows.find((r) => match(r, filter))
      if (!row) return Promise.resolve(null)
      return Promise.resolve(Object.assign(row, { markModified() {}, async save() { row.updatedAt = new Date() } }))
    },
    countDocuments: async (filter) => rows.filter((row) => match(row, filter)).length,
    create: async (data) => {
      const row = { _id: `5f0000000000000000000${String(nextId++).padStart(3, '0')}`, createdAt: new Date(), updatedAt: new Date(), ...data }
      rows.push(row)
      return row
    },
    deleteOne: async (filter) => {
      const index = rows.findIndex((row) => match(row, filter))
      if (index < 0) return { deletedCount: 0 }
      rows.splice(index, 1)
      return { deletedCount: 1 }
    },
  }
  const Reading = { findOne: (filter) => query(filter._id === READING_ID && String(filter.user) === OWNER ? { _id: READING_ID } : null) }
  const DailyCard = { findOne: (filter) => query(filter.date === '2026-11-19' && String(filter.user) === OWNER ? { _id: 'd1' } : null) }
  // OWNER 分析過台積電與加權指數（真實資料：code t00、symbol ^TWII），追蹤 NVDA 與櫃買指數（o00，沒有 symbol）
  const analyses = [
    { user: OWNER, target: { market: 'tw', kind: 'stock', code: '2330', symbol: '2330.TW' } },
    { user: OWNER, target: { market: 'tw', kind: 'index', code: 't00', symbol: '^TWII' } },
  ]
  const watches = [
    { user: OWNER, target: { market: 'us', kind: 'stock', code: null, symbol: 'NVDA' } },
    { user: OWNER, target: { market: 'tw', kind: 'index', code: 'o00', symbol: null } },
  ]
  const byMarket = (rows) => (filter) => query(rows.filter((r) => r.user === String(filter.user) && r.target.market === filter['target.market']))
  const MarketAnalysis = { find: byMarket(analyses) }
  const MarketWatch = { find: byMarket(watches) }
  return { JournalEntry, Reading, DailyCard, MarketAnalysis, MarketWatch }
}

function appWith(models) {
  const app = express()
  app.use(express.json())
  const requireAuth = (req, res, next) => {
    const user = req.get('x-user')
    if (!user) return res.status(401).json({ message: '請先登入。' })
    req.auth = { userId: user }
    next()
  }
  app.use('/api', createJournalRouter({ ensureDatabase: () => true, requireAuth, ...models, now: () => new Date('2026-11-20T02:00:00Z') }))
  return app
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

const json = (user, body, method = 'POST') => ({ method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: JSON.stringify(body) })

test('新增、列出、修改、刪除自己的日記', async () => {
  const models = fakeModels()
  await withServer(appWith(models), async (base) => {
    const created = await fetch(`${base}/api/journal`, json(OWNER, { target: `reading:${READING_ID}`, content: doc(p('他回訊息了')) }))
    assert.strictEqual(created.status, 201)
    const { entry } = await created.json()
    assert.strictEqual(entry.target, `reading:${READING_ID}`)
    assert.strictEqual(entry.text, '他回訊息了')
    assert.strictEqual(entry.outcome, null)
    // 沒帶日期就是台北的今天
    assert.strictEqual(entry.entryDate, '2026-11-20')

    const list = await (await fetch(`${base}/api/journal?target=reading:${READING_ID}`, { headers: { 'x-user': OWNER } })).json()
    assert.deepStrictEqual(list.entries.map((e) => e.id), [entry.id])

    const updated = await fetch(`${base}/api/journal/${entry.id}`, json(OWNER, { outcome: 'hit', entryDate: '2026-11-19' }, 'PUT'))
    assert.strictEqual(updated.status, 200)
    const after = (await updated.json()).entry
    assert.strictEqual(after.outcome, 'hit')
    assert.strictEqual(after.entryDate, '2026-11-19')
    assert.strictEqual(after.text, '他回訊息了')

    // 改回「還不知道」
    assert.strictEqual((await (await fetch(`${base}/api/journal/${entry.id}`, json(OWNER, { outcome: null }, 'PUT'))).json()).entry.outcome, null)

    const removed = await fetch(`${base}/api/journal/${entry.id}`, { method: 'DELETE', headers: { 'x-user': OWNER } })
    assert.strictEqual(removed.status, 200)
    assert.strictEqual(models.JournalEntry.rows.length, 0)
  })
})

test('別人的紀錄、別人的日記：當成不存在；沒登入 401', async () => {
  const models = fakeModels({
    entries: [{ _id: '5f00000000000000000000aa', user: OWNER, targetKind: 'reading', targetId: READING_ID, content: doc(p('我的')), text: '我的', outcome: null, entryDate: '2026-11-19', createdAt: new Date(), updatedAt: new Date() }],
  })
  await withServer(appWith(models), async (base) => {
    // 寫在別人的紀錄底下
    assert.strictEqual((await fetch(`${base}/api/journal`, json(OTHER, { target: `reading:${READING_ID}`, content: doc(p('x')) }))).status, 404)
    // 每日一牌的日記已經拿掉：回 400
    assert.strictEqual((await fetch(`${base}/api/journal`, json(OWNER, { target: 'daily:2026-11-19', content: doc(p('x')) }))).status, 400)
    // 別人看不到、改不了、刪不掉
    const others = await (await fetch(`${base}/api/journal?target=reading:${READING_ID}`, { headers: { 'x-user': OTHER } })).json()
    assert.deepStrictEqual(others.entries, [])
    assert.strictEqual((await fetch(`${base}/api/journal/5f00000000000000000000aa`, json(OTHER, { outcome: 'miss' }, 'PUT'))).status, 404)
    assert.strictEqual((await fetch(`${base}/api/journal/5f00000000000000000000aa`, { method: 'DELETE', headers: { 'x-user': OTHER } })).status, 404)
    assert.strictEqual(models.JournalEntry.rows[0].outcome, null)
    assert.strictEqual((await fetch(`${base}/api/journal?target=reading:${READING_ID}`)).status, 401)
  })
})

test('輸入檢查：空的、未來日期、不認得的結果標記、壞掉的內容都回 400', async () => {
  await withServer(appWith(fakeModels()), async (base) => {
    const post = (body) => fetch(`${base}/api/journal`, json(OWNER, { target: `reading:${READING_ID}`, ...body }))
    assert.strictEqual((await post({ content: doc({ type: 'paragraph' }) })).status, 400)
    assert.strictEqual((await post({ content: doc(p('x')), entryDate: '2026-11-21' })).status, 400)
    assert.strictEqual((await post({ content: doc(p('x')), entryDate: '2026-02-30' })).status, 400)
    assert.strictEqual((await post({ content: doc(p('x')), outcome: 'maybe' })).status, 400)
    assert.strictEqual((await post({ content: doc({ type: 'image' }) })).status, 400)
    assert.strictEqual((await fetch(`${base}/api/journal`, json(OWNER, { target: 'stock:2330', content: doc(p('x')) }))).status, 400)
    assert.strictEqual((await fetch(`${base}/api/journal?target=nope`, { headers: { 'x-user': OWNER } })).status, 400)
    // 沒寫內容但標了結果：可以
    assert.strictEqual((await post({ content: doc({ type: 'paragraph' }), outcome: 'partial' })).status, 201)
  })
})

test('新增與修改依帳號限速：每分鐘 30 次，換一個帳號不受影響（api-reviewer）', async () => {
  // 用正式的限速器設定（不注入），確認它依帳號計
  const models = fakeModels()
  const app = express()
  app.use(express.json())
  app.use('/api', (req, _res, next) => ((req.auth = { userId: req.get('x-user') }), next()))
  app.use('/api', createJournalRouter({ ensureDatabase: () => true, requireAuth: (_req, _res, next) => next(), ...models, now: () => new Date('2026-11-20T02:00:00Z') }))
  await withServer(app, async (base) => {
    let last
    for (let i = 0; i < 31; i += 1) last = await fetch(`${base}/api/journal`, json(OWNER, { target: `reading:${READING_ID}`, content: doc(p(`第 ${i} 篇`)) }))
    assert.strictEqual(last.status, 429)
    const other = await fetch(`${base}/api/journal`, json(OTHER, { target: `reading:${READING_ID}`, content: doc(p('x')) }))
    // 別人沒抽過那天：404，但沒有被限速擋下
    assert.strictEqual(other.status, 404)
  })
})

test('股票日記一檔一本：分析過或追蹤中的股票才能寫，任意代號不行（v26 計畫 2-2）', async () => {
  const models = fakeModels()
  await withServer(appWith(models), async (base) => {
    const mine = await fetch(`${base}/api/journal`, json(OWNER, { target: 'stock:tw:2330', content: doc(p('跌破月線就出場')), outcome: 'partial' }))
    assert.strictEqual(mine.status, 201)
    const { entry } = await mine.json()
    assert.strictEqual(entry.target, 'stock:tw:2330')
    assert.strictEqual(entry.stock, null)
    // 只追蹤、沒分析過的也可以
    assert.strictEqual((await fetch(`${base}/api/journal`, json(OWNER, { target: 'stock:us:nvda', content: doc(p('x')) }))).status, 201)
    // 沒分析也沒追蹤：404；別人不能寫我的股票
    const unknown = await fetch(`${base}/api/journal`, json(OWNER, { target: 'stock:tw:0050', content: doc(p('x')) }))
    assert.strictEqual(unknown.status, 404)
    assert.match((await unknown.json()).message, /分析過或加入追蹤/)
    assert.strictEqual((await fetch(`${base}/api/journal`, json(OTHER, { target: 'stock:tw:2330', content: doc(p('x')) }))).status, 404)
    // 指數：加權用 ^TWII、櫃買用 O00；代號 t00 或別名 2330.TW 不能另開一本（api-reviewer 2026-11-20）
    assert.strictEqual((await fetch(`${base}/api/journal`, json(OWNER, { target: 'stock:tw:^TWII', content: doc(p('x')) }))).status, 201)
    assert.strictEqual((await fetch(`${base}/api/journal`, json(OWNER, { target: 'stock:tw:o00', content: doc(p('x')) }))).status, 201)
    assert.strictEqual((await fetch(`${base}/api/journal`, json(OWNER, { target: 'stock:tw:t00', content: doc(p('x')) }))).status, 404)
    assert.strictEqual((await fetch(`${base}/api/journal`, json(OWNER, { target: 'stock:tw:2330.TW', content: doc(p('x')) }))).status, 404)
    const list = await (await fetch(`${base}/api/journal?target=stock:tw:2330`, { headers: { 'x-user': OWNER } })).json()
    assert.strictEqual(list.entries.length, 1)
  })
})

test('記錄股票：只有股票日記收，可以只填股票欄位，修改時整組換掉或清掉（D8）', async () => {
  const models = fakeModels()
  await withServer(appWith(models), async (base) => {
    const stock = { action: 'buy', price: 1000, quantity: 1, unit: 'lot', quoteAtWrite: 998, quoteDate: '2026-11-20', targetPrice: 1200, stopPrice: 900 }
    const created = await fetch(`${base}/api/journal`, json(OWNER, { target: 'stock:tw:2330', content: doc({ type: 'paragraph' }), stock }))
    assert.strictEqual(created.status, 201)
    const { entry } = await created.json()
    assert.deepStrictEqual(entry.stock, stock)
    // 塔羅紀錄的日記不收股票欄位；欄位不對回 400
    assert.strictEqual((await fetch(`${base}/api/journal`, json(OWNER, { target: `reading:${READING_ID}`, content: doc(p('x')), stock: { action: 'buy' } }))).status, 400)
    assert.strictEqual((await fetch(`${base}/api/journal`, json(OWNER, { target: 'stock:tw:2330', content: doc(p('x')), stock: { action: 'short' } }))).status, 400)
    // 修改：整組換掉
    const changed = await (await fetch(`${base}/api/journal/${entry.id}`, json(OWNER, { stock: { action: 'sell', price: 1100 } }, 'PUT'))).json()
    assert.deepStrictEqual(changed.entry.stock, { action: 'sell', price: 1100, quantity: null, unit: null, quoteAtWrite: null, quoteDate: null, targetPrice: null, stopPrice: null })
    // 清掉之後什麼都沒寫：400；塔羅日記帶股票欄位：400
    assert.strictEqual((await fetch(`${base}/api/journal/${entry.id}`, json(OWNER, { stock: null }, 'PUT'))).status, 400)
    const reading = await (await fetch(`${base}/api/journal`, json(OWNER, { target: `reading:${READING_ID}`, content: doc(p('x')) }))).json()
    assert.strictEqual((await fetch(`${base}/api/journal/${reading.entry.id}`, json(OWNER, { stock: { action: 'buy' } }, 'PUT'))).status, 400)
  })
})

test('舊格式轉換（D9）：stock:<分析 id> 改成那筆分析的股票；找不到分析的保留；重跑不會再動', async () => {
  const OLD_ID = '507f1f77bcf86cd799439055'
  const GONE_ID = '507f1f77bcf86cd799439066'
  const rows = [
    { _id: 'j1', user: OWNER, targetKind: 'stock', targetId: OLD_ID },
    { _id: 'j2', user: OWNER, targetKind: 'stock', targetId: GONE_ID },
    { _id: 'j3', user: OWNER, targetKind: 'stock', targetId: 'tw:2330' },
    { _id: 'j4', user: OWNER, targetKind: 'reading', targetId: READING_ID },
  ]
  const JournalEntry = {
    find: (filter) => query(rows.filter((r) => r.targetKind === filter.targetKind && filter.targetId.test(r.targetId))),
    updateOne: async (filter, update) => Object.assign(rows.find((r) => r._id === filter._id), update.$set),
  }
  const analyses = { [OLD_ID]: { user: OWNER, target: { market: 'us', code: null, symbol: 'MU' } } }
  // 別人的分析對不上（user 也要符合）
  const MarketAnalysis = { findOne: (filter) => query(analyses[filter._id]?.user === filter.user ? analyses[filter._id] : null) }
  const silent = { log() {} }
  assert.deepStrictEqual(await migrateStockJournalTargets({ JournalEntry, MarketAnalysis, log: silent }), { converted: 1, orphaned: 1 })
  assert.deepStrictEqual(rows.map((r) => r.targetId), ['us:MU', GONE_ID, 'tw:2330', READING_ID])
  assert.deepStrictEqual(await migrateStockJournalTargets({ JournalEntry, MarketAnalysis, log: silent }), { converted: 0, orphaned: 1 })
})

test('標題：存下來、可以改、只有標題也算有寫；太長或不是字串回 400（2026-11-20）', async () => {
  await withServer(appWith(fakeModels()), async (base) => {
    const post = (body) => fetch(`${base}/api/journal`, json(OWNER, { target: `reading:${READING_ID}`, content: doc({ type: 'paragraph' }), ...body }))
    const created = await post({ title: '  後來\n怎麼了  ' })
    assert.strictEqual(created.status, 201)
    const { entry } = await created.json()
    assert.strictEqual(entry.title, '後來 怎麼了')
    const updated = await (await fetch(`${base}/api/journal/${entry.id}`, json(OWNER, { title: '改過的標題' }, 'PUT'))).json()
    assert.strictEqual(updated.entry.title, '改過的標題')
    // 標題清空、內容也空、沒有結果：回 400
    assert.strictEqual((await fetch(`${base}/api/journal/${entry.id}`, json(OWNER, { title: '' }, 'PUT'))).status, 400)
    assert.strictEqual((await post({ title: '字'.repeat(101) })).status, 400)
    assert.strictEqual((await post({ title: { $ne: '' } })).status, 400)
  })
})
