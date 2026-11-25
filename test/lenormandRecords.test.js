// 雷諾曼紀錄（v27 階段 6）：保存、列表、詳情、刪除（連同日記）、只看自己的、上限 100 筆、月曆 deck、日記 target、刪帳號
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const LenormandReading = require('../src/models/LenormandReading')
const { MAX_LENORMAND_READINGS_PER_USER } = LenormandReading
const { createLenormandRouter } = require('../src/routes/lenormand')
const { createDailyCardRouter } = require('../src/routes/dailyCard')
const { createJournalRouter } = require('../src/routes/journal')
const { USER_DATA_MODELS } = require('../src/services/accountDeletion')
const JournalEntry = require('../src/models/JournalEntry')

const OWNER = '507f1f77bcf86cd799439011'
const OTHER = '507f1f77bcf86cd799439012'

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

// 查詢物件：可以接 sort／skip／limit／select／lean，也可以直接 await
function query(rows, single = false) {
  const state = { skip: 0, limit: Infinity, sort: null }
  const run = () => {
    let list = Array.isArray(rows) ? [...rows] : rows
    if (single) return list
    if (state.sort) list.sort((a, b) => b.createdAt - a.createdAt || String(b._id).localeCompare(String(a._id)))
    return list.slice(state.skip, state.skip + state.limit)
  }
  const q = {
    sort: (spec) => ((state.sort = spec), q),
    skip: (n) => ((state.skip = n), q),
    limit: (n) => ((state.limit = n), q),
    select: () => q,
    lean: () => q,
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  }
  return q
}

function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === 'createdAt') return doc.createdAt >= value.$gte && doc.createdAt < value.$lt
    if (value && typeof value === 'object' && Array.isArray(value.$in)) return value.$in.map(String).includes(String(doc[key]))
    return String(doc[key]) === String(value)
  })
}

// 用真的 mongoose model 建文件（會跑 schema 驗證、有 toSummaryJSON），存在記憶體
function fakeLenormandReadings() {
  const rows = []
  let clock = Date.UTC(2026, 10, 25, 0, 0, 0)
  return {
    rows,
    async create(data) {
      const doc = new LenormandReading(data)
      await doc.validate()
      doc.createdAt = new Date(clock)
      clock += 1000
      rows.push(doc)
      return doc
    },
    countDocuments: async (filter) => rows.filter((doc) => matches(doc, filter)).length,
    find: (filter) => query(rows.filter((doc) => matches(doc, filter))),
    findOne: (filter) => query(rows.find((doc) => matches(doc, filter)) || null, true),
    async deleteOne(filter) {
      const index = rows.findIndex((doc) => matches(doc, filter))
      if (index < 0) return { deletedCount: 0 }
      rows.splice(index, 1)
      return { deletedCount: 1 }
    },
    async deleteMany(filter) {
      const before = rows.length
      for (let i = rows.length - 1; i >= 0; i -= 1) if (matches(rows[i], filter)) rows.splice(i, 1)
      return { deletedCount: before - rows.length }
    },
  }
}

function fakeJournal() {
  const calls = []
  return { calls, deleteMany: async (filter) => (calls.push(filter), { deletedCount: 1 }) }
}

function recordsApp({ readings = fakeLenormandReadings(), journal = fakeJournal() } = {}) {
  const app = express()
  app.use(express.json())
  const auth = (req, res, next) => {
    const user = req.get('x-user')
    if (!user) return res.status(401).json({ message: '請先登入。' })
    req.auth = { userId: user, role: 'member' }
    next()
  }
  app.use('/api/lenormand', createLenormandRouter({ requireLenormandAccess: auth, LenormandReading: readings, JournalEntry: journal }))
  return { app, readings, journal }
}

const as = (user, method = 'GET', body) => ({
  method,
  headers: { 'x-user': user, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
})

test('保存 → 列表 → 詳情（重算分析，形狀同 draw）→ 刪除（連同日記）', async () => {
  const { app, journal } = recordsApp()
  await withServer(app, async (base) => {
    const saved = await fetch(`${base}/api/lenormand/readings`, as(OWNER, 'POST', { question: '他喜歡我嗎', spreadKey: 'theme-3', significator: 29, cards: [1, 24, 25], mode: 'draw', analysis: 'fake' }))
    assert.equal(saved.status, 201)
    const { id, createdAt } = await saved.json()
    assert.match(id, /^[a-f0-9]{24}$/)
    assert.ok(createdAt)

    const list = await (await fetch(`${base}/api/lenormand/readings`, as(OWNER))).json()
    assert.equal(list.total, 1)
    assert.deepEqual(list.readings[0], {
      id,
      question: '他喜歡我嗎',
      domain: null,
      spreadKey: 'theme-3',
      spreadName: '三張主題牌',
      significator: 29,
      cardCount: 3,
      cards: [
        { id: 1, nameZh: '騎士' },
        { id: 24, nameZh: '愛心' },
        { id: 25, nameZh: '戒指' },
      ],
      hasNarration: false,
      createdAt: list.readings[0].createdAt,
    })

    const detail = await (await fetch(`${base}/api/lenormand/readings/${id}`, as(OWNER))).json()
    assert.equal(detail.id, id)
    assert.equal(detail.mode, 'draw')
    assert.equal(detail.deck, 'lenormand')
    assert.equal(detail.narration, null)
    assert.deepEqual(
      detail.cards.map((c) => c.card.id),
      [1, 24, 25],
    )
    assert.ok(detail.analysis.combos.some((c) => c.id === 'ring-heart'))
    assert.equal(detail.analysis.domain.key, 'love')
    assert.ok(detail.text.sections.length > 0)

    assert.equal((await fetch(`${base}/api/lenormand/readings/${id}`, as(OWNER, 'DELETE'))).status, 200)
    assert.deepEqual(journal.calls, [{ user: OWNER, targetKind: 'lenormand', targetId: id }])
    assert.equal((await fetch(`${base}/api/lenormand/readings/${id}`, as(OWNER))).status, 404)
    assert.equal((await (await fetch(`${base}/api/lenormand/readings`, as(OWNER))).json()).total, 0)
  })
})

test('只看得到、刪得到自己的；id 格式不對一律 404', async () => {
  const { app } = recordsApp()
  await withServer(app, async (base) => {
    const { id } = await (await fetch(`${base}/api/lenormand/readings`, as(OWNER, 'POST', { spreadKey: 'timeline-3', cards: [8, 1, 31] }))).json()
    assert.equal((await fetch(`${base}/api/lenormand/readings/${id}`, as(OTHER))).status, 404)
    assert.equal((await fetch(`${base}/api/lenormand/readings/${id}`, as(OTHER, 'DELETE'))).status, 404)
    assert.equal((await (await fetch(`${base}/api/lenormand/readings`, as(OTHER))).json()).total, 0)
    for (const bad of ['abc', '507f1f77bcf8', `${id}0`, 'draw']) {
      assert.equal((await fetch(`${base}/api/lenormand/readings/${bad}`, as(OWNER))).status, 404, bad)
      assert.equal((await fetch(`${base}/api/lenormand/readings/${bad}`, as(OWNER, 'DELETE'))).status, 404, bad)
    }
    // 自己的仍然找得到
    assert.equal((await fetch(`${base}/api/lenormand/readings/${id}`, as(OWNER))).status, 200)
  })
})

test('保存的驗證：和抽牌一樣（大藍圖 36 張＋代表牌、牌號、張數）、抽牌方式、AI 解讀長度', async () => {
  const { app, readings } = recordsApp()
  const ids36 = Array.from({ length: 36 }, (_, i) => i + 17)
  await withServer(app, async (base) => {
    const post = (body) => fetch(`${base}/api/lenormand/readings`, as(OWNER, 'POST', body))
    assert.equal((await post({ spreadKey: 'grand-tableau', significator: 28, cards: ids36 })).status, 201)
    assert.equal((await post({ spreadKey: 'grand-tableau', significator: 28, cards: ids36.slice(1) })).status, 400)
    assert.equal((await post({ spreadKey: 'grand-tableau', cards: ids36 })).status, 400)
    assert.equal((await post({ spreadKey: 'theme-3', cards: [1, 1, 2] })).status, 400)
    assert.equal((await post({ spreadKey: 'theme-3', cards: [1, 2, 53] })).status, 400)
    assert.equal((await post({ spreadKey: 'theme-3', cards: [1, 2, 3], mode: 'auto' })).status, 400)
    assert.equal((await post({ spreadKey: 'theme-3', cards: [1, 2, 3], domain: 'stock' })).status, 400)
    assert.equal((await post({ spreadKey: 'theme-3', cards: [1, 2, 3], narration: { text: 'x'.repeat(20001) } })).status, 400)
    assert.equal((await post({ spreadKey: 'theme-3', cards: [1, 2, 3], question: 'x'.repeat(501) })).status, 400)
    // 前端自帶的 checks 不收，由後端自己算（「正位」→ orientation）
    const withAi = await post({ spreadKey: 'theme-3', cards: [1, 2, 3], narration: { text: '解讀內容，騎士正位', model: 'm', checks: ['fake'] } })
    assert.equal(withAi.status, 201)
    const { id } = await withAi.json()
    const detail = await (await fetch(`${base}/api/lenormand/readings/${id}`, as(OWNER))).json()
    assert.equal(detail.narration.text, '解讀內容，騎士正位')
    assert.deepEqual(detail.narration.checks, ['orientation'])
    assert.equal(detail.mode, 'manual')
    assert.equal((await (await fetch(`${base}/api/lenormand/readings`, as(OWNER))).json()).readings[0].hasNarration, true)
  })
  // 大藍圖列表只列前 5 張牌名
  const grand = readings.rows.find((doc) => doc.spreadKey === 'grand-tableau')
  const summary = grand.toSummaryJSON(require('../src/data/lenormand/cards').cardById)
  assert.equal(summary.cardCount, 36)
  assert.equal(summary.cards.length, 5)
})

test('每人最多 100 筆：超過從最舊的刪，連同它們的日記；別人的不受影響', async () => {
  const { app, readings, journal } = recordsApp()
  await withServer(app, async (base) => {
    const first = await (await fetch(`${base}/api/lenormand/readings`, as(OWNER, 'POST', { spreadKey: 'theme-3', cards: [1, 2, 3] }))).json()
    await fetch(`${base}/api/lenormand/readings`, as(OTHER, 'POST', { spreadKey: 'theme-3', cards: [1, 2, 3] }))
    for (let i = 0; i < MAX_LENORMAND_READINGS_PER_USER; i += 1) {
      await fetch(`${base}/api/lenormand/readings`, as(OWNER, 'POST', { spreadKey: 'theme-3', cards: [4, 5, 6] }))
    }
  })
  assert.equal(readings.rows.filter((doc) => String(doc.user) === OWNER).length, MAX_LENORMAND_READINGS_PER_USER)
  assert.equal(readings.rows.filter((doc) => String(doc.user) === OTHER).length, 1)
  assert.ok(readings.rows.every((doc) => !(String(doc.user) === OWNER && doc.cards[0] === 1)), '最舊那筆應該被刪')
  const trimCall = journal.calls.find((call) => call.targetKind === 'lenormand' && call.targetId?.$in)
  assert.ok(trimCall)
  assert.equal(trimCall.targetId.$in.length, 1)
})

test('刪除紀錄只要登入：被收回雷諾曼權限的人刪得掉自己的，其他端點仍 403；別人的仍 404', async () => {
  const readings = fakeLenormandReadings()
  const journal = fakeJournal()
  const mine = await readings.create({ user: OWNER, spreadKey: 'theme-3', cards: [1, 2, 3] })
  const theirs = await readings.create({ user: OTHER, spreadKey: 'theme-3', cards: [1, 2, 3] })
  const app = express()
  const requireAuth = (req, res, next) => {
    const user = req.get('x-user')
    if (!user) return res.status(401).json({ message: '請先登入。' })
    req.auth = { userId: user, role: 'member' }
    next()
  }
  // 權限被收回：守門一律 403
  const denied = (_req, res) => res.status(403).json({ message: '雷諾曼功能需要管理者開通，請聯絡管理者。' })
  app.use('/api/lenormand', createLenormandRouter({ requireLenormandAccess: denied, requireAuth, LenormandReading: readings, JournalEntry: journal }))
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/lenormand/readings/${mine._id}`, as(OWNER))).status, 403)
    assert.equal((await fetch(`${base}/api/lenormand/readings`, as(OWNER))).status, 403)
    assert.equal((await fetch(`${base}/api/lenormand/readings/${mine._id}`, { method: 'DELETE' })).status, 401)
    assert.equal((await fetch(`${base}/api/lenormand/readings/${theirs._id}`, as(OWNER, 'DELETE'))).status, 404)
    assert.equal((await fetch(`${base}/api/lenormand/readings/${mine._id}`, as(OWNER, 'DELETE'))).status, 200)
  })
  assert.deepEqual(
    readings.rows.map((doc) => String(doc.user)),
    [OTHER],
  )
  assert.deepEqual(journal.calls, [{ user: OWNER, targetKind: 'lenormand', targetId: String(mine._id) }])
})

test('LenormandReading schema：牌號範圍、重複、牌陣與代表牌的 enum', async () => {
  const ok = new LenormandReading({ user: OWNER, spreadKey: 'theme-3', cards: [1, 2, 3] })
  await ok.validate()
  await assert.rejects(new LenormandReading({ user: OWNER, spreadKey: 'theme-3', cards: [1, 1, 2] }).validate())
  await assert.rejects(new LenormandReading({ user: OWNER, spreadKey: 'theme-3', cards: [0, 1, 2] }).validate())
  await assert.rejects(new LenormandReading({ user: OWNER, spreadKey: 'nope', cards: [1, 2, 3] }).validate())
  await assert.rejects(new LenormandReading({ user: OWNER, spreadKey: 'theme-3', cards: [1, 2, 3], significator: 27 }).validate())
  await assert.rejects(new LenormandReading({ user: OWNER, spreadKey: 'theme-3', cards: [1, 2, 3], domain: 'stock' }).validate())
  assert.deepEqual(LenormandReading.schema.indexes().map(([fields]) => fields), [{ user: 1, createdAt: -1 }])
})

// ---- 月曆 ----

function calendarApp({ lenormandRows, user }) {
  const empty = { find: () => query([]), findOne: () => query(null, true) }
  const tarot = [{ _id: 't1', user: OWNER, question: '塔羅的', spreadName: '時間之流', createdAt: new Date('2026-11-25T03:00:00Z'), cards: [{ nameZh: '愚人', orientation: 'reversed' }] }]
  const journals = [
    { _id: 'j1', user: OWNER, targetKind: 'lenormand', targetId: 'abc', title: '雷諾曼日記', text: '', outcome: null, entryDate: '2026-11-25' },
    { _id: 'j2', user: OWNER, targetKind: 'reading', targetId: 't1', title: '塔羅日記', text: '', outcome: null, entryDate: '2026-11-25' },
  ]
  const app = express()
  const auth = (req, _res, next) => {
    req.auth = { userId: OWNER, role: user.role }
    req.user = user
    next()
  }
  app.use(
    '/api',
    createDailyCardRouter({
      ensureDatabase: () => true,
      requireAuth: auth,
      optionalAuth: auth,
      DailyCard: empty,
      Card: { find: () => query([]), findById: () => query(null, true) },
      Reading: { find: (filter) => query(tarot.filter((doc) => matches(doc, filter))) },
      JournalEntry: { find: (filter) => query(journals.filter((doc) => doc.entryDate >= filter.entryDate.$gte && filter.targetKind.$in.includes(doc.targetKind))) },
      LenormandReading: { find: (filter) => query(lenormandRows.filter((doc) => matches(doc, filter))) },
      now: () => new Date('2026-11-25T08:00:00Z'),
    }),
  )
  return app
}

test('月曆：每筆帶 deck，塔羅與雷諾曼依時間混排；沒有雷諾曼權限的人不列雷諾曼紀錄與日記', async () => {
  const lenormandRows = [
    { _id: 'l1', user: OWNER, question: '雷諾曼的', spreadName: '三張主題牌', createdAt: new Date('2026-11-25T05:00:00Z'), cards: [1, 24, 25] },
    { _id: 'l2', user: OWNER, question: '大藍圖', spreadName: '三十六宮位大藍圖', createdAt: new Date('2026-11-25T01:00:00Z'), cards: Array.from({ length: 36 }, (_, i) => i + 1) },
  ]
  const granted = { role: 'member', lenormandAccess: true, canUseLenormand: () => true }
  await withServer(calendarApp({ lenormandRows, user: granted }), async (base) => {
    const body = await (await fetch(`${base}/api/calendar?month=2026-11`)).json()
    const day = body.days.find((d) => d.date === '2026-11-25')
    assert.deepEqual(
      day.readings.map((r) => [r.id, r.deck]),
      [
        ['l1', 'lenormand'],
        ['t1', 'tarot'],
        ['l2', 'lenormand'],
      ],
    )
    assert.deepEqual(day.readings[0].cards, ['騎士', '愛心', '戒指'])
    assert.equal(day.readings[2].cards.length, 5)
    assert.deepEqual(day.readings[1].cards, ['愚人逆'])
    assert.deepEqual(
      day.journals.map((j) => j.target).sort(),
      ['lenormand:abc', 'reading:t1'],
    )
  })
  const revoked = { role: 'member', lenormandAccess: false, canUseLenormand: () => false }
  await withServer(calendarApp({ lenormandRows, user: revoked }), async (base) => {
    const body = await (await fetch(`${base}/api/calendar?month=2026-11`)).json()
    const day = body.days.find((d) => d.date === '2026-11-25')
    assert.deepEqual(
      day.readings.map((r) => r.deck),
      ['tarot'],
    )
    assert.deepEqual(
      day.journals.map((j) => j.target),
      ['reading:t1'],
    )
  })
})

// ---- 日記 ----

function journalApp({ user }) {
  const entries = []
  let next = 1
  const match = (row, filter) => Object.entries(filter).every(([key, value]) => String(row[key]) === String(value))
  const Journal = {
    entries,
    find: (filter) => query(entries.filter((row) => match(row, filter))),
    findOne: (filter) => {
      const row = entries.find((r) => match(r, filter))
      return Promise.resolve(row ? Object.assign(row, { markModified() {}, async save() {} }) : null)
    },
    countDocuments: async (filter) => entries.filter((row) => match(row, filter)).length,
    create: async (data) => {
      const row = { _id: `5f00000000000000000000${String(next++).padStart(2, '0')}`, createdAt: new Date(), updatedAt: new Date(), ...data }
      entries.push(row)
      return row
    },
    deleteOne: async (filter) => {
      const index = entries.findIndex((row) => match(row, filter))
      if (index < 0) return { deletedCount: 0 }
      entries.splice(index, 1)
      return { deletedCount: 1 }
    },
  }
  const MINE = 'aaaaaaaaaaaaaaaaaaaaaaaa'
  const THEIRS = 'bbbbbbbbbbbbbbbbbbbbbbbb'
  const LenormandReadingFake = {
    findOne: (filter) => query(filter._id === MINE && String(filter.user) === OWNER ? { _id: MINE } : null, true),
  }
  const app = express()
  app.use(express.json())
  const auth = (req, _res, nextFn) => {
    req.auth = { userId: OWNER }
    req.user = user
    nextFn()
  }
  app.use(
    '/api',
    createJournalRouter({
      ensureDatabase: () => true,
      requireAuth: auth,
      JournalEntry: Journal,
      Reading: { findOne: () => query(null, true) },
      LenormandReading: LenormandReadingFake,
      MarketAnalysis: { find: () => query([]) },
      MarketWatch: { find: () => query([]) },
      writeLimiter: (_req, _res, nextFn) => nextFn(),
      now: () => new Date('2026-11-25T02:00:00Z'),
    }),
  )
  return { app, Journal, MINE, THEIRS }
}

const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

test('日記：lenormand:<id> 要是本人的紀錄；沒有雷諾曼權限時列表、新增、修改 403，刪除可以', async () => {
  const granted = { role: 'member', canUseLenormand: () => true }
  const { app, Journal, MINE, THEIRS } = journalApp({ user: granted })
  await withServer(app, async (base) => {
    const post = (target) =>
      fetch(`${base}/api/journal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, content: doc('後來真的聯絡了') }) })
    const created = await post(`lenormand:${MINE}`)
    assert.equal(created.status, 201)
    assert.equal((await created.json()).entry.target, `lenormand:${MINE}`)
    assert.equal((await post(`lenormand:${THEIRS}`)).status, 404)
    assert.equal((await post('lenormand:abc')).status, 400)
    const list = await (await fetch(`${base}/api/journal?target=lenormand:${MINE}`)).json()
    assert.equal(list.entries.length, 1)
  })

  // 被收回權限：列表、新增、修改 403；刪除自己的日記仍可以
  const revoked = { role: 'member', canUseLenormand: () => false }
  const second = journalApp({ user: revoked })
  second.Journal.entries.push({ _id: '5f0000000000000000000099', user: OWNER, targetKind: 'lenormand', targetId: second.MINE, title: '', content: doc('x'), text: 'x', outcome: null, entryDate: '2026-11-25', createdAt: new Date(), updatedAt: new Date() })
  await withServer(second.app, async (base) => {
    const denied = await fetch(`${base}/api/journal?target=lenormand:${second.MINE}`)
    assert.equal(denied.status, 403)
    assert.equal((await denied.json()).message, '雷諾曼功能需要管理者開通，請聯絡管理者。')
    const post = await fetch(`${base}/api/journal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: `lenormand:${second.MINE}`, content: doc('y') }) })
    assert.equal(post.status, 403)
    const put = await fetch(`${base}/api/journal/5f0000000000000000000099`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '改' }) })
    assert.equal(put.status, 403)
    assert.equal((await fetch(`${base}/api/journal/5f0000000000000000000099`, { method: 'DELETE' })).status, 200)
  })
  assert.ok(JournalEntry.TARGET_KINDS.includes('lenormand'))
})

test('刪除帳號：LenormandReading 在清單裡', () => {
  assert.ok(USER_DATA_MODELS.includes('LenormandReading'))
})

test('我的雷諾曼資料：只要登入就能查與全部刪除（被收回權限也可以），只動自己的', async () => {
  const readings = fakeLenormandReadings()
  await readings.create({ user: OWNER, spreadKey: 'theme-3', cards: [1, 2, 3] })
  await readings.create({ user: OWNER, spreadKey: 'timeline-3', cards: [4, 5, 6] })
  await readings.create({ user: OTHER, spreadKey: 'theme-3', cards: [1, 2, 3] })
  const journalRows = [
    { user: OWNER, targetKind: 'lenormand' },
    { user: OWNER, targetKind: 'reading' },
    { user: OTHER, targetKind: 'lenormand' },
  ]
  const journal = {
    countDocuments: async (filter) => journalRows.filter((row) => matches(row, filter)).length,
    async deleteMany(filter) {
      const before = journalRows.length
      for (let i = journalRows.length - 1; i >= 0; i -= 1) if (matches(journalRows[i], filter)) journalRows.splice(i, 1)
      return { deletedCount: before - journalRows.length }
    },
  }
  const app = express()
  const requireAuth = (req, res, next) => {
    const user = req.get('x-user')
    if (!user) return res.status(401).json({ message: '請先登入。' })
    req.auth = { userId: user, role: 'member' }
    next()
  }
  const denied = (_req, res) => res.status(403).json({ message: '雷諾曼功能需要管理者開通，請聯絡管理者。' })
  app.use('/api/lenormand', createLenormandRouter({ requireLenormandAccess: denied, requireAuth, LenormandReading: readings, JournalEntry: journal }))
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/lenormand/my-data`)).status, 401)
    assert.equal((await fetch(`${base}/api/lenormand/my-data`, { method: 'DELETE' })).status, 401)
    assert.deepEqual(await (await fetch(`${base}/api/lenormand/my-data`, as(OWNER))).json(), { readings: 2, journals: 1 })
    assert.deepEqual(await (await fetch(`${base}/api/lenormand/my-data`, as(OWNER, 'DELETE'))).json(), { deletedReadings: 2, deletedJournals: 1 })
    assert.deepEqual(await (await fetch(`${base}/api/lenormand/my-data`, as(OWNER))).json(), { readings: 0, journals: 0 })
    // 其他端點仍要雷諾曼權限
    assert.equal((await fetch(`${base}/api/lenormand/readings`, as(OWNER))).status, 403)
  })
  // 別人的紀錄與日記、自己的塔羅日記都還在
  assert.deepEqual(
    readings.rows.map((doc) => String(doc.user)),
    [OTHER],
  )
  assert.deepEqual(journalRows, [
    { user: OWNER, targetKind: 'reading' },
    { user: OTHER, targetKind: 'lenormand' },
  ])
})

test('server.js 有把正式的 requireAuth 傳給雷諾曼 router（漏傳會退回要雷諾曼權限，被收回的人刪不掉）', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'server.js'), 'utf8')
  assert.match(source, /createLenormandRouter\(\{ requireLenormandAccess, requireAuth, ensureDatabase, aiQuota: tarotAiQuota \}\)/)
})
