const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { isMarketOpen, evaluateAlerts, alertMessage } = require('../src/services/market/alertChecker')
const { createNotifier } = require('../src/services/market/notifier')
const { createDiscord, parseWebhookUrl, maskWebhook } = require('../src/services/discord')
const { createWebPush, parseSubscription, PushGoneError } = require('../src/services/webPush')
const { createCronRouter, secretMatches } = require('../src/routes/cron')

// ---- 假的資料與 Discord ----

const HOOK_A = 'https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD'
const HOOK_B = 'https://discord.com/api/webhooks/223456789012345678/bbcdefghijklmnopqrstuvwxyz0123456789ABCD'

function fakeDiscord({ failing = [] } = {}) {
  const sent = []
  return {
    sent,
    send: async (url, content) => {
      if (failing.includes(url)) throw new Error('這個 Webhook 已經被刪除或網址不正確。')
      sent.push({ url, content })
    },
  }
}

const ENDPOINT_1 = 'https://fcm.googleapis.com/fcm/send/device-one'
const ENDPOINT_2 = 'https://updates.push.services.mozilla.com/wpush/v2/device-two'
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' }

function fakeWebPush({ available = true, gone = [] } = {}) {
  const sent = []
  return {
    sent,
    available,
    publicKey: available ? 'PUBLIC_KEY' : null,
    send: async (subscription, payload) => {
      if (gone.includes(subscription.endpoint)) throw new PushGoneError('訂閱已失效')
      sent.push({ endpoint: subscription.endpoint, payload })
    },
  }
}

function fakeSubscriptions() {
  const docs = []
  let seq = 0
  const matches = (doc, query) => Object.entries(query).every(([k, v]) => String(doc[k]) === String(v))
  return {
    MAX_DEVICES_PER_USER: 2,
    docs,
    find: (query) => {
      const list = docs.filter((d) => matches(d, query))
      const promise = Promise.resolve(list)
      promise.sort = () => Promise.resolve(list)
      return promise
    },
    findOne: async (query) => docs.find((d) => matches(d, query)) || null,
    countDocuments: async (query) => docs.filter((d) => matches(d, query)).length,
    distinct: async () => [...new Set(docs.map((d) => d.user))],
    findOneAndUpdate: async (query, update) => {
      let doc = docs.find((d) => matches(d, query))
      if (!doc) {
        seq += 1
        doc = { _id: `s${seq}`, createdAt: new Date(), ...query }
        docs.push(doc)
      }
      Object.assign(doc, update.$set)
      return doc
    },
    deleteOne: async (query) => {
      const index = docs.findIndex((d) => matches(d, query))
      if (index >= 0) docs.splice(index, 1)
      return { deletedCount: index >= 0 ? 1 : 0 }
    },
  }
}

function fakeUsers(roles) {
  return {
    findById: async (id) => (roles[id] ? { _id: id, role: roles[id] } : null),
  }
}

function makeNotifier({ discord = fakeDiscord(), webPush = fakeWebPush(), profiles = [], devices = [], roles = { u1: 'admin', u2: 'member', u3: 'member' }, now } = {}) {
  const MarketProfile = fakeProfiles()
  MarketProfile.docs.push(...profiles)
  const PushSubscription = fakeSubscriptions()
  PushSubscription.docs.push(...devices)
  const notifier = createNotifier({ discord, webPush, MarketProfile, PushSubscription, User: fakeUsers(roles), now })
  return { notifier, discord, webPush, MarketProfile, PushSubscription }
}

function fakeProfiles() {
  const docs = []
  const get = (doc, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), doc)
  const matches = (doc, query) =>
    Object.entries(query).every(([path, cond]) => {
      const value = get(doc, path)
      if (cond && typeof cond === 'object' && '$ne' in cond) return value !== cond.$ne && value !== undefined
      if (cond && typeof cond === 'object' && '$in' in cond) return cond.$in.map(String).includes(String(value))
      return String(value) === String(cond)
    })
  const wrap = (doc) => Object.assign(doc, { save: async () => doc })
  const apply = (doc, set) => {
    for (const [path, value] of Object.entries(set)) {
      const keys = path.split('.')
      let target = doc
      for (const k of keys.slice(0, -1)) target = target[k] ??= {}
      target[keys[keys.length - 1]] = value
    }
  }
  return {
    docs,
    findOne: async (query) => docs.find((d) => matches(d, query)) || null,
    find: async (query) => docs.filter((d) => matches(d, query)),
    findOneAndUpdate: async (query, update) => {
      let doc = docs.find((d) => matches(d, query))
      if (!doc) {
        doc = wrap({ user: query.user, discord: { webhookUrl: null, linkedAt: null } })
        docs.push(doc)
      }
      apply(doc, update.$set)
      return doc
    },
    updateOne: async (query, update) => {
      const doc = docs.find((d) => matches(d, query))
      if (doc) apply(doc, update.$set)
    },
  }
}

function fakeAlert(data) {
  const alert = { active: true, triggeredAt: null, triggeredPrice: null, notifiedAt: null, note: '', ...data }
  alert.save = async () => alert
  return alert
}

// ---- 交易時段 ----

test('交易時段：台股平日 9:00～13:40，美股平日紐約時間 9:30～16:10，週末不開', () => {
  // 2026-11-05 是週四
  assert.equal(isMarketOpen('tw', new Date('2026-11-05T01:30:00Z')), true) // 台北 09:30
  assert.equal(isMarketOpen('tw', new Date('2026-11-05T06:00:00Z')), false) // 台北 14:00
  assert.equal(isMarketOpen('us', new Date('2026-11-05T15:00:00Z')), true) // 紐約 10:00（EST）
  assert.equal(isMarketOpen('us', new Date('2026-11-05T22:00:00Z')), false) // 紐約 17:00
  assert.equal(isMarketOpen('tw', new Date('2026-11-07T01:30:00Z')), false) // 週六
  assert.equal(isMarketOpen('jp', new Date('2026-11-05T01:30:00Z')), false)
})

test('提醒判斷：到價的標成已觸發、同一標的只查一次報價；推播文字由後端產生', async () => {
  const calls = []
  const alerts = [
    fakeAlert({ target: { symbol: '2330.TW', name: '台積電', market: 'tw' }, condition: 'below', price: 2235, note: '加碼' }),
    fakeAlert({ target: { symbol: '2330.TW', name: '台積電', market: 'tw' }, condition: 'above', price: 2500 }),
  ]
  const { triggered } = await evaluateAlerts(alerts, async (target) => {
    calls.push(target.symbol)
    return { price: 2230 }
  })
  assert.deepEqual(calls, ['2330.TW'])
  assert.equal(triggered.length, 1)
  assert.equal(alerts[0].active, false)
  assert.equal(alerts[1].active, true)
  assert.match(alertMessage(alerts[0]), /台積電 跌到 2,235\n目前 2,230\n備註：加碼/)
})

// ---- Discord ----

test('Webhook 網址：只接受 Discord 官方網域，遮罩後不含 token', async () => {
  assert.ok(parseWebhookUrl(HOOK_A))
  assert.ok(parseWebhookUrl(HOOK_A.replace('discord.com', 'ptb.discord.com')))
  assert.ok(parseWebhookUrl(HOOK_A.replace('discord.com', 'discordapp.com')))
  assert.equal(parseWebhookUrl('http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD'), null)
  assert.equal(parseWebhookUrl('https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD'), null)
  assert.equal(parseWebhookUrl('https://discord.com.evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789ABCD'), null)
  assert.equal(parseWebhookUrl(`${HOOK_A}?wait=true`), null)
  assert.equal(parseWebhookUrl(null), null)
  const masked = maskWebhook(HOOK_A)
  assert.ok(!masked.includes('abcdefghij'))
  assert.match(masked, /1234…5678/)

  // 送出：不讓訊息觸發 @everyone；404 視為 webhook 已被刪除
  const calls = []
  const discord = createDiscord({
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) })
      return { ok: url === HOOK_A, status: url === HOOK_A ? 204 : 404 }
    },
  })
  await discord.send(HOOK_A, '@everyone 測試')
  assert.deepEqual(calls[0].body.allowed_mentions, { parse: [] })
  await assert.rejects(discord.send(HOOK_B, 'x'), /已經被刪除/)
  await assert.rejects(discord.send('https://evil.example/x', 'x'), /格式不正確/)
  assert.equal(calls.length, 2)
})

test('Discord 綁定：先送確認訊息，送得出去才存；狀態只給 admin、不含 token', async () => {
  const { notifier, discord } = makeNotifier({ discord: fakeDiscord({ failing: [HOOK_B] }) })

  assert.match((await notifier.linkDiscord('u1', 'https://example.com/hook')).error, /格式不正確/)
  assert.match((await notifier.linkDiscord('u1', HOOK_B)).error, /送不出確認訊息/)
  assert.equal((await notifier.status('u1', { admin: true })).discord.linked, false)

  assert.deepEqual(await notifier.linkDiscord('u1', HOOK_A), {})
  const status = await notifier.status('u1', { admin: true })
  assert.equal(status.discord.linked, true)
  assert.ok(!JSON.stringify(status).includes('abcdefghij'), '狀態不能含 webhook token')
  assert.match(discord.sent[0].content, /綁定完成/)
  // 不是 admin 看不到 Discord
  assert.equal((await notifier.status('u1', { admin: false })).discord, null)

  await notifier.unlinkDiscord('u1')
  assert.equal((await notifier.status('u1', { admin: true })).discord.linked, false)
})

test('瀏覽器推播：只收各大推播服務的網域；同一台裝置不重複；裝置數有上限；換帳號登入改掛新帳號', async () => {
  assert.ok(parseSubscription({ endpoint: ENDPOINT_1, keys: KEYS }))
  assert.ok(parseSubscription({ endpoint: 'https://web.push.apple.com/abc', keys: KEYS }))
  assert.equal(parseSubscription({ endpoint: 'https://evil.example/push', keys: KEYS }), null)
  assert.equal(parseSubscription({ endpoint: 'http://fcm.googleapis.com/x', keys: KEYS }), null)
  assert.equal(parseSubscription({ endpoint: 'https://fcm.googleapis.com:8443/x', keys: KEYS }), null)
  assert.equal(parseSubscription({ endpoint: ENDPOINT_1, keys: { p256dh: 'x', auth: 'y' } }), null)

  const { notifier, PushSubscription } = makeNotifier()
  assert.deepEqual(await notifier.addDevice('u2', { endpoint: ENDPOINT_1, keys: KEYS }, 'Chrome · Windows'), {})
  assert.deepEqual(await notifier.addDevice('u2', { endpoint: ENDPOINT_1, keys: KEYS }, 'Chrome · Windows'), {})
  assert.equal(PushSubscription.docs.length, 1)
  assert.deepEqual(await notifier.addDevice('u2', { endpoint: ENDPOINT_2, keys: KEYS }, 'Firefox'), {})
  assert.match((await notifier.addDevice('u2', { endpoint: 'https://fcm.googleapis.com/fcm/send/three', keys: KEYS })).error, /最多 2 台/)
  assert.match((await notifier.addDevice('u2', { endpoint: 'https://evil.example/x', keys: KEYS })).error, /格式不正確/)

  // 同一台裝置改用 u3 登入
  assert.deepEqual(await notifier.addDevice('u3', { endpoint: ENDPOINT_1, keys: KEYS }), {})
  assert.equal(PushSubscription.docs.find((d) => d.endpoint === ENDPOINT_1).user, 'u3')
  const status = await notifier.status('u2')
  assert.equal(status.push.devices.length, 1)
  assert.equal(status.push.publicKey, 'PUBLIC_KEY')

  assert.equal(await notifier.removeDevice('u2', PushSubscription.docs.find((d) => d.endpoint === ENDPOINT_1)._id), false)
  assert.equal(await notifier.removeDevice('u3', PushSubscription.docs.find((d) => d.endpoint === ENDPOINT_1)._id), true)
})

test('瀏覽器推播沒設定金鑰時：available false，不能開啟、不會送出', async () => {
  const webPush = createWebPush({ publicKey: '', privateKey: '', subject: '' })
  assert.equal(webPush.available, false)
  assert.equal(webPush.publicKey, null)
  await assert.rejects(webPush.send({ endpoint: ENDPOINT_1, keys: KEYS }, {}), /尚未設定/)
  const { notifier } = makeNotifier({ webPush })
  assert.match((await notifier.addDevice('u2', { endpoint: ENDPOINT_1, keys: KEYS })).error, /還沒設定/)
})

test('web-push 回 410（使用者關掉通知）視為訂閱失效', async () => {
  const webPush = createWebPush({
    publicKey: 'p',
    privateKey: 'k',
    subject: 'mailto:test@example.com',
    sendImpl: async () => {
      const error = new Error('gone')
      error.statusCode = 410
      throw error
    },
  })
  await assert.rejects(webPush.send({ endpoint: ENDPOINT_1, keys: KEYS }, {}), PushGoneError)
})

test('到價推播：瀏覽器推播送到每台裝置、失效的刪掉；Discord 只送 admin；任一管道成功才記 notifiedAt', async () => {
  const { notifier, discord, webPush, PushSubscription } = makeNotifier({
    webPush: fakeWebPush({ gone: [ENDPOINT_2] }),
    profiles: [
      { user: 'u1', discord: { webhookUrl: HOOK_A } },
      // 一般會員就算資料庫裡有 webhook（例如被降權）也不送
      { user: 'u2', discord: { webhookUrl: HOOK_B } },
    ],
    devices: [
      { _id: 'd1', user: 'u2', endpoint: ENDPOINT_1, keys: KEYS },
      { _id: 'd2', user: 'u2', endpoint: ENDPOINT_2, keys: KEYS },
    ],
  })
  const target = { symbol: 'NVDA', name: 'NVIDIA', market: 'us' }
  const forAdmin = fakeAlert({ user: 'u1', target, condition: 'above', price: 200, triggeredPrice: 201 })
  const forMember = fakeAlert({ user: 'u2', target, condition: 'above', price: 200, triggeredPrice: 201, note: '加碼' })
  const forNobody = fakeAlert({ user: 'u3', target, condition: 'above', price: 200, triggeredPrice: 201 })

  assert.equal(await notifier.notifyAlerts([forAdmin, forMember, forNobody]), 2)
  assert.deepEqual(discord.sent.map((m) => m.url), [HOOK_A])
  assert.deepEqual(webPush.sent.map((m) => m.endpoint), [ENDPOINT_1])
  assert.deepEqual(webPush.sent[0].payload, { title: 'NVIDIA 漲到 200', body: '目前 201｜加碼', url: 'market?tab=alerts' })
  assert.deepEqual(PushSubscription.docs.map((d) => d._id), ['d1'])
  assert.ok(forAdmin.notifiedAt && forMember.notifiedAt)
  assert.equal(forNobody.notifiedAt, null)
  // 送過不重送
  assert.equal(await notifier.notifyAlerts([forAdmin, forMember]), 0)

  const ids = (await notifier.subscriberIds()).map(String).sort()
  assert.deepEqual(ids, ['u1', 'u2'])

  // 測試通知：會員只有瀏覽器推播
  assert.deepEqual(await notifier.sendTest('u2'), { push: 1, discord: false, errors: [] })
  assert.deepEqual(await notifier.sendTest('u1'), { push: 0, discord: true, errors: [] })
})

// ---- 排程端點 ----

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

function makeCronApp({ secret = 's3cret-value', now, alerts, profiles, users, quotes }) {
  const { notifier, discord } = makeNotifier({ profiles, now, roles: { u1: 'admin', u2: 'admin' } })
  const app = express()
  app.use(express.json())
  app.use(
    '/api/cron',
    createCronRouter({
      secret,
      now,
      ensureDatabase: () => true,
      marketService: { getQuote: async (target) => (quotes[target.symbol] ? { price: quotes[target.symbol] } : null) },
      notifier,
      MarketAlert: { find: async (query) => alerts.filter((a) => a.active && query.user.$in.map(String).includes(String(a.user))) },
      User: { find: async (query) => users.filter((u) => query._id.$in.map(String).includes(String(u._id))) },
    }),
  )
  return { app, discord }
}

test('排程：密鑰錯誤 401、沒設定 503；比對不受長度影響', async () => {
  assert.equal(secretMatches('abc', 'abc'), true)
  assert.equal(secretMatches('abcd', 'abc'), false)
  assert.equal(secretMatches(undefined, 'abc'), false)
  const now = () => new Date('2026-11-05T01:30:00Z')
  const { app } = makeCronApp({ now, alerts: [], profiles: [], users: [], quotes: {} })
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/cron/market`, { method: 'POST' })).status, 401)
    assert.equal((await fetch(`${base}/api/cron/market`, { method: 'POST', headers: { 'x-cron-secret': 'nope' } })).status, 401)
  })
  const { app: closed } = makeCronApp({ secret: '', now, alerts: [], profiles: [], users: [], quotes: {} })
  await withServer(closed, async (base) => {
    assert.equal((await fetch(`${base}/api/cron/market`, { method: 'POST', headers: { 'x-cron-secret': 'x' } })).status, 503)
  })
})

test('排程：只檢查開盤中的市場、有綁定且仍有權限的使用者，到價就推播', async () => {
  const now = () => new Date('2026-11-05T01:30:00Z') // 台股盤中、美股休市
  const tw = { symbol: '2330.TW', name: '台積電', market: 'tw' }
  const us = { symbol: 'NVDA', name: 'NVIDIA', market: 'us' }
  const alerts = [
    fakeAlert({ user: 'u1', target: tw, condition: 'below', price: 2235 }),
    fakeAlert({ user: 'u1', target: us, condition: 'above', price: 1 }), // 美股休市，不檢查
    fakeAlert({ user: 'u2', target: tw, condition: 'below', price: 2235 }), // 權限被收回
  ]
  const users = [
    { _id: 'u1', canUseStock: () => true },
    { _id: 'u2', canUseStock: () => false },
  ]
  const profiles = [
    { user: 'u1', discord: { webhookUrl: HOOK_A } },
    { user: 'u2', discord: { webhookUrl: HOOK_B } },
  ]
  const { app, discord } = makeCronApp({ now, alerts, profiles, users, quotes: { '2330.TW': 2230, NVDA: 300 } })
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/cron/market`, { method: 'POST', headers: { 'x-cron-secret': 's3cret-value' } })
    const body = await response.json()
    assert.equal(response.status, 200)
    assert.equal(body.checked, 1)
    assert.equal(body.triggered, 1)
    assert.equal(body.notified, 1)
  })
  assert.equal(alerts[0].active, false)
  assert.equal(alerts[1].active, true)
  assert.equal(alerts[2].active, true)
  assert.deepEqual(discord.sent.map((m) => m.url), [HOOK_A])
})

test('排程：兩個市場都休市時不查報價', async () => {
  const now = () => new Date('2026-11-07T01:30:00Z') // 週六
  const alerts = [fakeAlert({ user: 'u1', target: { symbol: '2330.TW', market: 'tw' }, condition: 'below', price: 99999 })]
  const { app } = makeCronApp({
    now,
    alerts,
    profiles: [{ user: 'u1', discord: { webhookUrl: HOOK_A } }],
    users: [{ _id: 'u1', canUseStock: () => true }],
    quotes: { '2330.TW': 1 },
  })
  await withServer(app, async (base) => {
    const body = await (await fetch(`${base}/api/cron/market`, { method: 'POST', headers: { 'x-cron-secret': 's3cret-value' } })).json()
    assert.equal(body.checked, 0)
    assert.ok(body.skipped)
  })
  assert.equal(alerts[0].active, true)
})

test('路由：Discord 綁定只有 admin 能用，一般會員 403；狀態不回 Discord 資訊', async () => {
  const { createMarketRouter } = require('../src/routes/market')
  const makeApp = (role) => {
    const { notifier } = makeNotifier()
    const app = express()
    app.use(express.json())
    app.use(
      '/api/market',
      createMarketRouter({
        requireStockAccess: (req, _res, next) => {
          req.auth = { userId: role === 'admin' ? 'u1' : 'u2', role }
          next()
        },
        ensureDatabase: () => true,
        marketService: {},
        MarketCall: {},
        MarketAlert: {},
        MarketWatch: {},
        MarketProfile: fakeProfiles(),
        notifier,
      }),
    )
    return app
  }
  const put = (base) =>
    fetch(`${base}/api/market/notify/discord`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ webhookUrl: HOOK_A }) })

  await withServer(makeApp('member'), async (base) => {
    assert.equal((await put(base)).status, 403)
    assert.equal((await fetch(`${base}/api/market/notify/discord`, { method: 'DELETE' })).status, 403)
    const status = await (await fetch(`${base}/api/market/notify`)).json()
    assert.equal(status.discord, null)
    assert.equal(status.push.available, true)
  })
  await withServer(makeApp('admin'), async (base) => {
    assert.equal((await put(base)).status, 200)
    const status = await (await fetch(`${base}/api/market/notify`)).json()
    assert.equal(status.discord.linked, true)
  })
})

test('VAPID_SUBJECT：只填 email 自動補 mailto:，https 網址照用，其他格式關閉推播', () => {
  const { normalizeSubject } = require('../src/services/webPush')
  assert.equal(normalizeSubject('someone@example.com'), 'mailto:someone@example.com')
  assert.equal(normalizeSubject(' mailto:someone@example.com '), 'mailto:someone@example.com')
  assert.equal(normalizeSubject('https://example.com/app/'), 'https://example.com/app/')
  assert.equal(normalizeSubject('http://example.com'), null)
  assert.equal(normalizeSubject('not valid'), null)
  assert.equal(normalizeSubject(''), null)
  assert.equal(createWebPush({ publicKey: 'p', privateKey: 'k', subject: 'someone@example.com' }).available, true)
  assert.equal(createWebPush({ publicKey: 'p', privateKey: 'k', subject: 'oops' }).available, false)
})

test('測試通知：推播失敗會帶出原因，不是只說還沒開啟', async () => {
  const webPush = {
    available: true,
    publicKey: 'PUBLIC_KEY',
    send: async () => {
      throw new Error('推播失敗（推播服務回應 403）')
    },
  }
  const { notifier } = makeNotifier({ webPush, devices: [{ _id: 'd1', user: 'u2', endpoint: ENDPOINT_1, keys: KEYS, label: 'Chrome · Windows' }] })
  const result = await notifier.sendTest('u2')
  assert.equal(result.push, 0)
  assert.match(result.errors[0], /Chrome · Windows：推播失敗（推播服務回應 403）/)
})

// ---- 更多提醒條件（v17 階段 1）----

const { checkCondition, describeAlert, alertPushPayload: pushPayloadOf } = require('../src/services/market/alertChecker')

const signals = (over = {}) => ({ price: 100, changePct: 1, ma20: 95, ma60: 105, k: 30, d: 25, prevK: 20, prevD: 22, rsi: 72, volumeRatio: 2.5, ...over })

test('條件文字由後端產生', () => {
  assert.equal(describeAlert({ condition: 'below', price: 2235 }), '跌到 2,235')
  assert.equal(describeAlert({ kind: 'changePct', params: { direction: 'down', value: 5 } }), '單日跌幅達 5%')
  assert.equal(describeAlert({ kind: 'ma', params: { direction: 'below', period: 60 } }), '跌破季線（MA60）')
  assert.equal(describeAlert({ kind: 'kd', params: { direction: 'golden' } }), 'KD 黃金交叉')
  assert.equal(describeAlert({ kind: 'rsi', params: { direction: 'above', value: 70 } }), 'RSI(14) 高於 70')
  assert.equal(describeAlert({ kind: 'volume', params: { value: 2 } }), '量比達 2 倍（相對 20 日均量）')
})

test('漲跌幅、KD、RSI、量比的判斷', () => {
  assert.equal(checkCondition({ kind: 'changePct', params: { direction: 'up', value: 3 } }, signals({ changePct: 3.2 })).hit, true)
  assert.equal(checkCondition({ kind: 'changePct', params: { direction: 'down', value: 3 } }, signals({ changePct: 3.2 })).hit, false)
  assert.equal(checkCondition({ kind: 'changePct', params: { direction: 'down', value: 3 } }, signals({ changePct: -4 })).hit, true)
  // 昨天 K < D、今天 K > D → 黃金交叉
  assert.equal(checkCondition({ kind: 'kd', params: { direction: 'golden' } }, signals()).hit, true)
  assert.equal(checkCondition({ kind: 'kd', params: { direction: 'dead' } }, signals()).hit, false)
  assert.equal(checkCondition({ kind: 'kd', params: { direction: 'golden' } }, signals({ prevK: 30, prevD: 20 })).hit, false)
  assert.equal(checkCondition({ kind: 'rsi', params: { direction: 'above', value: 70 } }, signals()).hit, true)
  assert.equal(checkCondition({ kind: 'rsi', params: { direction: 'below', value: 30 } }, signals()).hit, false)
  assert.equal(checkCondition({ kind: 'volume', params: { value: 2 } }, signals()).hit, true)
  // 資料缺就不觸發
  assert.equal(checkCondition({ kind: 'rsi', params: { direction: 'above', value: 70 } }, signals({ rsi: null })).hit, false)
})

test('均線：第一次只記錄側別，要從另一側穿越過來才觸發', () => {
  const alert = { kind: 'ma', params: { direction: 'above', period: 60 }, lastSide: null }
  // 價格 110 在 MA60 105 之上，但還不知道上一次在哪一側 → 不觸發
  assert.deepEqual(checkCondition(alert, signals({ price: 110 })).hit, false)
  alert.lastSide = 'above'
  assert.equal(checkCondition(alert, signals({ price: 110 })).hit, false)
  alert.lastSide = 'below'
  const crossed = checkCondition(alert, signals({ price: 110 }))
  assert.equal(crossed.hit, true)
  assert.equal(crossed.note, 'MA60 105')
  // 跌破方向的提醒，往上穿越不算
  assert.equal(checkCondition({ ...alert, params: { direction: 'below', period: 60 } }, signals({ price: 110 })).hit, false)
})

test('evaluateAlerts：價格提醒用報價、其他用指標；均線側別有變就存；觸發時帶補充說明', async () => {
  const tsmc = { symbol: '2330.TW', name: '台積電', market: 'tw' }
  const priceAlert = fakeAlert({ target: tsmc, condition: 'above', price: 90 })
  const maAlert = fakeAlert({ target: tsmc, kind: 'ma', params: { direction: 'below', period: 20 }, lastSide: null })
  const rsiAlert = fakeAlert({ target: tsmc, kind: 'rsi', params: { direction: 'above', value: 70 } })
  let signalCalls = 0
  const { triggered } = await evaluateAlerts([priceAlert, maAlert, rsiAlert], async () => ({ price: 100 }), {
    getSignals: async () => {
      signalCalls += 1
      return signals()
    },
  })
  assert.equal(signalCalls, 1)
  assert.deepEqual(triggered, [priceAlert, rsiAlert])
  assert.equal(maAlert.active, true)
  assert.equal(maAlert.lastSide, 'above')
  assert.equal(rsiAlert.triggeredNote, 'RSI 72')
  assert.deepEqual(pushPayloadOf(rsiAlert), { title: '台積電 RSI(14) 高於 70', body: '目前 100｜RSI 72', url: 'market?tab=alerts' })
})

// ---- 審查後的修正 ----

test('提醒：漲跌幅、KD、量比只在開盤時判斷；同一個交易日不重複觸發', async () => {
  const target = { symbol: 'NVDA', name: 'NVIDIA', market: 'us' }
  const change = fakeAlert({ target, kind: 'changePct', params: { direction: 'up', value: 3 } })
  const getSignals = async () => signals({ changePct: 5, date: '2026-11-06' })
  // 休市：不判斷
  let result = await evaluateAlerts([change], async () => null, { getSignals, isOpen: () => false })
  assert.equal(result.triggered.length, 0)
  // 開盤：觸發，記下行情日期
  result = await evaluateAlerts([change], async () => null, { getSignals, isOpen: () => true })
  assert.equal(result.triggered.length, 1)
  assert.equal(change.lastTriggeredOn, '2026-11-06')
  // 重新啟用後，同一個交易日不再觸發
  change.active = true
  result = await evaluateAlerts([change], async () => null, { getSignals, isOpen: () => true })
  assert.equal(result.triggered.length, 0)
})

test('提醒：有 Model 時用條件式更新，另一邊已經觸發的就跳過；單筆出錯不影響其他', async () => {
  const target = { symbol: 'NVDA', name: 'NVIDIA', market: 'us' }
  const a = fakeAlert({ _id: 'x1', target, condition: 'above', price: 100 })
  const b = fakeAlert({ _id: 'x2', target, condition: 'above', price: 100 })
  const c = fakeAlert({ _id: 'x3', target, condition: 'above', price: 100 })
  const store = { x1: { active: true }, x2: { active: false }, x3: { active: true } }
  const Model = {
    findOneAndUpdate: async (query, update) => {
      if (query._id === 'x3') throw new Error('Document not found')
      if (!store[query._id].active) return null
      Object.assign(store[query._id], update.$set)
      return { ...a, ...update.$set }
    },
    updateOne: async () => ({}),
  }
  const { triggered } = await evaluateAlerts([a, b, c], async () => ({ price: 120 }), { Model })
  assert.equal(triggered.length, 1)
  assert.equal(store.x1.active, false)
})

test('推播：有 MarketAlert 時先搶 notifiedAt，搶不到就不送；全部失敗會放掉', async () => {
  const claims = []
  const MarketAlert = {
    updateOne: async (query, update) => {
      claims.push([query, update])
      return { modifiedCount: query.notifiedAt === null && query._id === 'taken' ? 0 : 1 }
    },
  }
  const MarketProfile = fakeProfiles()
  const PushSubscription = fakeSubscriptions()
  PushSubscription.docs.push({ _id: 'd1', user: 'u2', endpoint: ENDPOINT_1, keys: KEYS })
  const webPush = fakeWebPush({ gone: [] })
  const notifier = createNotifier({ discord: fakeDiscord(), webPush, MarketProfile, PushSubscription, User: fakeUsers({ u2: 'member' }), MarketAlert })
  const target = { symbol: 'NVDA', name: 'NVIDIA', market: 'us' }
  const taken = fakeAlert({ _id: 'taken', user: 'u2', target, condition: 'above', price: 1, triggeredPrice: 2 })
  const fresh = fakeAlert({ _id: 'fresh', user: 'u2', target, condition: 'above', price: 1, triggeredPrice: 2 })
  const nobody = fakeAlert({ _id: 'nobody', user: 'u9', target, condition: 'above', price: 1, triggeredPrice: 2 })
  assert.equal(await notifier.notifyAlerts([taken, fresh, nobody]), 1)
  assert.equal(webPush.sent.length, 1)
  // nobody 沒有任何管道：搶到後又放掉
  assert.deepEqual(claims.at(-1), [{ _id: 'nobody' }, { $set: { notifiedAt: null } }])
})

test('選股：排序欄位只收自己的鍵，原型上的名稱不算', () => {
  const { parseFilters } = require('../src/services/market/screener')
  for (const sort of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.equal(parseFilters({ sort }).filters.sort, 'dividendYield')
  }
  assert.equal(parseFilters({ sort: 'pe' }).filters.sort, 'pe')
})

test('路由：選股驗證條件、每分鐘 10 次；重大訊息只查自己追蹤的台股；大盤概況與重大訊息沒啟用回 503', async () => {
  const { createMarketRouter } = require('../src/routes/market')
  const screened = []
  const listed = []
  const makeApp = (extra = {}) => {
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
        marketService: {
          screenStocks: async (filters) => {
            screened.push(filters)
            return { results: [] }
          },
          getMarketOverview: async () => ({ tw: [] }),
        },
        MarketCall: {},
        MarketAlert: {},
        MarketWatch: {
          find: async () => [
            { target: { market: 'tw', kind: 'stock', code: '2330' } },
            { target: { market: 'tw', kind: 'index', code: 't00' } },
            { target: { market: 'us', kind: 'stock', code: null, symbol: 'NVDA' } },
          ],
        },
        ...extra,
      }),
    )
    return app
  }
  const news = {
    sync: async () => 0,
    listFor: async (codes) => {
      listed.push(codes)
      return []
    },
  }
  await withServer(makeApp({ news }), async (base) => {
    const screen = (filters) => fetch(`${base}/api/market/screen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filters }) })
    assert.equal((await screen({ peMax: -3 })).status, 400)
    assert.equal((await screen({ sort: 'constructor', yieldMin: 5 })).status, 200)
    assert.equal(screened[0].sort, 'dividendYield')
    for (let i = 0; i < 8; i += 1) await screen({})
    // 第 11 次被擋
    assert.equal((await screen({})).status, 429)

    assert.equal((await fetch(`${base}/api/market/news`)).status, 200)
    assert.deepEqual(listed[0], ['2330'])
    assert.equal((await fetch(`${base}/api/market/overview`)).status, 200)
  })
  await withServer(
    (() => {
      const app = makeApp()
      return app
    })(),
    async (base) => {
      assert.equal((await fetch(`${base}/api/market/news`)).status, 503)
    },
  )
})
