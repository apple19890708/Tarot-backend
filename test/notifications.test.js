// 通知中心（v26 計畫 5）：寫入（同一件事只存一次、每人 200 則上限）、API 只動自己的、
// notifier 送推播前先存（推播失敗或沒開推播也存）、除息前提醒沒開推播也進通知中心
const test = require('node:test')
const assert = require('node:assert')
const express = require('express')

const { createNotificationCenter, cleanUrl } = require('../src/services/notificationCenter')
const { createNotificationsRouter } = require('../src/routes/notifications')
const { createNotifier } = require('../src/services/market/notifier')
const { USER_DATA_MODELS } = require('../src/services/accountDeletion')

const OWNER = '507f1f77bcf86cd799439011'
const OTHER = '507f1f77bcf86cd799439022'

// ---- 假的 Notification（記憶體）----
function fakeNotificationModel({ max = 200 } = {}) {
  const docs = []
  let seq = 0
  const nextId = () => (++seq).toString(16).padStart(24, '0')
  const same = (a, b) => (a === null || b === null ? a === b : String(a) === String(b))
  function matches(doc, filter) {
    return Object.entries(filter).every(([key, cond]) => {
      const value = doc[key] ?? null
      if (cond && typeof cond === 'object' && !Array.isArray(cond) && Object.keys(cond).some((k) => k.startsWith('$'))) {
        if ('$lt' in cond && !(String(value) < String(cond.$lt))) return false
        if ('$in' in cond && !cond.$in.some((item) => same(item, value))) return false
        if ('$ne' in cond && same(cond.$ne, value)) return false
        return true
      }
      return same(cond, value)
    })
  }
  function query(list) {
    let result = [...list]
    const chain = {
      sort(spec) {
        const [[key, dir]] = Object.entries(spec)
        result.sort((a, b) => (String(a[key]) < String(b[key]) ? -dir : String(a[key]) > String(b[key]) ? dir : 0))
        return chain
      },
      skip(n) {
        result = result.slice(n)
        return chain
      },
      limit(n) {
        result = result.slice(0, n)
        return chain
      },
      select: () => chain,
      lean: () => chain,
      then: (resolve, reject) => Promise.resolve(result.map((doc) => ({ ...doc }))).then(resolve, reject),
    }
    return chain
  }
  const Model = {
    MAX_PER_USER: max,
    docs,
    find: (filter) => query(docs.filter((doc) => matches(doc, filter))),
    countDocuments: async (filter) => docs.filter((doc) => matches(doc, filter)).length,
    create: async (fields) => {
      const doc = { _id: nextId(), readAt: null, key: null, createdAt: new Date(), ...fields }
      docs.push(doc)
      return doc
    },
    updateOne: async (filter, update, options = {}) => {
      const found = docs.find((doc) => matches(doc, filter))
      if (found) return { modifiedCount: 0, upsertedCount: 0 }
      if (!options.upsert) return { modifiedCount: 0, upsertedCount: 0 }
      docs.push({ _id: nextId(), createdAt: new Date(), ...update.$setOnInsert })
      return { modifiedCount: 0, upsertedCount: 1 }
    },
    updateMany: async (filter, update) => {
      const list = docs.filter((doc) => matches(doc, filter))
      for (const doc of list) Object.assign(doc, update.$set)
      return { modifiedCount: list.length }
    },
    deleteOne: async (filter) => {
      const index = docs.findIndex((doc) => matches(doc, filter))
      if (index < 0) return { deletedCount: 0 }
      docs.splice(index, 1)
      return { deletedCount: 1 }
    },
    deleteMany: async (filter) => {
      const keep = docs.filter((doc) => !matches(doc, filter))
      const deleted = docs.length - keep.length
      docs.splice(0, docs.length, ...keep)
      return { deletedCount: deleted }
    },
  }
  return Model
}

function appWith(Notification) {
  const app = express()
  app.use(express.json())
  const requireAuth = (req, res, next) => {
    const user = req.get('x-user')
    if (!user) return res.status(401).json({ message: '請先登入。' })
    req.auth = { userId: user }
    next()
  }
  app.use('/api', createNotificationsRouter({ ensureDatabase: () => true, requireAuth, Notification }))
  return app
}

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    // keep-alive 連線不等它逾時（約 3 秒），直接關掉
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

const as = (user, method = 'GET', body) => ({
  method,
  headers: { 'x-user': user, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
})

// ---- 寫入 ----

test('寫入：同一個 key 只存一次；沒有 key 每次都存；網址只收站內路徑', async () => {
  const Notification = fakeNotificationModel()
  const center = createNotificationCenter({ Notification })
  assert.equal(await center.record(OWNER, { kind: 'price-alert', title: '台積電 漲到 1000', url: 'market?tab=alerts', key: 'alert:a1:1' }), true)
  assert.equal(await center.record(OWNER, { kind: 'price-alert', title: '台積電 漲到 1000', url: 'market?tab=alerts', key: 'alert:a1:1' }), false)
  // 別人同一個 key 是另一則
  assert.equal(await center.record(OTHER, { kind: 'price-alert', title: 'x', key: 'alert:a1:1' }), true)
  assert.equal(await center.record(OWNER, { kind: 'test', title: '測試通知' }), true)
  assert.equal(await center.record(OWNER, { kind: 'test', title: '測試通知' }), true)
  assert.equal(Notification.docs.filter((doc) => doc.user === OWNER).length, 3)

  assert.equal(cleanUrl('/market?tab=alerts'), 'market?tab=alerts')
  assert.equal(cleanUrl('https://evil.example'), '')
  assert.equal(cleanUrl('javascript:alert(1)'), '')
  assert.equal(cleanUrl('//evil.example'), 'evil.example')
  // 標題、內文過長截斷，空標題補「通知」
  await center.record(OWNER, { kind: 'system', title: '', body: 'x'.repeat(900) })
  const last = Notification.docs.at(-1)
  assert.equal(last.title, '通知')
  assert.equal(last.body.length, 500)
})

test('寫入：種類不對、key 太長都擋（upsert 不跑 schema 驗證）', async () => {
  const Notification = { ...fakeNotificationModel(), KINDS: ['price-alert', 'ex-dividend', 'test', 'system'] }
  const center = createNotificationCenter({ Notification })
  await assert.rejects(() => center.record(OWNER, { kind: 'exdividend', title: 'x', key: 'k' }))
  await assert.rejects(() => center.record(OWNER, { kind: 'test', title: 'x', key: 'k'.repeat(201) }))
  assert.equal(await center.record(OWNER, { kind: 'test', title: 'x', key: 'k' }), true)
})

test('寫入：每人最多 200 則，超過刪最舊（只刪自己的）', async () => {
  const Notification = fakeNotificationModel({ max: 3 })
  const center = createNotificationCenter({ Notification })
  await center.record(OTHER, { kind: 'test', title: '別人的' })
  for (let i = 1; i <= 5; i += 1) await center.record(OWNER, { kind: 'test', title: `第 ${i} 則` })
  const mine = Notification.docs.filter((doc) => doc.user === OWNER).map((doc) => doc.title)
  assert.deepEqual(mine, ['第 3 則', '第 4 則', '第 5 則'])
  assert.equal(Notification.docs.filter((doc) => doc.user === OTHER).length, 1)
})

// ---- API ----

test('API：列表新到舊、分頁、未讀數；只看得到自己的', async () => {
  const Notification = fakeNotificationModel()
  const center = createNotificationCenter({ Notification })
  for (let i = 1; i <= 5; i += 1) await center.record(OWNER, { kind: 'test', title: `第 ${i} 則`, url: 'market' })
  await center.record(OTHER, { kind: 'test', title: '別人的' })
  await withServer(appWith(Notification), async (base) => {
    const first = await (await fetch(`${base}/api/notifications?limit=2`, as(OWNER))).json()
    assert.deepEqual(first.notifications.map((n) => n.title), ['第 5 則', '第 4 則'])
    assert.equal(first.hasMore, true)
    assert.deepEqual(Object.keys(first.notifications[0]).sort(), ['body', 'createdAt', 'id', 'kind', 'read', 'title', 'url'])
    const second = await (await fetch(`${base}/api/notifications?limit=2&before=${first.notifications[1].id}`, as(OWNER))).json()
    assert.deepEqual(second.notifications.map((n) => n.title), ['第 3 則', '第 2 則'])
    const third = await (await fetch(`${base}/api/notifications?limit=2&before=${second.notifications[1].id}`, as(OWNER))).json()
    assert.deepEqual(third.notifications.map((n) => n.title), ['第 1 則'])
    assert.equal(third.hasMore, false)

    assert.equal((await fetch(`${base}/api/notifications?before=abc`, as(OWNER))).status, 400)
    assert.equal((await fetch(`${base}/api/notifications`)).status, 401)
    assert.deepEqual(await (await fetch(`${base}/api/notifications/unread-count`, as(OWNER))).json(), { count: 5 })
    assert.deepEqual(await (await fetch(`${base}/api/notifications/unread-count`, as(OTHER))).json(), { count: 1 })
  })
})

test('API：標成已讀（指定或全部）、刪一則、清除已讀；動不到別人的', async () => {
  const Notification = fakeNotificationModel()
  const center = createNotificationCenter({ Notification })
  for (let i = 1; i <= 3; i += 1) await center.record(OWNER, { kind: 'test', title: `第 ${i} 則` })
  await center.record(OTHER, { kind: 'test', title: '別人的' })
  const [n1, n2, n3] = Notification.docs.filter((doc) => doc.user === OWNER).map((doc) => doc._id)
  const theirs = Notification.docs.find((doc) => doc.user === OTHER)._id
  await withServer(appWith(Notification), async (base) => {
    // 指定 id：別人的 id 混進來也不會被標
    const marked = await (await fetch(`${base}/api/notifications/read`, as(OWNER, 'PUT', { ids: [n1, theirs] }))).json()
    assert.deepEqual(marked, { updated: 1 })
    assert.equal(Notification.docs.find((doc) => doc._id === theirs).readAt, null)
    assert.equal((await fetch(`${base}/api/notifications/read`, as(OWNER, 'PUT', { ids: ['x'] }))).status, 400)
    assert.equal((await fetch(`${base}/api/notifications/read`, as(OWNER, 'PUT', { ids: 'all' }))).status, 400)

    // 刪別人的 404、刪自己的成功
    assert.equal((await fetch(`${base}/api/notifications/${theirs}`, as(OWNER, 'DELETE'))).status, 404)
    assert.equal((await fetch(`${base}/api/notifications/not-an-id`, as(OWNER, 'DELETE'))).status, 404)
    assert.equal((await fetch(`${base}/api/notifications/${n3}`, as(OWNER, 'DELETE'))).status, 200)

    // 清除已讀：沒帶 read=true 不收；只清自己已讀的
    assert.equal((await fetch(`${base}/api/notifications`, as(OWNER, 'DELETE'))).status, 400)
    assert.deepEqual(await (await fetch(`${base}/api/notifications?read=true`, as(OWNER, 'DELETE'))).json(), { deleted: 1 })
    assert.deepEqual(Notification.docs.map((doc) => doc._id).sort(), [n2, theirs].sort())

    // 全部標成已讀：別人的不受影響
    assert.deepEqual(await (await fetch(`${base}/api/notifications/read`, as(OWNER, 'PUT', {}))).json(), { updated: 1 })
    assert.deepEqual(await (await fetch(`${base}/api/notifications/unread-count`, as(OWNER))).json(), { count: 0 })
    assert.deepEqual(await (await fetch(`${base}/api/notifications/unread-count`, as(OTHER))).json(), { count: 1 })
  })
})

test('刪除帳號時一起刪通知', () => {
  assert.ok(USER_DATA_MODELS.includes('Notification'))
})

// ---- notifier 寫入 ----

function notifierWith({ pushOk = true, devices = 1, notifications }) {
  const sent = []
  const webPush = {
    available: true,
    publicKey: 'k',
    send: async (_sub, payload) => {
      sent.push(payload.title)
      if (!pushOk) throw new Error('推播服務掛了')
    },
  }
  const PushSubscription = { find: async () => Array.from({ length: devices }, (_, i) => ({ _id: `d${i}`, endpoint: `e${i}`, keys: {} })) }
  const notifier = createNotifier({
    discord: { send: async () => {} },
    webPush,
    MarketProfile: { findOne: async () => null },
    PushSubscription,
    User: { findById: async () => ({ role: 'member' }) },
    notifications,
  })
  return { notifier, sent }
}

const alert = (id, extra = {}) => ({
  _id: id,
  user: OWNER,
  target: { name: '台積電', market: 'tw', code: '2330' },
  condition: 'above',
  kind: 'price',
  price: 1000,
  triggeredAt: new Date('2026-11-20T02:00:00Z'),
  triggeredPrice: 1005,
  notifiedAt: null,
  save: async () => {},
  ...extra,
})

test('notifier：價位提醒推播失敗或沒有裝置也存進通知中心；同一次觸發只存一則', async () => {
  const Notification = fakeNotificationModel()
  const notifications = createNotificationCenter({ Notification })
  const failing = notifierWith({ pushOk: false, notifications })
  assert.equal(await failing.notifier.notifyAlerts([alert('a1')]), 0)
  assert.equal(Notification.docs.length, 1)
  assert.equal(Notification.docs[0].kind, 'price-alert')
  assert.equal(Notification.docs[0].url, 'market?tab=alerts')
  assert.match(Notification.docs[0].title, /台積電/)

  // 網頁的檢查先存、排程又送一次：還是一則
  await failing.notifier.recordAlerts([alert('a1')])
  await notifierWith({ devices: 0, notifications }).notifier.notifyAlerts([alert('a1')])
  assert.equal(Notification.docs.length, 1)
  // 重新啟用後再觸發是新的一則
  await failing.notifier.recordAlerts([alert('a1', { triggeredAt: new Date('2026-11-21T02:00:00Z') })])
  assert.equal(Notification.docs.length, 2)
})

test('notifier：通知中心存不進去不擋推播；測試推播送出才存', async () => {
  const broken = { record: async () => { throw new Error('資料庫掛了') } }
  const { notifier, sent } = notifierWith({ notifications: broken })
  assert.equal(await notifier.notifyAlerts([alert('a2')]), 1)
  assert.equal(sent.length, 1)
  assert.equal(await notifier.notifyUser(OWNER, { title: 't', body: 'b', url: 'market' }), true)
  // 對外的 record 會丟錯（除息前提醒靠它決定要不要重試）
  await assert.rejects(() => notifier.record(OWNER, { kind: 'test', title: 'x' }))

  const Notification = fakeNotificationModel()
  const notifications = createNotificationCenter({ Notification })
  await notifierWith({ devices: 0, notifications }).notifier.sendTest(OWNER)
  assert.equal(Notification.docs.length, 0)
  await notifierWith({ notifications }).notifier.sendTest(OWNER)
  assert.deepEqual(Notification.docs.map((doc) => [doc.kind, doc.title]), [['test', '測試通知']])
  // 一般通知帶種類與 key
  await notifierWith({ pushOk: false, notifications }).notifier.notifyUser(OWNER, { title: '明天除息', body: 'b', url: 'market?tab=income' }, { kind: 'ex-dividend', key: 'exDividend:2330:2026-11-21' })
  await notifierWith({ notifications }).notifier.notifyUser(OWNER, { title: '明天除息', body: 'b', url: 'market?tab=income' }, { kind: 'ex-dividend', key: 'exDividend:2330:2026-11-21' })
  assert.equal(Notification.docs.filter((doc) => doc.kind === 'ex-dividend').length, 1)
})
