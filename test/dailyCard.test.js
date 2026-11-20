// 每日一牌與月曆（v26 計畫 1）：日期、連續天數、牌面內容，以及三支 API（假資料庫，不連 MongoDB）
const test = require('node:test')
const assert = require('node:assert')
const express = require('express')

const { taipeiDayKey, previousDay, monthRange, streakOf, dailyCardView } = require('../src/services/dailyCard')
const { createDailyCardRouter } = require('../src/routes/dailyCard')
const { USER_DATA_MODELS } = require('../src/services/accountDeletion')
const { signDailyClaim, verifyDailyClaim, signToken } = require('../src/lib/jwt')
const { createAuthMiddleware } = require('../src/middleware/auth')

const SECRET = 'daily-card-test-secret'

const OWNER = '507f1f77bcf86cd7994390aa'
const OTHER = '507f1f77bcf86cd7994390bb'
const FOOL = {
  _id: '507f1f77bcf86cd799439011',
  nameZh: '愚人',
  nameEn: 'The Fool',
  image: '/cards/fool.png',
  arcanaType: 'major',
  keywords: ['開始', '冒險', '自由', '天真', '信任', '多的'],
  sections: {
    正位牌義: ['核心訊息', '新的旅程正要開始。', '行動建議', '先踏出第一步。'],
    逆位牌義: ['核心警示', '衝動讓你忽略風險。', '調整建議', '出發前先確認路線。'],
  },
}

// ---- 純函式 ----

test('台北日期：UTC 16:00 已經是台北隔天', () => {
  assert.strictEqual(taipeiDayKey(new Date('2026-11-19T15:59:00Z')), '2026-11-19')
  assert.strictEqual(taipeiDayKey(new Date('2026-11-19T16:00:00Z')), '2026-11-20')
  assert.strictEqual(previousDay('2026-03-01'), '2026-02-28')
  assert.strictEqual(previousDay('2026-01-01'), '2025-12-31')
})

test('月份範圍：台北時間的月初到下個月初；格式錯回 null', () => {
  const range = monthRange('2026-11')
  assert.strictEqual(range.start.toISOString(), '2026-10-31T16:00:00.000Z')
  assert.strictEqual(range.end.toISOString(), '2026-11-30T16:00:00.000Z')
  assert.strictEqual(range.firstDay, '2026-11-01')
  assert.strictEqual(range.nextFirstDay, '2026-12-01')
  assert.strictEqual(monthRange('2026-12').nextFirstDay, '2027-01-01')
  for (const bad of ['2026-13', '2026-1', 'abc', '', undefined, '1999-01']) assert.strictEqual(monthRange(bad), null, String(bad))
})

test('連續天數：今天抽了從今天數，今天還沒抽從昨天數，中間斷了就停', () => {
  assert.strictEqual(streakOf(['2026-11-20', '2026-11-19', '2026-11-18'], '2026-11-20'), 3)
  assert.strictEqual(streakOf(['2026-11-19', '2026-11-18'], '2026-11-20'), 2)
  assert.strictEqual(streakOf(['2026-11-20', '2026-11-18'], '2026-11-20'), 1)
  assert.strictEqual(streakOf(['2026-11-17'], '2026-11-20'), 0)
  assert.strictEqual(streakOf([], '2026-11-20'), 0)
  // 跨月
  assert.strictEqual(streakOf(['2026-12-01', '2026-11-30'], '2026-12-01'), 2)
})

test('每日一牌的內容：核心訊息與行動建議的第一句；逆位用逆位牌義；關鍵詞最多 5 個', () => {
  const up = dailyCardView(FOOL, 'upright', '2026-11-20')
  assert.strictEqual(up.message, '新的旅程正要開始。')
  assert.strictEqual(up.advice, '先踏出第一步。')
  assert.strictEqual(up.card.keywords.length, 5)
  const down = dailyCardView(FOOL, 'reversed', '2026-11-20')
  assert.strictEqual(down.message, '衝動讓你忽略風險。')
  assert.strictEqual(down.advice, '出發前先確認路線。')
})

test('刪除帳號時一併刪除每日一牌', () => {
  assert.ok(USER_DATA_MODELS.includes('DailyCard'))
})

// ---- API（假資料庫）----

function query(result) {
  const q = {
    sort: () => q,
    limit: () => q,
    select: () => q,
    lean: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return q
}

function fakeModels({ dailyRows = [], readings = [], journals = [], cardMissing = false, losesRow = false } = {}) {
  const rows = [...dailyRows]
  const DailyCard = {
    rows,
    find(filter) {
      let result = rows.filter((row) => String(row.user) === String(filter.user))
      if (filter.date?.$gte) result = result.filter((row) => row.date >= filter.date.$gte && row.date < filter.date.$lt)
      return query(result.sort((a, b) => b.date.localeCompare(a.date)))
    },
    findOne(filter) {
      // losesRow：撞到唯一索引之後那筆又不見了（例如同時刪帳號）
      if (losesRow && rows.length) return query(null)
      return query(rows.find((row) => String(row.user) === String(filter.user) && row.date === filter.date) || null)
    },
    async create(doc) {
      if (losesRow || rows.some((row) => String(row.user) === String(doc.user) && row.date === doc.date)) {
        const error = new Error('duplicate')
        error.code = 11000
        throw error
      }
      rows.push(doc)
      return doc
    },
  }
  // cardMissing：牌庫重新匯入過，舊的 cardId 對不到
  const Card = {
    findById: () => query(cardMissing ? null : FOOL),
    find: () => query(cardMissing ? [] : [FOOL]),
  }
  const Reading = {
    find(filter) {
      return query(
        readings.filter(
          (reading) => String(reading.user) === String(filter.user) && reading.createdAt >= filter.createdAt.$gte && reading.createdAt < filter.createdAt.$lt,
        ),
      )
    },
  }
  const JournalEntry = {
    find(filter) {
      return query(
        journals.filter(
          (entry) =>
            String(entry.user) === String(filter.user) &&
            (!filter.targetKind || filter.targetKind.$in.includes(entry.targetKind)) &&
            entry.entryDate >= filter.entryDate.$gte &&
            entry.entryDate < filter.entryDate.$lt,
        ),
      )
    },
  }
  return { DailyCard, Card, Reading, JournalEntry }
}

function appWith(models, { clock = '2026-11-20T02:00:00Z', orientation = 'upright' } = {}) {
  const app = express()
  app.use(express.json())
  const fakeAuth = (required) => (req, res, next) => {
    const user = req.get('x-user')
    // 帶了 Authorization 卻驗證不過：optionalAuth 當訪客、requireAuth 回 401（和正式的中介層一樣）
    if (!user && required) {
      res.status(401).json({ message: '請先登入。' })
      return
    }
    req.auth = user ? { userId: user, role: 'member' } : null
    next()
  }
  app.use(
    '/api',
    createDailyCardRouter({
      ensureDatabase: () => true,
      requireAuth: fakeAuth(true),
      optionalAuth: fakeAuth(false),
      ...models,
      pickCard: async () => FOOL,
      randomOrientation: () => orientation,
      now: () => new Date(clock),
      signClaim: (data) => signDailyClaim(data, { secret: SECRET }),
      verifyClaim: (token) => verifyDailyClaim(token, { secret: SECRET }),
    }),
  )
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

test('抽牌：登入的存起來，同一天再抽回傳同一張（不能重抽）；連續天數包含今天', async () => {
  const models = fakeModels({ dailyRows: [{ user: OWNER, date: '2026-11-19', cardId: FOOL._id, orientation: 'upright' }] })
  await withServer(appWith(models), async (base) => {
    const first = await fetch(`${base}/api/daily-card/draw`, { method: 'POST', headers: { 'x-user': OWNER } })
    assert.strictEqual(first.status, 201)
    const body = await first.json()
    assert.strictEqual(body.saved, true)
    assert.strictEqual(body.alreadyDrawn, false)
    assert.strictEqual(body.today, '2026-11-20')
    assert.strictEqual(body.dailyCard.card.nameZh, '愚人')
    assert.strictEqual(body.streak, 2)

    const again = await (await fetch(`${base}/api/daily-card/draw`, { method: 'POST', headers: { 'x-user': OWNER } })).json()
    assert.strictEqual(again.alreadyDrawn, true)
    assert.strictEqual(models.DailyCard.rows.filter((row) => row.date === '2026-11-20').length, 1)

    const today = await (await fetch(`${base}/api/daily-card/today`, { headers: { 'x-user': OWNER } })).json()
    assert.strictEqual(today.dailyCard.card.nameZh, '愚人')
  })
})

test('抽牌：同時送兩次也只存一張（唯一索引擋下第二次，回傳已存的）', async () => {
  const models = fakeModels()
  await withServer(appWith(models), async (base) => {
    const results = await Promise.all([1, 2].map(() => fetch(`${base}/api/daily-card/draw`, { method: 'POST', headers: { 'x-user': OWNER } })))
    assert.ok(results.every((r) => r.ok))
    assert.strictEqual(models.DailyCard.rows.length, 1)
  })
})

test('抽牌：訪客可以抽，但不存、不進月曆', async () => {
  const models = fakeModels()
  await withServer(appWith(models, { orientation: 'reversed' }), async (base) => {
    const body = await (await fetch(`${base}/api/daily-card/draw`, { method: 'POST' })).json()
    assert.strictEqual(body.saved, false)
    assert.strictEqual(body.dailyCard.orientation, 'reversed')
    assert.strictEqual(models.DailyCard.rows.length, 0)
    assert.strictEqual((await fetch(`${base}/api/daily-card/today`)).status, 401)
  })
})

test('月曆：只回自己的資料，依台北日期分組；月份格式錯回 400', async () => {
  const models = fakeModels({
    dailyRows: [
      { user: OWNER, date: '2026-11-03', cardId: FOOL._id, orientation: 'reversed' },
      { user: OTHER, date: '2026-11-04', cardId: FOOL._id, orientation: 'upright' },
      { user: OWNER, date: '2026-10-31', cardId: FOOL._id, orientation: 'upright' },
    ],
    readings: [
      // 台北 11/3 23:30（UTC 15:30）算 11/3；台北 11/4 00:30（UTC 11/3 16:30）算 11/4
      { _id: 'r1', user: OWNER, question: '他會回來嗎', spreadName: '時間之流', createdAt: new Date('2026-11-03T15:30:00Z'), cards: [{ nameZh: '愚人', orientation: 'reversed' }] },
      { _id: 'r2', user: OWNER, question: '', spreadName: '自選牌', createdAt: new Date('2026-11-03T16:30:00Z'), cards: [] },
      { _id: 'r3', user: OTHER, question: '別人的', spreadName: '', createdAt: new Date('2026-11-05T02:00:00Z'), cards: [] },
    ],
  })
  await withServer(appWith(models), async (base) => {
    const body = await (await fetch(`${base}/api/calendar?month=2026-11`, { headers: { 'x-user': OWNER } })).json()
    assert.strictEqual(body.month, '2026-11')
    assert.deepStrictEqual(
      body.days.map((day) => day.date),
      ['2026-11-03', '2026-11-04'],
    )
    const nov3 = body.days[0]
    const { detail, ...summary } = nov3.dailyCard
    assert.deepStrictEqual(summary, { nameZh: '愚人', image: '/cards/fool.png', orientation: 'reversed' })
    // 點月曆上的牌看的內容：和今天的牌同一個格式，含牌義
    assert.strictEqual(detail.date, '2026-11-03')
    assert.strictEqual(detail.orientation, 'reversed')
    assert.strictEqual(detail.card.nameZh, '愚人')
    assert.ok(detail.message)
    assert.deepStrictEqual(nov3.readings.map((r) => [r.id, r.question, r.cards]), [['r1', '他會回來嗎', ['愚人逆']]])
    assert.strictEqual(body.days[1].dailyCard, null)
    assert.strictEqual(body.days[1].readings[0].id, 'r2')
    assert.ok(!JSON.stringify(body).includes('別人的'))

    assert.strictEqual((await fetch(`${base}/api/calendar?month=2026-13`, { headers: { 'x-user': OWNER } })).status, 400)
    assert.strictEqual((await fetch(`${base}/api/calendar?month=2026-11`)).status, 401)
  })
})

test('抽牌：帶了 token 卻驗證不過時回 401，不當成訪客抽一張不存的牌（api-reviewer）', async () => {
  const models = fakeModels()
  await withServer(appWith(models), async (base) => {
    const res = await fetch(`${base}/api/daily-card/draw`, { method: 'POST', headers: { Authorization: 'Bearer expired' } })
    assert.strictEqual(res.status, 401)
    assert.strictEqual(models.DailyCard.rows.length, 0)
  })
})

test('牌庫重新匯入、cardId 對不到時，今天的牌與月曆用存下來的快照（api-reviewer）', async () => {
  const models = fakeModels({
    cardMissing: true,
    dailyRows: [{ user: OWNER, date: '2026-11-20', cardId: 'old-id', orientation: 'reversed', nameZh: '愚人', nameEn: 'The Fool', image: '/cards/fool.png' }],
  })
  await withServer(appWith(models), async (base) => {
    const today = await (await fetch(`${base}/api/daily-card/today`, { headers: { 'x-user': OWNER } })).json()
    assert.strictEqual(today.dailyCard.card.nameZh, '愚人')
    assert.strictEqual(today.dailyCard.orientation, 'reversed')
    const again = await (await fetch(`${base}/api/daily-card/draw`, { method: 'POST', headers: { 'x-user': OWNER } })).json()
    assert.strictEqual(again.alreadyDrawn, true)
    assert.strictEqual(again.dailyCard.card.nameZh, '愚人')
    const calendar = await (await fetch(`${base}/api/calendar?month=2026-11`, { headers: { 'x-user': OWNER } })).json()
    const { detail, ...summary } = calendar.days[0].dailyCard
    assert.deepStrictEqual(summary, { nameZh: '愚人', image: '/cards/fool.png', orientation: 'reversed' })
    assert.strictEqual(detail.card.nameEn, 'The Fool')
    assert.strictEqual(detail.message, '')
  })
})

test('抽牌：存新牌時連牌名與圖片快照一起存', async () => {
  const models = fakeModels()
  await withServer(appWith(models), async (base) => {
    await fetch(`${base}/api/daily-card/draw`, { method: 'POST', headers: { 'x-user': OWNER } })
    assert.strictEqual(models.DailyCard.rows[0].nameZh, '愚人')
    assert.strictEqual(models.DailyCard.rows[0].image, '/cards/fool.png')
  })
})

test('抽牌：撞到唯一索引之後查不到已存的那筆，回 409 而不是空的牌（api-reviewer）', async () => {
  const models = fakeModels({ losesRow: true, dailyRows: [{ user: OTHER, date: '2026-01-01', cardId: FOOL._id, orientation: 'upright' }] })
  await withServer(appWith(models), async (base) => {
    const res = await fetch(`${base}/api/daily-card/draw`, { method: 'POST', headers: { 'x-user': OWNER } })
    assert.strictEqual(res.status, 409)
  })
})

// ---- 訪客抽的牌：登入或註冊後存進月曆 ----

const post = (base, path, { user, body } = {}) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(user ? { 'x-user': user } : {}) }, body: body ? JSON.stringify(body) : undefined })

test('訪客抽牌拿到領取憑證；登入後用它把同一張牌存進今天的月曆', async () => {
  const models = fakeModels()
  await withServer(appWith(models, { orientation: 'reversed' }), async (base) => {
    const guest = await (await post(base, '/api/daily-card/draw')).json()
    assert.strictEqual(guest.saved, false)
    assert.ok(guest.claim)
    const res = await post(base, '/api/daily-card/claim', { user: OWNER, body: { claim: guest.claim } })
    assert.strictEqual(res.status, 201)
    const body = await res.json()
    assert.strictEqual(body.claimed, true)
    assert.strictEqual(body.dailyCard.orientation, 'reversed')
    assert.strictEqual(models.DailyCard.rows.length, 1)
    assert.strictEqual(models.DailyCard.rows[0].orientation, 'reversed')
    assert.strictEqual(models.DailyCard.rows[0].nameZh, '愚人')
  })
})

test('領取：今天已經抽過（別的裝置）就以已存的為準，不覆蓋', async () => {
  const models = fakeModels({ dailyRows: [{ user: OWNER, date: '2026-11-20', cardId: FOOL._id, orientation: 'upright', nameZh: '愚人' }] })
  await withServer(appWith(models, { orientation: 'reversed' }), async (base) => {
    const guest = await (await post(base, '/api/daily-card/draw')).json()
    const body = await (await post(base, '/api/daily-card/claim', { user: OWNER, body: { claim: guest.claim } })).json()
    assert.strictEqual(body.claimed, false)
    assert.strictEqual(body.alreadyDrawn, true)
    assert.strictEqual(body.dailyCard.orientation, 'upright')
    assert.strictEqual(models.DailyCard.rows.length, 1)
  })
})

test('領取：竄改或亂寫的憑證回 400；昨天抽的回 409；沒登入回 401', async () => {
  const models = fakeModels()
  // 前端自己挑一張牌、自己簽（不知道密鑰）
  const forged = signDailyClaim({ date: '2026-11-20', cardId: FOOL._id, orientation: 'upright' }, { secret: 'not-the-secret' })
  const yesterday = signDailyClaim({ date: '2026-11-19', cardId: FOOL._id, orientation: 'upright' }, { secret: SECRET })
  await withServer(appWith(models), async (base) => {
    assert.strictEqual((await post(base, '/api/daily-card/claim', { user: OWNER, body: { claim: forged } })).status, 400)
    assert.strictEqual((await post(base, '/api/daily-card/claim', { user: OWNER, body: { claim: 'abc' } })).status, 400)
    assert.strictEqual((await post(base, '/api/daily-card/claim', { user: OWNER, body: {} })).status, 400)
    assert.strictEqual((await post(base, '/api/daily-card/claim', { user: OWNER, body: { claim: yesterday } })).status, 409)
    const guest = await (await post(base, '/api/daily-card/draw')).json()
    assert.strictEqual((await post(base, '/api/daily-card/claim', { body: { claim: guest.claim } })).status, 401)
    assert.strictEqual(models.DailyCard.rows.length, 0)
  })
})

test('領取憑證不能當登入 token，登入 token 也不能當領取憑證', async () => {
  const claim = signDailyClaim({ date: '2026-11-20', cardId: FOOL._id, orientation: 'upright' }, { secret: SECRET })
  const login = signToken({ id: OWNER, role: 'member', tokenVersion: 0 }, { secret: SECRET })
  assert.strictEqual(verifyDailyClaim(login, { secret: SECRET }), null)
  assert.ok(verifyDailyClaim(claim, { secret: SECRET }))
  const { optionalAuth } = createAuthMiddleware({ secret: SECRET, findUserById: async (id) => ({ _id: id, role: 'member', tokenVersion: 0 }) })
  const req = { headers: { authorization: `Bearer ${claim}` } }
  await new Promise((resolve) => optionalAuth(req, {}, resolve))
  assert.strictEqual(req.auth, null)
  const okReq = { headers: { authorization: `Bearer ${login}` } }
  await new Promise((resolve) => optionalAuth(okReq, {}, resolve))
  assert.strictEqual(okReq.auth?.userId, OWNER)
})

test('訪客抽牌每 IP 每分鐘 30 次，超過回 429；登入的人不受這個限制（api-reviewer）', async () => {
  const models = fakeModels()
  await withServer(appWith(models), async (base) => {
    const statuses = []
    for (let i = 0; i < 31; i += 1) statuses.push((await post(base, '/api/daily-card/draw')).status)
    assert.strictEqual(statuses.filter((s) => s === 200).length, 30)
    assert.strictEqual(statuses.at(-1), 429)
    assert.strictEqual((await post(base, '/api/daily-card/draw', { user: OWNER })).status, 201)
  })
})

test('領取憑證：日期、牌 id、正逆位格式不對的一律當無效（回 400，不會存檔時才 500）', () => {
  const ok = { date: '2026-11-20', cardId: FOOL._id, orientation: 'upright' }
  assert.ok(verifyDailyClaim(signDailyClaim(ok, { secret: SECRET }), { secret: SECRET }))
  for (const bad of [{ ...ok, orientation: 'sideways' }, { ...ok, cardId: 'not-an-id' }, { ...ok, date: '2026/11/20' }]) {
    assert.strictEqual(verifyDailyClaim(signDailyClaim(bad, { secret: SECRET }), { secret: SECRET }), null, JSON.stringify(bad))
  }
})

test('月曆：當天寫的日記依日記的日期放，只看得到自己的；每日一牌的舊日記不列（v26 計畫 2）', async () => {
  const models = fakeModels({
    journals: [
      { _id: 'j1', user: OWNER, targetKind: 'reading', targetId: 'abc', text: '後來真的聯絡了', outcome: 'hit', entryDate: '2026-11-18' },
      { _id: 'j2', user: OWNER, targetKind: 'daily', targetId: '2026-11-18', text: '', outcome: null, entryDate: '2026-11-18' },
      { _id: 'j3', user: OTHER, targetKind: 'daily', targetId: '2026-11-18', text: '別人的日記', outcome: null, entryDate: '2026-11-18' },
      { _id: 'j4', user: OWNER, targetKind: 'daily', targetId: '2026-10-31', text: '上個月', outcome: null, entryDate: '2026-10-31' },
    ],
  })
  await withServer(appWith(models), async (base) => {
    const body = await (await fetch(`${base}/api/calendar?month=2026-11`, { headers: { 'x-user': OWNER } })).json()
    assert.deepStrictEqual(body.days.map((day) => day.date), ['2026-11-18'])
    assert.deepStrictEqual(body.days[0].journals, [
      { id: 'j1', target: 'reading:abc', title: '', text: '後來真的聯絡了', outcome: 'hit' },
    ])
    assert.ok(!JSON.stringify(body).includes('別人的日記'))
  })
})
