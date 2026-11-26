// v24 帳戶會員安全：Google 合併帳號、登入失敗鎖定、註冊限速、塔羅 AI 每日上限、安全標頭
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { hashPassword } = require('../src/lib/password')
const { createAuthMiddleware } = require('../src/middleware/auth')
const { createAuthRouter, LOGIN_FAILED, LOCKED, LOCK_MAX_FAILURES, GOOGLE_ONLY, ADMIN_GOOGLE_ONLY } = require('../src/routes/auth')
const crypto = require('crypto')
const { createTarotAiQuota, TAROT_AI_DAILY_LIMITS } = require('../src/services/tarotAiQuota')
const { USER_DATA_MODELS, createUserDataDeleter } = require('../src/services/accountDeletion')
const { signToken } = require('../src/lib/jwt')
const fs = require('fs')
const path = require('path')
const { securityHeaders } = require('../src/lib/securityHeaders')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-do-not-use-in-production'

// 假的 Users：findOne（await 或 .select() 都能用）、findById、create、updateOne（recordLogin 用）
function fakeUsers(initial) {
  const rows = initial.map((row) => ({ ...row }))
  const wrap = (row) => {
    if (!row) return null
    return Object.assign(row, {
      save: async () => row,
      toPublicJSON: () => ({ id: row._id, email: row.email, role: row.role }),
    })
  }
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
    updateOne: async () => ({}),
    deleteOne: async ({ _id }) => {
      const i = rows.findIndex((r) => r._id === _id)
      if (i >= 0) rows.splice(i, 1)
    },
  }
}

// 假的 LoginAttempts：只支援 auth.js 用到的四個方法
function fakeAttempts() {
  const rows = new Map()
  return {
    rows,
    findOne: async ({ key }) => rows.get(key) ?? null,
    findOneAndUpdate: async ({ key }, { $set }) => {
      rows.set(key, { key, ...$set })
      return rows.get(key)
    },
    updateOne: async ({ key }, { $inc, $set }) => {
      const row = rows.get(key)
      if (!row) return
      row.count += $inc.count
      Object.assign(row, $set)
    },
    deleteOne: async ({ key }) => {
      rows.delete(key)
    },
  }
}

async function withApp(options, run) {
  // requireAuth 從假的 Users 找人（帳號設定頁的測試要登入）
  const findUserById = async (id) => options.Users?.rows?.find((row) => row._id === id) ?? null
  const { requireAuth } = createAuthMiddleware({ findUserById })
  const app = express()
  app.use(express.json())
  app.use('/api/auth', createAuthRouter({ ensureDatabase: () => true, requireAuth, ...options }))
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  const base = `http://127.0.0.1:${server.address().port}/api/auth`
  const call = (method, path, body, token) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const post = (path, body, token) => call('POST', path, body, token)
  try {
    await run({ post, call })
  } finally {
    // keep-alive 連線不等它逾時（約 3 秒），直接關掉
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('Google 合併：信箱沒驗證過的密碼帳號，綁 Google 時清掉舊密碼、舊 token 失效（帳號被預先佔用）', async () => {
  const Users = fakeUsers([
    { _id: 'u1', email: 'victim@example.com', role: 'member', passwordHash: await hashPassword('attacker-pass'), tokenVersion: 2 },
  ])
  const google = { isConfigured: () => true, verify: async () => ({ googleId: 'g-1', email: 'victim@example.com', name: '' }) }
  await withApp({ Users, google, ipRateLimit: false }, async ({ post }) => {
    const response = await post('/google', { credential: 'x' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).passwordCleared, true)
    const row = Users.rows[0]
    assert.equal(row.passwordHash, undefined)
    assert.equal(row.tokenVersion, 3)
    assert.equal(row.emailVerified, true)
    assert.equal(row.googleId, 'g-1')

    // 攻擊者原本那組密碼不能再登入
    const login = await post('/login', { email: 'victim@example.com', password: 'attacker-pass' })
    assert.equal(login.status, 401)
    assert.equal((await login.json()).message, GOOGLE_ONLY)
  })
})

test('Google 合併：信箱驗證過的帳號綁 Google 時保留密碼', async () => {
  const passwordHash = await hashPassword('my-own-password')
  const Users = fakeUsers([{ _id: 'u1', email: 'me@example.com', role: 'member', passwordHash, emailVerified: true, tokenVersion: 0 }])
  const google = { isConfigured: () => true, verify: async () => ({ googleId: 'g-1', email: 'me@example.com', name: '' }) }
  await withApp({ Users, google, ipRateLimit: false }, async ({ post }) => {
    const response = await post('/google', { credential: 'x' })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).passwordCleared, undefined)
    assert.equal(Users.rows[0].passwordHash, passwordHash)
    assert.equal(Users.rows[0].tokenVersion, 0)
    assert.equal((await post('/login', { email: 'me@example.com', password: 'my-own-password' })).status, 200)
  })
})

test('Google 登入：舊的 Google 帳號（沒有 emailVerified）登入後補上已驗證', async () => {
  const Users = fakeUsers([{ _id: 'u1', email: 'g@example.com', role: 'member', googleId: 'g-1' }])
  const google = { isConfigured: () => true, verify: async () => ({ googleId: 'g-1', email: 'g@example.com', name: '' }) }
  await withApp({ Users, google, ipRateLimit: false }, async ({ post }) => {
    assert.equal((await post('/google', { credential: 'x' })).status, 200)
    assert.equal(Users.rows[0].emailVerified, true)
  })
})

test('帳號鎖定：同一個 email 連續錯 10 次就鎖 15 分鐘，密碼對了也進不去；時間到或登入成功就歸零', async () => {
  let clock = Date.UTC(2026, 10, 17, 2)
  const now = () => clock
  const Users = fakeUsers([{ _id: 'u1', email: 'amy@example.com', role: 'member', passwordHash: await hashPassword('right-password') }])
  const LoginAttempts = fakeAttempts()
  await withApp({ Users, LoginAttempts, now, ipRateLimit: false }, async ({ post }) => {
    // 錯 9 次後密碼對了還是進得去，而且計數歸零
    for (let i = 0; i < LOCK_MAX_FAILURES - 1; i += 1) {
      assert.equal((await post('/login', { email: 'amy@example.com', password: 'wrong-password' })).status, 401)
    }
    assert.equal((await post('/login', { email: 'amy@example.com', password: 'right-password' })).status, 200)
    assert.equal(LoginAttempts.rows.size, 0)

    for (let i = 0; i < LOCK_MAX_FAILURES; i += 1) {
      assert.equal((await post('/login', { email: 'amy@example.com', password: 'wrong-password' })).status, 401)
    }
    const locked = await post('/login', { email: 'amy@example.com', password: 'right-password' })
    assert.equal(locked.status, 429)
    assert.equal((await locked.json()).message, LOCKED)

    clock += 15 * 60 * 1000 + 1
    assert.equal((await post('/login', { email: 'amy@example.com', password: 'right-password' })).status, 200)
  })
})

test('帳號鎖定：不存在的帳號也照樣計數、回同一句，不透露帳號存不存在', async () => {
  const Users = fakeUsers([])
  const LoginAttempts = fakeAttempts()
  await withApp({ Users, LoginAttempts, ipRateLimit: false }, async ({ post }) => {
    for (let i = 0; i < LOCK_MAX_FAILURES; i += 1) {
      const response = await post('/login', { email: 'nobody@example.com', password: 'whatever-password' })
      assert.equal((await response.json()).message, LOGIN_FAILED)
    }
    const locked = await post('/login', { email: 'nobody@example.com', password: 'whatever-password' })
    assert.equal(locked.status, 429)
    assert.equal((await locked.json()).message, LOCKED)
  })
})

test('註冊限速：同一 IP 一小時最多 5 個帳號', async () => {
  const Users = fakeUsers([])
  await withApp({ Users }, async ({ post }) => {
    for (let i = 1; i <= 5; i += 1) {
      assert.equal((await post('/register', { email: `user${i}@example.com`, password: 'long-enough-password' })).status, 201)
    }
    const blocked = await post('/register', { email: 'user6@example.com', password: 'long-enough-password' })
    assert.equal(blocked.status, 429)
    assert.equal(Users.rows.length, 5)
  })
})

test('塔羅 AI 每日上限：member 用完回不允許、admin 不限；出錯時退還這次', async () => {
  const rows = []
  const Usage = {
    KEEP_DAYS: 2,
    countDocuments: async ({ user, kind, createdAt }) =>
      rows.filter((r) => r.user === user && r.kind === kind && r.createdAt >= createdAt.$gte).length,
    create: async (data) => {
      const row = { _id: `usage-${rows.length + 1}`, createdAt: new Date(), ...data }
      rows.push(row)
      return row
    },
    deleteOne: async ({ _id }) => {
      const i = rows.findIndex((r) => r._id === _id)
      if (i >= 0) rows.splice(i, 1)
    },
  }
  const quota = createTarotAiQuota({ Usage })
  const member = { userId: 'm1', role: 'member' }
  const limit = TAROT_AI_DAILY_LIMITS.tarot

  for (let i = 0; i < limit - 1; i += 1) await quota.record('m1', 'tarot')
  assert.deepEqual(await quota.check(member, 'tarot'), { allowed: true, used: limit - 1, limit })
  const last = quota.record('m1', 'tarot')
  assert.equal((await quota.check(member, 'tarot')).allowed, false)
  // 追問分開計算
  assert.equal((await quota.check(member, 'followUp')).allowed, true)
  // AI 出錯退還後又可以用
  await quota.refund(last)
  assert.equal((await quota.check(member, 'tarot')).allowed, true)

  assert.deepEqual(await quota.check({ userId: 'a1', role: 'admin' }, 'tarot'), { allowed: true, used: null, limit: null })
  assert.match(quota.limitMessage('tarot', limit), /每天 30 次/)
})

test('安全標頭：沒有 X-Powered-By、有 nosniff 與 noindex，牌卡圖片可以跨網域載入', async () => {
  const app = express()
  app.use(securityHeaders())
  app.get('/cards/x.jpg', (_req, res) => res.send('img'))
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/cards/x.jpg`)
    assert.equal(response.headers.get('x-powered-by'), null)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('x-robots-tag'), 'noindex')
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin')
  } finally {
    // keep-alive 連線不等它逾時（約 3 秒），直接關掉
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
})

const fakeMailer = () => {
  const sent = []
  return { sent, isConfigured: () => true, send: async (mail) => sent.push(mail) }
}
const tokenOf = (row) => signToken({ _id: row._id, role: row.role, tokenVersion: row.tokenVersion })

test('帳號設定：GET /account 回登入方式；沒登入回 401', async () => {
  const Users = fakeUsers([
    { _id: 'u1', email: 'a@example.com', role: 'member', passwordHash: 'hash', googleId: 'g-1', emailVerified: true },
  ])
  await withApp({ Users, ipRateLimit: false }, async ({ call }) => {
    const response = await call('GET', '/account', undefined, tokenOf(Users.rows[0]))
    assert.equal(response.status, 200)
    const { account } = await response.json()
    assert.deepEqual(account.loginMethods, { password: true, google: true })
    assert.equal(account.emailVerified, true)
    assert.equal(account.passwordHash, undefined)
    assert.equal((await call('GET', '/account')).status, 401)
  })
})

test('改密碼：舊密碼錯回 400（不是 401）；成功後舊 token 失效、新 token 可用、寄通知信', async () => {
  const Users = fakeUsers([{ _id: 'u1', email: 'a@example.com', role: 'member', passwordHash: await hashPassword('old-password'), tokenVersion: 0 }])
  const mailer = fakeMailer()
  const LoginAttempts = fakeAttempts()
  await withApp({ Users, mailer, LoginAttempts, ipRateLimit: false }, async ({ post, call }) => {
    const oldToken = tokenOf(Users.rows[0])
    const wrong = await post('/change-password', { currentPassword: 'nope-nope', newPassword: 'new-password-1' }, oldToken)
    assert.equal(wrong.status, 400)
    assert.equal(LoginAttempts.rows.get('user:u1').count, 1)

    const short = await post('/change-password', { currentPassword: 'old-password', newPassword: 'short' }, oldToken)
    assert.equal(short.status, 400)

    const ok = await post('/change-password', { currentPassword: 'old-password', newPassword: 'new-password-1' }, oldToken)
    assert.equal(ok.status, 200)
    const { token } = await ok.json()
    assert.equal(Users.rows[0].tokenVersion, 1)
    assert.equal(LoginAttempts.rows.has('user:u1'), false)
    assert.equal((await call('GET', '/account', undefined, oldToken)).status, 401)
    assert.equal((await call('GET', '/account', undefined, token)).status, 200)
    assert.equal(mailer.sent.length, 1)
    assert.match(mailer.sent[0].subject, /密碼已變更/)
    assert.equal(mailer.sent[0].to, 'a@example.com')

    assert.equal((await post('/login', { email: 'a@example.com', password: 'new-password-1' })).status, 200)
  })
})

test('改密碼：舊密碼錯 10 次就鎖住，不能拿來猜密碼', async () => {
  const Users = fakeUsers([{ _id: 'u1', email: 'a@example.com', role: 'member', passwordHash: await hashPassword('old-password') }])
  await withApp({ Users, LoginAttempts: fakeAttempts(), ipRateLimit: false }, async ({ post }) => {
    const token = tokenOf(Users.rows[0])
    for (let i = 0; i < LOCK_MAX_FAILURES; i += 1) {
      assert.equal((await post('/change-password', { currentPassword: `guess-${i}-xx`, newPassword: 'new-password-1' }, token)).status, 400)
    }
    assert.equal((await post('/change-password', { currentPassword: 'old-password', newPassword: 'new-password-1' }, token)).status, 429)
  })
})

test('改密碼：只有 Google 的帳號請走忘記密碼', async () => {
  const Users = fakeUsers([{ _id: 'u1', email: 'g@example.com', role: 'member', googleId: 'g-1' }])
  await withApp({ Users, ipRateLimit: false }, async ({ post }) => {
    const response = await post('/change-password', { currentPassword: '', newPassword: 'new-password-1' }, tokenOf(Users.rows[0]))
    assert.equal(response.status, 400)
    assert.match((await response.json()).message, /忘記密碼/)
  })
})

test('刪除帳號：密碼錯回 400；對了刪掉所有資料與帳號、寄通知信；管理者不能刪自己', async () => {
  const Users = fakeUsers([
    { _id: 'u1', email: 'a@example.com', role: 'member', passwordHash: await hashPassword('my-password') },
    { _id: 'admin', email: 'boss@example.com', role: 'admin', passwordHash: await hashPassword('my-password') },
  ])
  const deleted = []
  const mailer = fakeMailer()
  await withApp({ Users, mailer, ipRateLimit: false, deleteUserData: async (id) => deleted.push(id) }, async ({ call }) => {
    const token = tokenOf(Users.rows[0])
    assert.equal((await call('DELETE', '/me', { password: 'wrong-password' }, token)).status, 400)
    assert.equal(Users.rows.length, 2)

    const ok = await call('DELETE', '/me', { password: 'my-password' }, token)
    assert.equal(ok.status, 200)
    assert.deepEqual(deleted, ['u1'])
    assert.equal(Users.rows.some((r) => r._id === 'u1'), false)
    assert.match(mailer.sent[0].subject, /已刪除/)
    // 帳號沒了，舊 token 也不能用
    assert.equal((await call('GET', '/account', undefined, token)).status, 401)

    const admin = await call('DELETE', '/me', { password: 'my-password' }, tokenOf(Users.rows[0]))
    assert.equal(admin.status, 409)
  })
})

test('刪除帳號：只有 Google 的帳號要重新用同一個 Google 帳號確認', async () => {
  const Users = fakeUsers([{ _id: 'u1', email: 'g@example.com', role: 'member', googleId: 'g-1' }])
  const google = {
    isConfigured: () => true,
    verify: async (credential) => ({ googleId: credential === 'same' ? 'g-1' : 'g-other', email: 'x@example.com', name: '' }),
  }
  const deleted = []
  await withApp({ Users, google, ipRateLimit: false, deleteUserData: async (id) => deleted.push(id) }, async ({ call }) => {
    const token = tokenOf(Users.rows[0])
    assert.equal((await call('DELETE', '/me', { credential: 'other' }, token)).status, 400)
    assert.equal(deleted.length, 0)
    assert.equal((await call('DELETE', '/me', { credential: 'same' }, token)).status, 200)
    assert.deepEqual(deleted, ['u1'])
  })
})

test('刪除帳號的資料表清單涵蓋所有存會員資料的 model（AdminLog 除外，照留）', async () => {
  const dir = path.join(__dirname, '..', 'src', 'models')
  const withUser = fs
    .readdirSync(dir)
    .filter((file) => /user:\s*\{\s*type:\s*mongoose\.Schema\.Types\.ObjectId/.test(fs.readFileSync(path.join(dir, file), 'utf8')))
    .map((file) => file.replace(/\.js$/, ''))
  assert.deepEqual([...withUser].sort(), [...USER_DATA_MODELS].sort())

  const calls = []
  const models = Object.fromEntries(USER_DATA_MODELS.map((name) => [name, { deleteMany: async (where) => calls.push([name, where.user]) }]))
  await createUserDataDeleter(models)('u1')
  assert.equal(calls.length, USER_DATA_MODELS.length)
  assert.ok(calls.every(([, user]) => user === 'u1'))
})

test('重設密碼與 Google 綁定都會寄通知信給本人', async () => {
  const Users = fakeUsers([{ _id: 'u1', email: 'a@example.com', role: 'member', passwordHash: 'hash' }])
  const mailer = fakeMailer()
  const google = { isConfigured: () => true, verify: async () => ({ googleId: 'g-1', email: 'a@example.com', name: '' }) }
  await withApp({ Users, mailer, google, ipRateLimit: false }, async ({ post }) => {
    assert.equal((await post('/google', { credential: 'x' })).status, 200)
    assert.equal(mailer.sent.length, 1)
    assert.match(mailer.sent[0].text, /原本的密碼已經停用/)
  })
})

// 假的 EmailVerifications：findOne（tokenHash，或 user＋createdAt $gt）、create、deleteMany、deleteOne
function fakeVerifications(now) {
  const rows = []
  return {
    rows,
    findOne: async (filter) =>
      rows.find((r) => (filter.tokenHash ? r.tokenHash === filter.tokenHash : r.user === filter.user && r.createdAt > filter.createdAt.$gt)) ??
      null,
    create: async (data) => {
      const row = { _id: `v-${rows.length + 1}`, createdAt: new Date(now()), ...data }
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

test('信箱驗證：註冊後寄驗證信（只存雜湊），點連結後 emailVerified 變 true；過期或亂填無效', async () => {
  let clock = Date.UTC(2026, 10, 17, 2)
  const now = () => clock
  const Users = fakeUsers([])
  const mailer = fakeMailer()
  const EmailVerifications = fakeVerifications(now)
  const options = { Users, mailer, EmailVerifications, appUrl: 'https://example.com/app/', now, ipRateLimit: false }
  await withApp(options, async ({ post }) => {
    const created = await post('/register', { email: 'new@example.com', password: 'long-enough-password' })
    assert.equal(created.status, 201)
    assert.equal((await created.json()).verificationSent, true)
    assert.equal(mailer.sent[0].to, 'new@example.com')
    const token = mailer.sent[0].text.match(/verify-email\?token=([\w-]+)/)[1]
    assert.ok(mailer.sent[0].text.includes('https://example.com/app/verify-email?token='))
    assert.equal(EmailVerifications.rows[0].tokenHash, crypto.createHash('sha256').update(token).digest('hex'))
    assert.equal(Users.rows[0].emailVerified, undefined)

    assert.equal((await post('/verify-email', { token: 'x'.repeat(43) })).status, 400)
    const ok = await post('/verify-email', { token })
    assert.equal(ok.status, 200)
    assert.equal(Users.rows[0].emailVerified, true)
    // 用過就失效
    assert.equal((await post('/verify-email', { token })).status, 400)
  })

  // 過期：24 小時後
  const Users2 = fakeUsers([])
  const mailer2 = fakeMailer()
  await withApp({ ...options, Users: Users2, mailer: mailer2, EmailVerifications: fakeVerifications(now) }, async ({ post }) => {
    await post('/register', { email: 'late@example.com', password: 'long-enough-password' })
    const token = mailer2.sent[0].text.match(/verify-email\?token=([\w-]+)/)[1]
    clock += 24 * 60 * 60 * 1000 + 1
    assert.equal((await post('/verify-email', { token })).status, 400)
    assert.equal(Users2.rows[0].emailVerified, undefined)
  })
})

test('重寄驗證信：要登入、5 分鐘內只能寄一次、已驗證就不寄', async () => {
  let clock = Date.UTC(2026, 10, 17, 2)
  const now = () => clock
  const Users = fakeUsers([
    { _id: 'u1', email: 'a@example.com', role: 'member', passwordHash: 'hash' },
    { _id: 'u2', email: 'b@example.com', role: 'member', passwordHash: 'hash', emailVerified: true },
  ])
  const mailer = fakeMailer()
  const options = { Users, mailer, EmailVerifications: fakeVerifications(now), appUrl: 'https://example.com', now, ipRateLimit: false }
  await withApp(options, async ({ post }) => {
    assert.equal((await post('/resend-verification', {})).status, 401)
    assert.equal((await post('/resend-verification', {}, tokenOf(Users.rows[0]))).status, 200)
    assert.equal((await post('/resend-verification', {}, tokenOf(Users.rows[0]))).status, 429)
    clock += 5 * 60 * 1000 + 1
    assert.equal((await post('/resend-verification', {}, tokenOf(Users.rows[0]))).status, 200)
    assert.equal(mailer.sent.length, 2)
    const verified = await post('/resend-verification', {}, tokenOf(Users.rows[1]))
    assert.deepEqual(await verified.json(), { sent: false, verified: true })
    assert.equal(mailer.sent.length, 2)
  })
})

test('管理者只能用 Google 登入：密碼對了回 403；Google 沒設定或設了緊急開關時放行；密碼錯照樣只說登入失敗', async () => {
  const passwordHash = await hashPassword('admin-password')
  const google = { isConfigured: () => true, verify: async () => ({ googleId: 'g-admin', email: 'boss@example.com', name: '' }) }
  const rows = () => [{ _id: 'a1', email: 'boss@example.com', role: 'admin', passwordHash, googleId: 'g-admin', emailVerified: true }]

  await withApp({ Users: fakeUsers(rows()), google, ipRateLimit: false }, async ({ post }) => {
    const blocked = await post('/login', { email: 'boss@example.com', password: 'admin-password' })
    assert.equal(blocked.status, 403)
    assert.equal((await blocked.json()).message, ADMIN_GOOGLE_ONLY)
    const wrong = await post('/login', { email: 'boss@example.com', password: 'wrong-password' })
    assert.equal((await wrong.json()).message, LOGIN_FAILED)
    assert.equal((await post('/google', { credential: 'x' })).status, 200)
  })
  await withApp({ Users: fakeUsers(rows()), google: { isConfigured: () => false }, ipRateLimit: false }, async ({ post }) => {
    assert.equal((await post('/login', { email: 'boss@example.com', password: 'admin-password' })).status, 200)
  })
  await withApp({ Users: fakeUsers(rows()), google, adminPasswordLogin: true, ipRateLimit: false }, async ({ post }) => {
    assert.equal((await post('/login', { email: 'boss@example.com', password: 'admin-password' })).status, 200)
  })
})
