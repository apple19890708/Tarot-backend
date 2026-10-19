const test = require('node:test')
const assert = require('node:assert')
const express = require('express')

const { signToken, verifyToken, readBearerToken } = require('../src/lib/jwt')
const { hashPassword, comparePassword, validateEmail, validatePassword } = require('../src/lib/password')
const { createAuthMiddleware } = require('../src/middleware/auth')
const { createAuthRouter, LOGIN_FAILED } = require('../src/routes/auth')

const SECRET = 'test-secret-do-not-use-in-production'

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

test('密碼雜湊後不等於原文，compare 對得起來', async () => {
  const hash = await hashPassword('correct horse battery')
  assert.notStrictEqual(hash, 'correct horse battery')
  assert.strictEqual(await comparePassword('correct horse battery', hash), true)
  assert.strictEqual(await comparePassword('wrong password', hash), false)
  // 沒有雜湊時不應該意外通過
  assert.strictEqual(await comparePassword('anything', ''), false)
})

test('簽出來的 token 解得開，payload 的 sub 與 role 正確', () => {
  const token = signToken({ id: '507f1f77bcf86cd799439011', role: 'admin' }, { secret: SECRET })
  const payload = verifyToken(token, { secret: SECRET })
  assert.strictEqual(payload.sub, '507f1f77bcf86cd799439011')
  assert.strictEqual(payload.role, 'admin')
  // payload 只放最小集合，不應該夾帶 email 或密碼
  assert.strictEqual(payload.email, undefined)
  assert.strictEqual(payload.passwordHash, undefined)
})

test('過期的 token 驗證失敗', () => {
  const token = signToken({ id: 'abc', role: 'member' }, { secret: SECRET, expiresIn: '-1s' })
  assert.strictEqual(verifyToken(token, { secret: SECRET }), null)
})

test('被竄改或換密鑰的 token 驗證失敗', () => {
  const token = signToken({ id: 'abc', role: 'member' }, { secret: SECRET })
  const [header, payload, signature] = token.split('.')

  // 改 payload 把自己升成 admin，但簽章沒跟著改
  const forged = Buffer.from(JSON.stringify({ sub: 'abc', role: 'admin' })).toString('base64url')
  assert.strictEqual(verifyToken(`${header}.${forged}.${signature}`, { secret: SECRET }), null)

  // 用別的密鑰簽的 token 也不該通過
  assert.strictEqual(verifyToken(token, { secret: 'another-secret' }), null)

  assert.strictEqual(verifyToken('', { secret: SECRET }), null)
  assert.strictEqual(verifyToken('not-a-token', { secret: SECRET }), null)
  assert.strictEqual(verifyToken(`${header}.${payload}`, { secret: SECRET }), null)
})

test('readBearerToken 只接受 Bearer 格式', () => {
  assert.strictEqual(readBearerToken('Bearer abc.def.ghi'), 'abc.def.ghi')
  assert.strictEqual(readBearerToken('bearer abc'), 'abc')
  assert.strictEqual(readBearerToken('abc'), '')
  assert.strictEqual(readBearerToken(undefined), '')
})

test('requireAdmin：member 的 token 回 403，未帶 token 回 401', async () => {
  const users = new Map([
    ['member-id', { role: 'member' }],
    ['admin-id', { role: 'admin' }],
  ])
  const { requireAdmin } = createAuthMiddleware({
    findUserById: async (id) => users.get(id) || null,
    secret: SECRET,
  })

  const app = express()
  app.get('/admin', requireAdmin, (_req, res) => res.json({ ok: true }))

  await withServer(app, async (base) => {
    const anonymous = await fetch(`${base}/admin`)
    assert.strictEqual(anonymous.status, 401)

    const memberToken = signToken({ id: 'member-id', role: 'member' }, { secret: SECRET })
    const member = await fetch(`${base}/admin`, { headers: { Authorization: `Bearer ${memberToken}` } })
    assert.strictEqual(member.status, 403)

    // token 裡寫 admin 但資料庫是 member，也要擋下來（降權後舊 token 仍然有效的情況）
    const forgedRole = signToken({ id: 'member-id', role: 'admin' }, { secret: SECRET })
    const forged = await fetch(`${base}/admin`, { headers: { Authorization: `Bearer ${forgedRole}` } })
    assert.strictEqual(forged.status, 403)

    const adminToken = signToken({ id: 'admin-id', role: 'admin' }, { secret: SECRET })
    const admin = await fetch(`${base}/admin`, { headers: { Authorization: `Bearer ${adminToken}` } })
    assert.strictEqual(admin.status, 200)
  })
})

test('登入失敗的回應不區分「帳號不存在」與「密碼錯誤」', async () => {
  const passwordHash = await hashPassword('right-password')
  const existing = {
    _id: 'user-id',
    email: 'someone@example.com',
    passwordHash,
    role: 'member',
    toPublicJSON: () => ({ id: 'user-id', email: 'someone@example.com', role: 'member' }),
  }

  const Users = {
    findOne: ({ email }) => ({
      select: async () => (email === existing.email ? existing : null),
    }),
  }

  const { requireAuth } = createAuthMiddleware({ findUserById: async () => null, secret: SECRET })
  const app = express()
  app.use(express.json())
  app.use('/api/auth', createAuthRouter({ ensureDatabase: () => true, requireAuth, Users }))

  await withServer(app, async (base) => {
    const post = (body) =>
      fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    const noSuchUser = await post({ email: 'nobody@example.com', password: 'right-password' })
    const wrongPassword = await post({ email: 'someone@example.com', password: 'wrong-password' })
    const malformedEmail = await post({ email: 'not-an-email', password: 'right-password' })

    assert.strictEqual(noSuchUser.status, 401)
    assert.strictEqual(wrongPassword.status, 401)
    assert.strictEqual(malformedEmail.status, 401)

    const messages = await Promise.all(
      [noSuchUser, wrongPassword, malformedEmail].map(async (response) => (await response.json()).message),
    )
    assert.deepStrictEqual(messages, [LOGIN_FAILED, LOGIN_FAILED, LOGIN_FAILED])
  })
})

test('登入成功時回 token 與 user，且不含 passwordHash', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || SECRET
  const passwordHash = await hashPassword('right-password')
  const existing = {
    _id: 'user-id',
    email: 'someone@example.com',
    passwordHash,
    role: 'member',
    toPublicJSON: () => ({ id: 'user-id', email: 'someone@example.com', role: 'member' }),
  }
  const Users = { findOne: () => ({ select: async () => existing }) }

  const { requireAuth } = createAuthMiddleware({ findUserById: async () => null })
  const app = express()
  app.use(express.json())
  app.use('/api/auth', createAuthRouter({ ensureDatabase: () => true, requireAuth, Users }))

  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'someone@example.com', password: 'right-password' }),
    })
    assert.strictEqual(response.status, 200)

    const payload = await response.json()
    assert.ok(payload.token)
    assert.strictEqual(payload.user.email, 'someone@example.com')
    assert.strictEqual(payload.user.passwordHash, undefined)
  })
})

test('email 與密碼的格式檢查', () => {
  assert.ok(validateEmail('  Someone@Example.COM ').email === 'someone@example.com')
  assert.ok(validateEmail('not-an-email').error)
  assert.ok(validateEmail('').error)
  assert.ok(validatePassword('1234567').error, '少於 8 個字元要擋下來')
  assert.ok(validatePassword('12345678').password)
  assert.ok(validatePassword('a'.repeat(73)).error, '超過 72 bytes 要擋下來')
})

test('requireAiAccess：admin 可用、開通過的 member 可用、沒開通的 member 回 403', async () => {
  const users = new Map([
    ['admin-id', { role: 'admin', aiAccess: false, canUseAi: () => true }],
    ['granted-id', { role: 'member', aiAccess: true, canUseAi() { return this.role === 'admin' || this.aiAccess } }],
    ['plain-id', { role: 'member', aiAccess: false, canUseAi() { return this.role === 'admin' || this.aiAccess } }],
  ])
  const { requireAiAccess } = createAuthMiddleware({
    findUserById: async (id) => users.get(id) || null,
    secret: SECRET,
  })

  const app = express()
  app.post('/narrate', requireAiAccess, (_req, res) => res.json({ ok: true }))

  const call = (base, id) =>
    fetch(`${base}/narrate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${signToken({ id, role: users.get(id).role }, { secret: SECRET })}` },
    })

  await withServer(app, async (base) => {
    // admin 不看 aiAccess，一律放行
    assert.strictEqual((await call(base, 'admin-id')).status, 200)
    assert.strictEqual((await call(base, 'granted-id')).status, 200)

    const denied = await call(base, 'plain-id')
    assert.strictEqual(denied.status, 403)
    assert.match((await denied.json()).message, /管理者開通/)

    // 未登入仍然是 401，不是 403
    assert.strictEqual((await fetch(`${base}/narrate`, { method: 'POST' })).status, 401)
  })
})

test('權限被收回後，舊的 token 立刻失效（因為每次都回資料庫確認）', async () => {
  const user = { role: 'member', aiAccess: true, canUseAi() { return this.role === 'admin' || this.aiAccess } }
  const { requireAiAccess } = createAuthMiddleware({
    findUserById: async () => user,
    secret: SECRET,
  })

  const app = express()
  app.post('/narrate', requireAiAccess, (_req, res) => res.json({ ok: true }))
  const token = signToken({ id: 'granted-id', role: 'member' }, { secret: SECRET })

  await withServer(app, async (base) => {
    const headers = { Authorization: `Bearer ${token}` }
    assert.strictEqual((await fetch(`${base}/narrate`, { method: 'POST', headers })).status, 200)

    user.aiAccess = false
    assert.strictEqual((await fetch(`${base}/narrate`, { method: 'POST', headers })).status, 403)
  })
})
