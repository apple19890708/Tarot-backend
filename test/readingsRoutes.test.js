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
function makeApp({ Reading, userId = OWNER } = {}) {
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
