// 塔羅路由（v29 項目 9：從 server.js 抽成 createTarotRouter 後，HTTP 層的測試）。
// AI 一律用假的串流，絕不呼叫 OpenRouter。涵蓋：權限、同時請求的鎖（項目 1）、次數、串流事件、
// 開始前被拒 422、途中出錯退還、股市諮詢的行情事件、追問以紀錄為準（項目 6）、訪客限速（項目 4）
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { createTarotRouter } = require('../src/routes/tarot')
const { createTarotAiQuota } = require('../src/services/tarotAiQuota')
const { createGuestLimiter } = require('../src/lib/guestLimiter')
const { NarrationRefusedError } = require('../src/services/narrationService')

const USER = '507f1f77bcf86cd799439011'
const RECORD_ID = '507f1f77bcf86cd799439099'
const CARD_A = '64b000000000000000000001'
const CARD_B = '64b000000000000000000002'
const CARD_C = '64b000000000000000000003'
const DRAWN = [
  { id: CARD_A, orientation: 'upright' },
  { id: CARD_B, orientation: 'reversed' },
  { id: CARD_C, orientation: 'upright' },
]
const BODY = { spreadKey: 'timeline', question: '會順利嗎', cards: DRAWN }

// 用量表：記錄、退還、回報都留在記憶體
function fakeUsage() {
  const rows = []
  let id = 0
  return {
    rows,
    KEEP_DAYS: 14,
    countDocuments: async (filter) => rows.filter((row) => row.user === String(filter.user) && row.kind === filter.kind).length,
    create: async (doc) => {
      const row = { _id: `u${++id}`, ...doc, user: String(doc.user) }
      rows.push(row)
      return row
    },
    deleteOne: async (filter) => {
      const index = rows.findIndex((row) => row._id === filter._id)
      if (index >= 0) rows.splice(index, 1)
    },
    updateOne: async (filter, update) => Object.assign(rows.find((row) => row._id === filter._id) || {}, update.$set),
  }
}

function fakeRecord(extra = {}) {
  return {
    _id: RECORD_ID,
    user: USER,
    cards: DRAWN.map((item) => ({ cardId: item.id, orientation: item.orientation })),
    narration: null,
    followUps: [],
    followUpNarration: null,
    saved: 0,
    async save() {
      this.saved += 1
    },
    ...extra,
  }
}

function build({ ai, quota, record = null, aiAccess = true, loggedIn = true, guestLimiter = (_req, _res, next) => next(), snapshot = null } = {}) {
  const Usage = quota?.Usage || fakeUsage()
  const aiQuota = quota?.aiQuota || createTarotAiQuota({ Usage })
  const auth = (req, res, next) => {
    if (loggedIn) req.auth = { userId: USER, role: 'member' }
    next()
  }
  const requireAiAccess = (req, res, next) => {
    if (!loggedIn) return res.status(401).json({ message: '請先登入。' })
    if (!aiAccess) return res.status(403).json({ message: 'AI 解讀需要管理者開通，請聯絡管理者。' })
    req.auth = { userId: USER, role: 'member' }
    next()
  }
  const calls = { market: 0, recordCalls: 0 }
  const app = express()
  app.use(express.json())
  app.use(
    createTarotRouter({
      ensureDatabase: () => true,
      optionalAuth: auth,
      requireAiAccess,
      ensureDomainAllowed: async () => true,
      Card: { aggregate: async ([, sample]) => Array.from({ length: (sample || {}).$sample?.size || 3 }, (_, i) => ({ _id: `64b00000000000000000010${i}`, nameZh: `牌${i}` })) },
      Reading: { findOne: async (filter) => (record && filter._id === RECORD_ID && filter.user === USER ? record : null) },
      MarketCall: {},
      loadCardsInOrder: async (drawn) => ({ cards: drawn.map((item, index) => ({ _id: item.id, nameZh: `牌${index}` })) }),
      buildReadingWithDictionary: async ({ question, spread, cards }) => ({
        question,
        spread: { key: spread?.key || 'custom' },
        cards: cards.map((card, index) => ({ position: { key: `p${index}` }, card })),
        analysis: {},
      }),
      aiQuota,
      ai: ai || fakeAi(),
      market: {
        buildSnapshot: async () => (calls.market++, snapshot),
        recordCalls: async () => {
          calls.recordCalls++
        },
      },
      isDatabaseReady: () => false,
      guestLimiter,
      random: () => 0.9,
    }),
  )
  app.use((error, _req, res, _next) => res.status(500).json({ message: error.message }))
  return { app, Usage, aiQuota, calls }
}

// 假的 AI：chunks 依序送出；throwAt 'beforeStart' | 'afterStart'；refuse：開始前就拒絕
function fakeAi({ chunks = ['事情', '會順利。'], throwAt = null, refuse = false, gate = null } = {}) {
  const calls = { narrate: [], followUp: [] }
  const stream = (kind) => async (options) => {
    calls[kind].push(options)
    if (refuse) throw new NarrationRefusedError('拒絕')
    if (throwAt === 'beforeStart') throw new Error('AI 掛了')
    options.onStart()
    for (const chunk of chunks) {
      options.onDelta(chunk)
      if (throwAt === 'afterStart') throw new Error('串流中斷')
    }
    if (gate) await gate
    return { model: 'fake-model', usage: { prompt_tokens: 100, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 80 }, cost: 0.002 } }
  }
  return { calls, isAvailable: () => true, streamNarration: stream('narrate'), streamFollowUpNarration: stream('followUp') }
}

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const events = async (response) => (await response.text()).trim().split('\n').map((line) => JSON.parse(line))

test('AI 解讀：串流 delta 與 done；完成後回報 token 與費用到用量記錄（不記問題）', async () => {
  const { app, Usage } = build()
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/readings/narrate`, post(BODY))
    assert.equal(response.status, 200)
    const list = await events(response)
    assert.deepEqual(
      list.filter((e) => e.type === 'delta').map((e) => e.text),
      ['事情', '會順利。'],
    )
    assert.deepEqual(list.at(-1), { type: 'done', model: 'fake-model', saved: null })
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(Usage.rows.length, 1)
  const row = Usage.rows[0]
  assert.equal(row.kind, 'tarot')
  assert.deepEqual(
    { promptTokens: row.promptTokens, completionTokens: row.completionTokens, cachedTokens: row.cachedTokens, cost: row.cost, model: row.model },
    { promptTokens: 100, completionTokens: 50, cachedTokens: 80, cost: 0.002, model: 'fake-model' },
  )
  assert.equal(JSON.stringify(row).includes('會順利嗎'), false)
})

test('AI 解讀：沒有 AI 權限 403、沒登入 401，都不呼叫 AI；次數用完 429', async () => {
  const ai = fakeAi()
  await withServer(build({ ai, aiAccess: false }).app, async (base) => {
    assert.equal((await fetch(`${base}/api/readings/narrate`, post(BODY))).status, 403)
  })
  await withServer(build({ ai, loggedIn: false }).app, async (base) => {
    assert.equal((await fetch(`${base}/api/readings/narrate`, post(BODY))).status, 401)
  })
  const Usage = fakeUsage()
  for (let i = 0; i < 30; i += 1) Usage.rows.push({ _id: `x${i}`, user: USER, kind: 'tarot' })
  await withServer(build({ ai, quota: { Usage } }).app, async (base) => {
    const response = await fetch(`${base}/api/readings/narrate`, post(BODY))
    assert.equal(response.status, 429)
    assert.match((await response.json()).message, /今天的AI 解讀已用完/)
  })
  assert.equal(ai.calls.narrate.length, 0)
})

test('同一人再送一次 AI 解讀就取代進行中的那次（v29 項目 1）：舊的被中斷、新的完成；鎖在 429 之後也會釋放', async () => {
  let calls = 0
  const ai = {
    calls: { narrate: [], followUp: [] },
    isAvailable: () => true,
    streamNarration: ({ signal, onStart, onDelta }) => {
      calls += 1
      onStart()
      onDelta('開頭')
      if (calls === 1) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
      return Promise.resolve({ model: 'fake-model' })
    },
    streamFollowUpNarration: async () => ({ model: 'fake-model' }),
  }
  const Usage = fakeUsage()
  const { app } = build({ ai, quota: { Usage } })
  await withServer(app, async (base) => {
    const first = await fetch(`${base}/api/readings/narrate`, post(BODY))
    const second = await fetch(`${base}/api/readings/narrate`, post(BODY))
    assert.equal(second.status, 200)
    assert.equal((await events(second)).at(-1).type, 'done')
    const firstEvents = await events(first).catch(() => [])
    assert.equal(firstEvents.some((e) => e.type === 'done'), false)
  })
  assert.equal(calls, 2)
  // 兩次都開始產生（都算），被取代的不退還
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(Usage.rows.length, 2)

  // 429 之後鎖有釋放：補足 30 次後回 429，下一次仍然是 429（不是 409）
  for (let i = 0; i < 28; i += 1) Usage.rows.push({ _id: `y${i}`, user: USER, kind: 'tarot' })
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/readings/narrate`, post(BODY))).status, 429)
    assert.equal((await fetch(`${base}/api/readings/narrate`, post(BODY))).status, 429)
  })
})

test('追問：沒有追問時 400，鎖會釋放，之後的請求照常', async () => {
  const { app } = build()
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/readings/follow-up/narrate`, post({ ...BODY, followUps: [] }))).status, 400)
    assert.equal((await fetch(`${base}/api/readings/follow-up/narrate`, post({ ...BODY, followUps: [] }))).status, 400)
  })
})

test('AI 拒絕（開始前）回 422 並退還；串流途中出錯送 error 事件並退還', async () => {
  const refusedUsage = fakeUsage()
  await withServer(build({ ai: fakeAi({ refuse: true }), quota: { Usage: refusedUsage } }).app, async (base) => {
    const response = await fetch(`${base}/api/readings/narrate`, post(BODY))
    assert.equal(response.status, 422)
    assert.equal((await response.json()).message, 'AI 無法產生這次的解讀。')
  })
  assert.equal(refusedUsage.rows.length, 0)

  const failedUsage = fakeUsage()
  await withServer(build({ ai: fakeAi({ throwAt: 'afterStart' }), quota: { Usage: failedUsage } }).app, async (base) => {
    const list = await events(await fetch(`${base}/api/readings/narrate`, post(BODY)))
    assert.deepEqual(list.at(-1), { type: 'error', message: 'AI 解讀中途發生錯誤，請再試一次。' })
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(failedUsage.rows.length, 0, '途中出錯要退還')

  await withServer(build({ ai: fakeAi({ throwAt: 'beforeStart' }) }).app, async (base) => {
    assert.equal((await fetch(`${base}/api/readings/narrate`, post(BODY))).status, 500)
  })
})

test('股市諮詢：先送 market 事件；完整產生後連同行情存回自己的紀錄；其他問題類型不查行情', async () => {
  const snapshot = { asOf: '2026-11-26', items: [{ name: '台積電' }], notes: [] }
  const record = fakeRecord()
  const { app, calls } = build({ record, snapshot })
  await withServer(app, async (base) => {
    const list = await events(await fetch(`${base}/api/readings/narrate`, post({ ...BODY, domain: 'stock', readingId: RECORD_ID })))
    assert.deepEqual(list[0], { type: 'market', snapshot })
    assert.equal(list.at(-1).saved, true)
    const plain = await events(await fetch(`${base}/api/readings/narrate`, post(BODY)))
    assert.equal(plain.some((e) => e.type === 'market'), false)
  })
  assert.equal(calls.market, 1)
  assert.deepEqual(record.narration.market, snapshot)
  assert.equal(record.narration.text, '事情會順利。')
})

test('追問：先前的解讀與已寫好的回答以紀錄為準，前端送來的被忽略（v29 項目 6）', async () => {
  const followUps = [
    { question: '第一次', cards: [{ id: '64b000000000000000000004', orientation: 'upright' }] },
    { question: '第二次', cards: [{ id: '64b000000000000000000005', orientation: 'upright' }] },
  ]
  const record = fakeRecord({ narration: { text: '紀錄裡的解讀' }, followUpNarration: { text: '## 第一次\n紀錄裡的回答' } })
  const ai = fakeAi()
  await withServer(build({ ai, record }).app, async (base) => {
    const list = await events(
      await fetch(
        `${base}/api/readings/follow-up/narrate`,
        post({ ...BODY, followUps, narration: '前端塞的解讀', followUpText: '前端塞的回答', answeredRounds: 1, readingId: RECORD_ID }),
      ),
    )
    assert.equal(list[0].type, 'start')
    assert.equal(list.at(-1).type, 'done')
  })
  const options = ai.calls.followUp[0]
  assert.equal(options.previousNarration, '紀錄裡的解讀')
  assert.equal(options.answeredText.includes('前端塞的回答'), false)

  // 沒有紀錄（還沒保存）：才用前端送來的，並截短
  const ai2 = fakeAi()
  await withServer(build({ ai: ai2 }).app, async (base) => {
    await (await fetch(`${base}/api/readings/follow-up/narrate`, post({ ...BODY, followUps, narration: 'x'.repeat(9000) }))).text()
  })
  assert.equal(ai2.calls.followUp[0].previousNarration.length, 6000)
})

test('訪客限速（v29 項目 4）：抽牌、手動、追問抽牌、隨機牌共用一個額度；登入的人不受限', async () => {
  const limiter = createGuestLimiter({ limit: 3 })
  const guest = build({ loggedIn: false, guestLimiter: limiter })
  await withServer(guest.app, async (base) => {
    const statuses = []
    statuses.push((await fetch(`${base}/api/readings/draw`, post({ spreadKey: 'timeline' }))).status)
    statuses.push((await fetch(`${base}/api/cards/random`)).status)
    statuses.push((await fetch(`${base}/api/readings/manual`, post({ spreadKey: 'timeline', cards: DRAWN }))).status)
    statuses.push((await fetch(`${base}/api/readings/follow-up/draw`, post({ cards: DRAWN, question: '再問', count: 1 }))).status)
    assert.deepEqual(statuses, [200, 200, 200, 429])
    const limited = await fetch(`${base}/api/readings/draw`, post({ spreadKey: 'timeline' }))
    assert.equal((await limited.json()).message, '抽牌次數太多，請稍後再試。')
  })
  const member = build({ loggedIn: true, guestLimiter: createGuestLimiter({ limit: 1 }) })
  await withServer(member.app, async (base) => {
    for (let i = 0; i < 4; i += 1) assert.equal((await fetch(`${base}/api/readings/draw`, post({ spreadKey: 'timeline' }))).status, 200)
  })
})
