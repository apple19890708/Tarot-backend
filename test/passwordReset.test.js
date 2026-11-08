const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const express = require('express')

const { hashPassword, comparePassword } = require('../src/lib/password')
const { createAuthMiddleware } = require('../src/middleware/auth')
const { createAuthRouter, GOOGLE_ONLY, maskEmail } = require('../src/routes/auth')
const { GoogleTokenError } = require('../src/services/googleAuth')
const { buildRawMessage } = require('../src/services/mailer')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production'

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

// 假的 Users：記憶體裡的陣列，支援 findOne（email／googleId）、findById(...).select、create、save
function fakeUsers(initial) {
  const rows = initial.map((row) => ({ ...row }))
  const wrap = (row) => {
    if (!row) return null
    return Object.assign(row, {
      save: async () => row,
      toPublicJSON: () => ({ id: row._id, email: row.email, role: row.role }),
    })
  }
  // 讓 await 跟 .select() 都能用
  const query = (row) => {
    const result = Promise.resolve(wrap(row))
    result.select = async () => wrap(row)
    return result
  }
  return {
    rows,
    findOne: (filter) => query(rows.find((r) => Object.entries(filter).every(([key, value]) => r[key] === value)) ?? null),
    findById: (id) => query(rows.find((r) => r._id === id) ?? null),
    create: async (data) => {
      const row = { _id: `user-${rows.length + 1}`, ...data }
      rows.push(row)
      return wrap(row)
    },
  }
}

// 假的 PasswordResets：支援 findOne（user＋createdAt $gt、或 tokenHash）、create、deleteMany、deleteOne
function fakeResets(now) {
  const rows = []
  return {
    rows,
    findOne: async (filter) =>
      rows.find((r) => {
        if (filter.tokenHash) return r.tokenHash === filter.tokenHash
        return r.user === filter.user && r.createdAt > filter.createdAt.$gt
      }) ?? null,
    create: async (data) => {
      const row = { _id: `reset-${rows.length + 1}`, usedAt: null, createdAt: new Date(now()), ...data }
      rows.push(row)
      return row
    },
    deleteMany: async ({ user }) => {
      for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i].user === user) rows.splice(i, 1)
    },
    deleteOne: async ({ _id }) => {
      const i = rows.findIndex((r) => r._id === _id)
      if (i >= 0) rows.splice(i, 1)
    },
  }
}

async function withApp(options, run) {
  const { requireAuth } = createAuthMiddleware({ findUserById: async () => null })
  const app = express()
  app.use(express.json())
  app.use('/api/auth', createAuthRouter({ ensureDatabase: () => true, requireAuth, ...options }))
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/auth`
  const post = (path, body) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    await run({ base, post })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

const fakeMailer = () => {
  const sent = []
  return { sent, isConfigured: () => true, send: async (mail) => sent.push(mail) }
}

test('忘記密碼：沒有註冊的信箱直接說；有註冊才寄信，連結用 APP_URL、資料庫只存雜湊', async () => {
  let clock = Date.UTC(2026, 10, 7, 10)
  const now = () => clock
  const Users = fakeUsers([{ _id: 'u1', email: 'amy@example.com', role: 'member' }])
  const PasswordResets = fakeResets(now)
  const mailer = fakeMailer()

  await withApp({ Users, PasswordResets, mailer, appUrl: 'https://example.github.io/Tarot-fontEnd/', now }, async ({ post }) => {
    const missing = await post('/forgot-password', { email: 'nobody@example.com' })
    assert.equal(missing.status, 404)
    assert.match((await missing.json()).message, /沒有註冊/)
    assert.equal(mailer.sent.length, 0)

    const ok = await post('/forgot-password', { email: ' Amy@Example.com ' })
    assert.equal(ok.status, 200)
    assert.equal(mailer.sent.length, 1)
    assert.equal(mailer.sent[0].to, 'amy@example.com')
    const token = mailer.sent[0].text.match(/reset-password\?token=([\w-]+)/)[1]
    assert.ok(mailer.sent[0].text.includes('https://example.github.io/Tarot-fontEnd/reset-password?token='))
    assert.equal(PasswordResets.rows.length, 1)
    assert.equal(PasswordResets.rows[0].tokenHash, sha256(token))
    assert.ok(!JSON.stringify(PasswordResets.rows).includes(token))

    // 5 分鐘內不能再寄
    const again = await post('/forgot-password', { email: 'amy@example.com' })
    assert.equal(again.status, 429)
    clock += 6 * 60 * 1000
    assert.equal((await post('/forgot-password', { email: 'amy@example.com' })).status, 200)
    // 新寄的那封取代舊的
    assert.equal(PasswordResets.rows.length, 1)
  })
})

test('忘記密碼：沒設定寄信時回 503；寄信失敗時刪掉憑證、回 502', async () => {
  const now = () => Date.UTC(2026, 10, 7, 10)
  const Users = fakeUsers([{ _id: 'u1', email: 'amy@example.com', role: 'member' }])
  await withApp({ Users, PasswordResets: fakeResets(now), mailer: { isConfigured: () => false }, appUrl: 'http://x', now }, async ({ post }) => {
    assert.equal((await post('/forgot-password', { email: 'amy@example.com' })).status, 503)
  })
  const PasswordResets = fakeResets(now)
  const broken = { isConfigured: () => true, send: async () => { throw new Error('boom') } }
  await withApp({ Users, PasswordResets, mailer: broken, appUrl: 'http://x', now }, async ({ post }) => {
    assert.equal((await post('/forgot-password', { email: 'amy@example.com' })).status, 502)
    assert.equal(PasswordResets.rows.length, 0)
  })
})

test('重設密碼：有效連結可以設新密碼且只能用一次；過期或亂填的連結無效', async () => {
  let clock = Date.UTC(2026, 10, 7, 10)
  const now = () => clock
  const Users = fakeUsers([{ _id: 'u1', email: 'amy@example.com', role: 'member', passwordHash: await hashPassword('old-password') }])
  const PasswordResets = fakeResets(now)
  const mailer = fakeMailer()

  await withApp({ Users, PasswordResets, mailer, appUrl: 'http://localhost:5173', now }, async ({ base, post }) => {
    await post('/forgot-password', { email: 'amy@example.com' })
    const token = mailer.sent[0].text.match(/token=([\w-]+)/)[1]

    const check = await (await fetch(`${base}/reset-password/${token}`)).json()
    assert.deepEqual(check, { valid: true, email: 'a***@example.com' })
    assert.deepEqual(await (await fetch(`${base}/reset-password/${'x'.repeat(43)}`)).json(), { valid: false })

    // 密碼太短照註冊的規則擋
    assert.equal((await post('/reset-password', { token, password: 'short' })).status, 400)

    const done = await post('/reset-password', { token, password: 'brand-new-password' })
    assert.equal(done.status, 200)
    assert.equal(await comparePassword('brand-new-password', Users.rows[0].passwordHash), true)
    // 改了密碼，之前發出的登入憑證全部失效（版本號加 1）
    assert.equal(Users.rows[0].tokenVersion, 1)
    // 用過就失效
    assert.equal((await post('/reset-password', { token, password: 'another-password' })).status, 400)
    assert.deepEqual(await (await fetch(`${base}/reset-password/${token}`)).json(), { valid: false })

    // 過期：30 分鐘後
    clock += 6 * 60 * 1000
    await post('/forgot-password', { email: 'amy@example.com' })
    const late = mailer.sent[1].text.match(/token=([\w-]+)/)[1]
    clock += 31 * 60 * 1000
    assert.equal((await post('/reset-password', { token: late, password: 'too-late-password' })).status, 400)
  })
})

test('Google 登入：新信箱建立會員、同信箱的舊帳號綁上 googleId；驗證失敗回 401；沒設定回 503', async () => {
  const Users = fakeUsers([{ _id: 'u1', email: 'old@example.com', role: 'member', passwordHash: 'hash' }])
  const google = {
    isConfigured: () => true,
    verify: async (credential) => {
      if (credential === 'new-user') return { googleId: 'g-new', email: 'new@example.com', name: '新朋友' }
      if (credential === 'old-user') return { googleId: 'g-old', email: 'old@example.com', name: '' }
      throw new GoogleTokenError('Google 登入資料不正確。')
    },
  }
  await withApp({ Users, google }, async ({ post }) => {
    const created = await post('/google', { credential: 'new-user' })
    assert.equal(created.status, 201)
    const body = await created.json()
    assert.ok(body.token)
    assert.equal(body.user.email, 'new@example.com')
    const newRow = Users.rows.find((r) => r.email === 'new@example.com')
    assert.equal(newRow.googleId, 'g-new')
    assert.equal(newRow.role, 'member')
    assert.equal(newRow.passwordHash, undefined)

    const linked = await post('/google', { credential: 'old-user' })
    assert.equal(linked.status, 200)
    assert.equal(Users.rows.find((r) => r._id === 'u1').googleId, 'g-old')
    assert.equal(Users.rows.length, 2)

    // 第二次用 googleId 就找得到
    assert.equal((await post('/google', { credential: 'new-user' })).status, 200)
    assert.equal(Users.rows.length, 2)

    assert.equal((await post('/google', { credential: 'forged' })).status, 401)
  })
  await withApp({ Users, google: { isConfigured: () => false } }, async ({ post }) => {
    assert.equal((await post('/google', { credential: 'new-user' })).status, 503)
  })
})

test('用 Google 註冊、沒有密碼的帳號用密碼登入時，提示改用 Google 登入', async () => {
  const Users = fakeUsers([{ _id: 'u1', email: 'g@example.com', role: 'member', googleId: 'g-1' }])
  await withApp({ Users }, async ({ post }) => {
    const response = await post('/login', { email: 'g@example.com', password: 'whatever-password' })
    assert.equal(response.status, 401)
    assert.equal((await response.json()).message, GOOGLE_ONLY)
  })
})

test('maskEmail 與 Gmail 信件格式：中文主旨用 UTF-8 編碼、整封是 base64url', () => {
  assert.equal(maskEmail('someone@gmail.com'), 's***@gmail.com')
  const raw = buildRawMessage({ from: 'me@gmail.com', to: 'you@example.com', subject: '重設密碼', text: '內容', html: '<p>內容</p>' })
  assert.ok(!/[+/=]/.test(raw))
  const decoded = Buffer.from(raw, 'base64url').toString('utf8')
  assert.ok(decoded.includes(`Subject: =?UTF-8?B?${Buffer.from('重設密碼').toString('base64')}?=`))
  assert.ok(decoded.includes('To: <you@example.com>'))
})
