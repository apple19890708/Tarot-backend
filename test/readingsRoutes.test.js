const test = require('node:test')
const assert = require('node:assert')
const express = require('express')

const { createReadingsRouter } = require('../src/routes/readings')
const { trimHistory } = require('../src/services/readingHistory')
const { MAX_READINGS_PER_USER } = require('../src/models/Reading')

const OWNER = '507f1f77bcf86cd7994390aa'
const OTHER = '507f1f77bcf86cd7994390bb'
const RECORD_ID = '507f1f77bcf86cd799439001'
const CARD_A = '507f1f77bcf86cd799439011'
const CARD_B = '507f1f77bcf86cd799439012'
const CARD_C = '507f1f77bcf86cd799439013'

// 在隨機 port 起一個臨時伺服器，測完關掉；不連資料庫
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

// mongoose 的查詢是鏈式呼叫，假 model 用這個物件模擬（最後 await 時回傳 result）
function fakeQuery(result, onCall) {
  const query = {
    sort(value) {
      onCall?.('sort', value)
      return query
    },
    skip(value) {
      onCall?.('skip', value)
      return query
    },
    limit(value) {
      onCall?.('limit', value)
      return query
    },
    select() {
      return query
    },
    lean() {
      return query
    },
    then(resolve) {
      resolve(result)
    },
  }
  return query
}

function makeRecord(overrides = {}) {
  return {
    _id: RECORD_ID,
    createdAt: new Date('2026-10-27T10:00:00Z'),
    question: '這份工作適合我嗎',
    domain: null,
    cards: [
      { cardId: CARD_A, orientation: 'upright', nameZh: '愚者' },
      { cardId: CARD_B, orientation: 'reversed', nameZh: '魔術師' },
      { cardId: CARD_C, orientation: 'upright', nameZh: '女祭司' },
    ],
    narration: null,
    toSummaryJSON: () => ({ id: RECORD_ID }),
    ...overrides,
  }
}

// 假的 Reading model：把收到的查詢條件記下來，讓測試檢查有沒有帶上 user
function makeFakeReading({ records = [makeRecord()] } = {}) {
  const calls = { find: [], findOne: [], deleteOne: [], create: [] }

  return {
    calls,
    countDocuments(filter) {
      calls.find.push(filter)
      return Promise.resolve(records.length)
    },
    find(filter) {
      calls.find.push(filter)
      return fakeQuery(records.filter((record) => String(record.user ?? OWNER) === String(filter.user)))
    },
    findOne(filter) {
      calls.findOne.push(filter)
      const found = records.find(
        (record) => String(record._id) === String(filter._id) && String(record.user ?? OWNER) === String(filter.user),
      )
      return Promise.resolve(found || null)
    },
    deleteOne(filter) {
      calls.deleteOne.push(filter)
      const exists = records.some(
        (record) => String(record._id) === String(filter._id) && String(record.user ?? OWNER) === String(filter.user),
      )
      return Promise.resolve({ deletedCount: exists ? 1 : 0 })
    },
    create(doc) {
      calls.create.push(doc)
      return Promise.resolve({ _id: RECORD_ID, createdAt: new Date('2026-10-27T10:00:00Z') })
    },
  }
}

// userId 固定成 OWNER，等於「已登入的那位使用者」
function makeApp({ Reading, userId = OWNER, ensureDomainAllowed } = {}) {
  const app = express()
  app.use(express.json())
  app.use(
    '/api/readings',
    createReadingsRouter({
      ensureDatabase: () => true,
      requireAuth: (req, _res, next) => {
        req.auth = { userId }
        next()
      },
      Reading,
      ensureDomainAllowed,
      // 不連資料庫，牌名直接給假的
      loadCardsInOrder: async (drawn) => ({
        cards: drawn.map((item, index) => ({ _id: item.id, nameZh: `牌${index + 1}` })),
      }),
    }),
  )
  return app
}

test('列表只查自己的紀錄：查詢條件一定帶 user', async () => {
  const Reading = makeFakeReading()
  await withServer(makeApp({ Reading }), async (base) => {
    const response = await fetch(`${base}/api/readings`)
    assert.strictEqual(response.status, 200)
  })

  assert.ok(Reading.calls.find.length > 0)
  Reading.calls.find.forEach((filter) => {
    assert.strictEqual(String(filter.user), OWNER)
  })
})

test('看別人的紀錄一律回 404，不透露那筆存在', async () => {
  const Reading = makeFakeReading({ records: [makeRecord({ user: OTHER })] })
  await withServer(makeApp({ Reading }), async (base) => {
    const response = await fetch(`${base}/api/readings/${RECORD_ID}`)
    assert.strictEqual(response.status, 404)
  })

  // 查詢本身就帶了 user，不是查到之後才比對
  assert.strictEqual(String(Reading.calls.findOne[0].user), OWNER)
})

test('刪別人的紀錄刪不掉，回 404', async () => {
  const Reading = makeFakeReading({ records: [makeRecord({ user: OTHER })] })
  await withServer(makeApp({ Reading }), async (base) => {
    const response = await fetch(`${base}/api/readings/${RECORD_ID}`, { method: 'DELETE' })
    assert.strictEqual(response.status, 404)
  })

  assert.strictEqual(String(Reading.calls.deleteOne[0].user), OWNER)
})

test('刪自己的紀錄成功', async () => {
  const Reading = makeFakeReading()
  await withServer(makeApp({ Reading }), async (base) => {
    const response = await fetch(`${base}/api/readings/${RECORD_ID}`, { method: 'DELETE' })
    assert.strictEqual(response.status, 200)
    assert.deepStrictEqual(await response.json(), { deleted: true })
  })
})

test('id 不合法時當成找不到，不送出刪除', async () => {
  const Reading = makeFakeReading()
  await withServer(makeApp({ Reading }), async (base) => {
    const response = await fetch(`${base}/api/readings/not-an-object-id`, { method: 'DELETE' })
    assert.strictEqual(response.status, 404)
  })

  assert.strictEqual(Reading.calls.deleteOne.length, 0)
})

async function postReading(base, body) {
  return fetch(`${base}/api/readings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('保存紀錄：存成自己的，牌與正逆位照送來的順序', async () => {
  const Reading = makeFakeReading()
  await withServer(makeApp({ Reading }), async (base) => {
    const response = await postReading(base, {
      question: '這份工作適合我嗎',
      cards: [
        { id: CARD_A, orientation: 'upright' },
        { id: CARD_B, orientation: 'reversed' },
      ],
    })
    assert.strictEqual(response.status, 201)
    assert.strictEqual((await response.json()).id, RECORD_ID)
  })

  const created = Reading.calls.create[0]
  assert.strictEqual(String(created.user), OWNER)
  assert.deepStrictEqual(
    created.cards.map((card) => `${card.cardId}:${card.orientation}`),
    [`${CARD_A}:upright`, `${CARD_B}:reversed`],
  )
  // 沒帶 AI 解讀時存成 null，之後仍可補做
  assert.strictEqual(created.narration, null)
})

test('保存紀錄：可以一起存剛產生的 AI 解讀', async () => {
  const Reading = makeFakeReading()
  await withServer(makeApp({ Reading }), async (base) => {
    const response = await postReading(base, {
      question: '',
      cards: [{ id: CARD_A, orientation: 'upright' }],
      narration: { text: '這組牌在說…', model: 'test-model' },
    })
    assert.strictEqual(response.status, 201)
  })

  assert.strictEqual(Reading.calls.create[0].narration.text, '這組牌在說…')
  assert.strictEqual(Reading.calls.create[0].narration.model, 'test-model')
})

test('保存紀錄：可以一起存解讀當下的市場資料，形狀不對就不存', async () => {
  const Reading = makeFakeReading()
  const market = { asOf: '2026-11-05T02:40:00.000Z', items: [{ symbol: '^TWII' }], notes: [] }
  await withServer(makeApp({ Reading }), async (base) => {
    // 只有股市諮詢的紀錄才收行情資料
    await postReading(base, { question: '', domain: 'stock', cards: [{ id: CARD_A, orientation: 'upright' }], narration: { text: '解讀', market } })
    await postReading(base, { question: '', domain: 'stock', cards: [{ id: CARD_A, orientation: 'upright' }], narration: { text: '解讀', market: 'bad' } })
  })
  assert.deepStrictEqual(Reading.calls.create[0].narration.market, market)
  assert.strictEqual(Reading.calls.create[1].narration.market, null)
})

test('保存紀錄：沒有 AI 權限的人不能存股市諮詢的紀錄', async () => {
  const Reading = makeFakeReading()
  const deny = async (_req, res, domain) => {
    if (domain !== 'stock') return true
    res.status(403).json({ message: '股市諮詢需要 AI 解讀權限，請聯絡管理者開通。' })
    return false
  }
  await withServer(makeApp({ Reading, ensureDomainAllowed: deny }), async (base) => {
    const denied = await postReading(base, { question: '', domain: 'stock', cards: [{ id: CARD_A, orientation: 'upright' }] })
    assert.strictEqual(denied.status, 403)
    const allowed = await postReading(base, { question: '', domain: 'money', cards: [{ id: CARD_A, orientation: 'upright' }] })
    assert.strictEqual(allowed.status, 201)
  })
  assert.strictEqual(Reading.calls.create.length, 1)
})

test('保存紀錄：牌格式不正確時回 400，不寫進資料庫', async () => {
  const Reading = makeFakeReading()
  await withServer(makeApp({ Reading }), async (base) => {
    const response = await postReading(base, { question: '', cards: [{ id: 'bad-id', orientation: 'upright' }] })
    assert.strictEqual(response.status, 400)

    const empty = await postReading(base, { question: '', cards: [] })
    assert.strictEqual(empty.status, 400)
  })

  assert.strictEqual(Reading.calls.create.length, 0)
})

test('保存紀錄：問題過長與 AI 解讀過長都擋下來', async () => {
  const Reading = makeFakeReading()
  await withServer(makeApp({ Reading }), async (base) => {
    const longQuestion = await postReading(base, {
      question: 'x'.repeat(501),
      cards: [{ id: CARD_A, orientation: 'upright' }],
    })
    assert.strictEqual(longQuestion.status, 400)

    const longNarration = await postReading(base, {
      question: '',
      cards: [{ id: CARD_A, orientation: 'upright' }],
      narration: { text: 'x'.repeat(20001) },
    })
    assert.strictEqual(longNarration.status, 400)
  })

  assert.strictEqual(Reading.calls.create.length, 0)
})

test('保存紀錄：牌陣張數對不上時回 400', async () => {
  const Reading = makeFakeReading()
  await withServer(makeApp({ Reading }), async (base) => {
    const response = await postReading(base, {
      question: '',
      spreadKey: 'timeline',
      cards: [{ id: CARD_A, orientation: 'upright' }],
    })
    assert.strictEqual(response.status, 400)
  })

  assert.strictEqual(Reading.calls.create.length, 0)
})

// ---- 超過上限時的修剪 ----

// trimHistory 只需要 countDocuments / find / deleteMany
function makeTrimModel(total) {
  const state = { sort: null, skip: null, deleted: null }
  const stale = Array.from({ length: Math.max(0, total - MAX_READINGS_PER_USER) }, (_, index) => ({
    _id: `old-${index}`,
  }))

  return {
    state,
    countDocuments: () => Promise.resolve(total),
    find: () =>
      fakeQuery(stale, (name, value) => {
        state[name] = value
      }),
    deleteMany(filter) {
      state.deleted = filter
      return Promise.resolve({ deletedCount: stale.length })
    },
  }
}

test('紀錄沒超過上限時不刪東西', async () => {
  const model = makeTrimModel(MAX_READINGS_PER_USER)
  await trimHistory(OWNER, model)
  assert.strictEqual(model.state.deleted, null)
})

test('超過上限時刪掉最舊的，且只刪自己的', async () => {
  const model = makeTrimModel(MAX_READINGS_PER_USER + 2)
  await trimHistory(OWNER, model)

  // 由新到舊排序後跳過上限筆數，剩下的才是要刪的「最舊的」
  assert.strictEqual(model.state.sort.createdAt, -1)
  assert.strictEqual(model.state.skip, MAX_READINGS_PER_USER)
  assert.strictEqual(String(model.state.deleted.user), OWNER)
  assert.deepStrictEqual(model.state.deleted._id.$in, ['old-0', 'old-1'])
})

test('保存紀錄：行情資料只有股市諮詢才收，含 $ 開頭的 key 不存', async () => {
  const Reading = makeFakeReading()
  const market = { asOf: '2026-11-05T02:40:00.000Z', items: [{ symbol: '^TWII' }], notes: [] }
  await withServer(makeApp({ Reading }), async (base) => {
    const card = [{ id: CARD_A, orientation: 'upright' }]
    await postReading(base, { question: '', domain: 'money', cards: card, narration: { text: '解讀', market } })
    await postReading(base, { question: '', domain: 'stock', cards: card, narration: { text: '解讀', market: { items: [{ $where: 'x' }] } } })
  })
  assert.strictEqual(Reading.calls.create[0].narration.market, null)
  assert.strictEqual(Reading.calls.create[1].narration.market, null)
  assert.strictEqual(Reading.calls.create[1].narration.text, '解讀')
})

// ---- 補存 AI 解讀（2026-11-12）：AI 寫的過程中才按保存，那次 AI 請求沒有紀錄 id，寫完後由前端補上 ----
// makeRecord 的牌：愚者正、魔術師逆、女祭司正
const RECORD_CARDS = [
  { id: CARD_A, orientation: 'upright' },
  { id: CARD_B, orientation: 'reversed' },
  { id: CARD_C, orientation: 'upright' },
]
async function putNarration(base, id, body) {
  return fetch(`${base}/api/readings/${id}/narration`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cards: RECORD_CARDS, ...body }),
  })
}

test('補存 AI 解讀：存進自己的紀錄，已經有的直接覆蓋', async () => {
  let saves = 0
  const record = makeRecord({ narration: { text: '舊的解讀' }, save: async () => (saves += 1) })
  const Reading = makeFakeReading({ records: [record] })
  await withServer(makeApp({ Reading }), async (base) => {
    const response = await putNarration(base, RECORD_ID, { text: '新的解讀', model: 'm1' })
    assert.strictEqual(response.status, 200)
    assert.deepStrictEqual(await response.json(), { saved: true })
  })
  assert.strictEqual(saves, 1)
  assert.strictEqual(record.narration.text, '新的解讀')
  assert.strictEqual(record.narration.model, 'm1')
  assert.strictEqual(String(Reading.calls.findOne[0].user), OWNER)
})

test('補存 AI 解讀：別人的紀錄回 404；沒有內容、太長回 400，都不寫入', async () => {
  let saves = 0
  const save = async () => (saves += 1)
  const others = makeFakeReading({ records: [makeRecord({ user: OTHER, save })] })
  await withServer(makeApp({ Reading: others }), async (base) => {
    assert.strictEqual((await putNarration(base, RECORD_ID, { text: '解讀' })).status, 404)
    assert.strictEqual((await putNarration(base, 'not-an-object-id', { text: '解讀' })).status, 404)
  })
  const own = makeFakeReading({ records: [makeRecord({ save })] })
  await withServer(makeApp({ Reading: own }), async (base) => {
    assert.strictEqual((await putNarration(base, RECORD_ID, { text: '   ' })).status, 400)
    assert.strictEqual((await putNarration(base, RECORD_ID, { text: '字'.repeat(20001) })).status, 400)
  })
  assert.strictEqual(saves, 0)
})

test('補存 AI 解讀：行情資料只有股市諮詢的紀錄才收', async () => {
  const market = { items: [{ symbol: '2330.TW' }], notes: [] }
  const stock = makeRecord({ domain: 'stock', save: async () => {} })
  const plain = makeRecord({ save: async () => {} })
  await withServer(makeApp({ Reading: makeFakeReading({ records: [stock] }) }), async (base) => {
    assert.strictEqual((await putNarration(base, RECORD_ID, { text: '解讀', market })).status, 200)
  })
  await withServer(makeApp({ Reading: makeFakeReading({ records: [plain] }) }), async (base) => {
    assert.strictEqual((await putNarration(base, RECORD_ID, { text: '解讀', market })).status, 200)
  })
  assert.deepStrictEqual(stock.narration.market, market)
  assert.strictEqual(plain.narration.market, null)
})

test('補存 AI 解讀：牌和紀錄不一樣（張數、牌、正逆位）回 409，不寫入', async () => {
  let saves = 0
  const record = makeRecord({ save: async () => (saves += 1) })
  await withServer(makeApp({ Reading: makeFakeReading({ records: [record] }) }), async (base) => {
    const flipped = RECORD_CARDS.map((card, index) => (index === 1 ? { ...card, orientation: 'upright' } : card))
    assert.strictEqual((await putNarration(base, RECORD_ID, { text: '解讀', cards: flipped })).status, 409)
    assert.strictEqual((await putNarration(base, RECORD_ID, { text: '解讀', cards: RECORD_CARDS.slice(0, 2) })).status, 409)
    assert.strictEqual((await putNarration(base, RECORD_ID, { text: '解讀', cards: undefined })).status, 409)
  })
  assert.strictEqual(saves, 0)
  assert.strictEqual(record.narration, null)
})

test('補存 AI 解讀：只改解讀，body 裡夾帶的問題、牌、類別、使用者都不會被改', async () => {
  const record = makeRecord({ save: async () => {} })
  const before = { question: record.question, cards: JSON.stringify(record.cards), domain: record.domain }
  await withServer(makeApp({ Reading: makeFakeReading({ records: [record] }) }), async (base) => {
    const response = await putNarration(base, RECORD_ID, { text: '解讀', question: '改掉的問題', domain: 'stock', user: OTHER })
    assert.strictEqual(response.status, 200)
  })
  assert.strictEqual(record.question, before.question)
  assert.strictEqual(JSON.stringify(record.cards), before.cards)
  assert.strictEqual(record.domain, before.domain)
  assert.strictEqual(record.user, undefined)
  assert.strictEqual(record.narration.text, '解讀')
})

// ---- 抽牌追問（v23，2026-11-13）：追問與補充牌存進紀錄 ----
const CARD_D = '507f1f77bcf86cd799439014'
const CARD_E = '507f1f77bcf86cd799439015'
const FOLLOW_UPS = [{ question: '那他會自己請辭嗎', cards: [{ id: CARD_D, orientation: 'reversed' }] }]
async function putFollowUps(base, id, body) {
  return fetch(`${base}/api/readings/${id}/follow-ups`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cards: RECORD_CARDS, followUps: FOLLOW_UPS, ...body }),
  })
}

test('保存紀錄：追問與延伸回答一起存；沒有追問就不存延伸回答', async () => {
  const Reading = makeFakeReading()
  await withServer(makeApp({ Reading }), async (base) => {
    const post = (body) =>
      fetch(`${base}/api/readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: '他會下台嗎', cards: RECORD_CARDS, ...body }),
      })
    assert.strictEqual((await post({ followUps: FOLLOW_UPS, followUpNarration: { text: '延伸回答', model: 'm1' } })).status, 201)
    assert.strictEqual((await post({ followUpNarration: { text: '沒有追問的延伸回答' } })).status, 201)
    // 補充牌和原牌陣重複、超過三次都擋掉
    assert.strictEqual((await post({ followUps: [{ question: '問', cards: [{ id: CARD_A, orientation: 'upright' }] }] })).status, 400)
    assert.strictEqual((await post({ followUps: [...FOLLOW_UPS, ...FOLLOW_UPS] })).status, 400)
  })
  const [withFollowUps, without] = Reading.calls.create
  assert.strictEqual(withFollowUps.followUps.length, 1)
  assert.strictEqual(withFollowUps.followUps[0].question, '那他會自己請辭嗎')
  assert.strictEqual(String(withFollowUps.followUps[0].cards[0].cardId), CARD_D)
  assert.strictEqual(withFollowUps.followUps[0].cards[0].orientation, 'reversed')
  assert.strictEqual(withFollowUps.followUpNarration.text, '延伸回答')
  assert.strictEqual(without.followUps, undefined)
  assert.strictEqual(without.followUpNarration, null)
  assert.strictEqual(Reading.calls.create.length, 2)
})

test('更新追問：整批取代；narration 有帶才動延伸回答，清空追問時一併清掉', async () => {
  let saves = 0
  const record = makeRecord({ followUpNarration: { text: '舊的延伸回答' }, save: async () => (saves += 1) })
  await withServer(makeApp({ Reading: makeFakeReading({ records: [record] }) }), async (base) => {
    // 沒帶 narration：只換追問，延伸回答保留
    assert.strictEqual((await putFollowUps(base, RECORD_ID, {})).status, 200)
    assert.strictEqual(record.followUps.length, 1)
    assert.strictEqual(String(record.followUps[0].cards[0].cardId), CARD_D)
    assert.strictEqual(record.followUpNarration.text, '舊的延伸回答')
    // 帶 narration：一起更新
    const two = [...FOLLOW_UPS, { question: '什麼時候', cards: [{ id: CARD_E, orientation: 'upright' }] }]
    assert.strictEqual((await putFollowUps(base, RECORD_ID, { followUps: two, narration: { text: '新的延伸回答', model: 'm2' } })).status, 200)
    assert.strictEqual(record.followUps.length, 2)
    assert.strictEqual(record.followUpNarration.text, '新的延伸回答')
    assert.strictEqual(record.followUpNarration.market, undefined)
    // 清空
    assert.strictEqual((await putFollowUps(base, RECORD_ID, { followUps: [] })).status, 200)
    assert.strictEqual(record.followUps, undefined)
    assert.strictEqual(record.followUpNarration, null)
  })
  assert.strictEqual(saves, 3)
})

test('更新追問：別人的紀錄 404、牌不一致 409、格式不對 400，都不寫入，也改不到問題與原牌陣', async () => {
  let saves = 0
  const save = async () => (saves += 1)
  await withServer(makeApp({ Reading: makeFakeReading({ records: [makeRecord({ user: OTHER, save })] }) }), async (base) => {
    assert.strictEqual((await putFollowUps(base, RECORD_ID, {})).status, 404)
  })
  const record = makeRecord({ save })
  await withServer(makeApp({ Reading: makeFakeReading({ records: [record] }) }), async (base) => {
    assert.strictEqual((await putFollowUps(base, RECORD_ID, { cards: RECORD_CARDS.slice(0, 2) })).status, 409)
    assert.strictEqual((await putFollowUps(base, RECORD_ID, { followUps: [{ question: '', cards: [{ id: CARD_D, orientation: 'upright' }] }] })).status, 400)
    assert.strictEqual((await putFollowUps(base, RECORD_ID, { followUps: [{ question: '問', cards: [{ id: CARD_B, orientation: 'upright' }] }] })).status, 400)
    assert.strictEqual((await putFollowUps(base, RECORD_ID, { narration: { text: '字'.repeat(20001) } })).status, 400)
    assert.strictEqual(saves, 0)
    assert.strictEqual((await putFollowUps(base, RECORD_ID, { question: '改掉的問題', domain: 'stock', user: OTHER })).status, 200)
  })
  assert.strictEqual(saves, 1)
  assert.strictEqual(record.question, '這份工作適合我嗎')
  assert.strictEqual(record.cards.length, 3)
  assert.strictEqual(record.domain, null)
  assert.strictEqual(record.user, undefined)
})

// ---- api-reviewer 2026-11-13 的修正 ----
const { followUpRelation, mergeFollowUpRecords } = require('../src/services/readingHistory')
const { validateFollowUps } = require('../src/services/followUp')
const { validateManualCards } = require('../src/services/manualDraw')

test('追問清單的關係：相同、延伸、落後、對不起來；合併時沒變的追問沿用原本的時間', () => {
  const old = new Date('2026-11-01T00:00:00Z')
  const stored = [{ question: '問一', cards: [{ cardId: CARD_D, orientation: 'reversed' }], createdAt: old }]
  const one = { question: '問一', drawn: [{ id: CARD_D, orientation: 'reversed' }] }
  const two = { question: '問二', drawn: [{ id: CARD_E, orientation: 'upright' }] }
  assert.strictEqual(followUpRelation(stored, [one]), 'same')
  assert.strictEqual(followUpRelation(stored, [one, two]), 'extended')
  assert.strictEqual(followUpRelation(stored, []), 'behind')
  assert.strictEqual(followUpRelation(stored, [two]), 'different')
  assert.strictEqual(followUpRelation(stored, [{ ...one, question: '改過的問題' }]), 'different')
  assert.strictEqual(followUpRelation(undefined, [one]), 'extended')

  const merged = mergeFollowUpRecords(stored, [one, two])
  assert.strictEqual(merged[0].createdAt, old)
  assert.notStrictEqual(merged[1].createdAt, old)
  // 同一位置換成別的追問：是新的，不沿用時間
  assert.notStrictEqual(mergeFollowUpRecords(stored, [two])[0].createdAt, old)
})

test('牌 id 只收 24 位十六進位字串：大寫不能繞過重複檢查，物件與其他型別回格式錯誤', () => {
  const base = [{ id: CARD_A, orientation: 'upright' }]
  const round = (id) => [{ question: '問', cards: [{ id, orientation: 'upright' }] }]
  assert.ok(validateFollowUps(round(CARD_A.toUpperCase()), base).error)
  assert.match(validateFollowUps(round({ id: CARD_D }), base).error, /格式不正確/)
  assert.match(validateFollowUps(round('123456789012'), base).error, /格式不正確/)
  // 合法的大寫 id 存成小寫
  assert.strictEqual(validateFollowUps(round(CARD_D.toUpperCase()), base).followUps[0].drawn[0].id, CARD_D)
  assert.match(validateFollowUps('not-an-array', base).error, /格式不正確/)

  assert.ok(validateManualCards([{ id: CARD_A, orientation: 'upright' }, { id: CARD_A.toUpperCase(), orientation: 'upright' }]).error)
  assert.ok(validateManualCards([{ id: { id: CARD_A }, orientation: 'upright' }]).error)
  assert.strictEqual(validateManualCards([{ id: CARD_A, orientation: 'upright' }]).drawn.length, 1)
})

test('更新追問：換成另一組追問而沒帶延伸回答時，舊的延伸回答清掉；延伸回答記下涵蓋幾次追問', async () => {
  const stored = [{ question: '那他會自己請辭嗎', cards: [{ cardId: CARD_D, orientation: 'reversed' }], createdAt: new Date('2026-11-01T00:00:00Z') }]
  const record = makeRecord({ followUps: stored, followUpNarration: { text: '舊的延伸回答', rounds: 1 }, save: async () => {} })
  await withServer(makeApp({ Reading: makeFakeReading({ records: [record] }) }), async (base) => {
    // 往後追加：延伸回答留著，第一次追問的時間不變
    const two = [...FOLLOW_UPS, { question: '什麼時候', cards: [{ id: CARD_E, orientation: 'upright' }] }]
    assert.strictEqual((await putFollowUps(base, RECORD_ID, { followUps: two })).status, 200)
    assert.strictEqual(record.followUpNarration.text, '舊的延伸回答')
    assert.strictEqual(record.followUps[0].createdAt.toISOString(), '2026-11-01T00:00:00.000Z')
    // 帶延伸回答：記下涵蓋兩次
    assert.strictEqual((await putFollowUps(base, RECORD_ID, { followUps: two, narration: { text: '新的' } })).status, 200)
    assert.strictEqual(record.followUpNarration.rounds, 2)
    // 換成另一組追問、沒帶延伸回答：清掉
    const other = [{ question: '另一個問題', cards: [{ id: CARD_E, orientation: 'reversed' }] }]
    assert.strictEqual((await putFollowUps(base, RECORD_ID, { followUps: other })).status, 200)
    assert.strictEqual(record.followUpNarration, null)
  })
})

test('單筆回顧：回傳追問（含牌義）與延伸回答涵蓋的次數；舊紀錄沒有追問時是空陣列', async () => {
  const withFollowUps = makeRecord({
    followUps: [{ question: '那他會自己請辭嗎', cards: [{ cardId: CARD_D, orientation: 'reversed' }], createdAt: new Date('2026-11-01T00:00:00Z') }],
    followUpNarration: { text: '延伸回答', model: 'm1', rounds: 1, createdAt: new Date('2026-11-01T00:01:00Z') },
  })
  const restore = (record) => restoreForTest(record)
  const restored = await restore(withFollowUps)
  assert.strictEqual(restored.followUps.length, 1)
  assert.strictEqual(restored.followUps[0].question, '那他會自己請辭嗎')
  assert.strictEqual(restored.followUps[0].cards[0].orientation, 'reversed')
  assert.strictEqual(restored.followUpNarration.rounds, 1)
  assert.strictEqual(restored.followUpNarration.market, undefined)
  const plain = await restore(makeRecord())
  assert.deepStrictEqual(plain.followUps, [])
  assert.strictEqual(plain.followUpNarration, null)
})

// GET /:id 要重算分析，需要完整的牌資料；這裡給夠用的假牌
async function restoreForTest(record) {
  const app = express()
  app.use(express.json())
  app.use(
    '/api/readings',
    createReadingsRouter({
      ensureDatabase: () => true,
      requireAuth: (req, _res, next) => {
        req.auth = { userId: OWNER }
        next()
      },
      Reading: makeFakeReading({ records: [record] }),
      loadCardsInOrder: async (drawn) => ({
        cards: drawn.map((item, index) => ({
          _id: item.id,
          slug: `card-${index}`,
          nameZh: `權杖${index + 2}`,
          nameEn: ['Two of Wands', 'Three of Wands', 'Four of Wands'][index] || 'Five of Wands',
          arcanaType: 'minor',
          suit: 'wands',
          number: index + 2,
          keywords: [],
          sections: {},
        })),
      }),
    }),
  )
  let body = null
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/readings/${RECORD_ID}`)
    assert.strictEqual(response.status, 200)
    body = await response.json()
  })
  return body
}
