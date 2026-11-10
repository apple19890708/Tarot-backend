// 會員管理：最後登入／活動時間、停用帳號、強制登出、管理操作紀錄
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { signToken } = require('../src/lib/jwt')
const { hashPassword } = require('../src/lib/password')
const { createAuthMiddleware, ACTIVE_WRITE_MS } = require('../src/middleware/auth')
const { createAuthRouter, ACCOUNT_DISABLED, LOGIN_FAILED } = require('../src/routes/auth')
const { createAdminRouter, FILTERS, startOfTaipeiMonth } = require('../src/routes/admin')

const SECRET = 'test-secret-do-not-use-in-production'
const ADMIN_ID = '507f1f77bcf86cd799439011'
const MEMBER_ID = '507f1f77bcf86cd799439012'
const OTHER_ADMIN_ID = '507f1f77bcf86cd799439013'

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

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('驗證：被停用的帳號，token 版本號對也當成沒登入；最後活動時間一小時內只寫一次', async () => {
  let clock = Date.UTC(2026, 10, 10, 2, 0, 0)
  const user = { _id: MEMBER_ID, role: 'member', tokenVersion: 0, disabled: false, lastActiveAt: null }
  const touches = []
  const { requireAuth } = createAuthMiddleware({
    findUserById: async () => user,
    secret: SECRET,
    touchUser: async (id, at) => touches.push([String(id), at.getTime()]),
    now: () => clock,
  })
  const app = express()
  app.get('/private', requireAuth, (_req, res) => res.json({ ok: true }))
  const auth = { headers: { Authorization: `Bearer ${signToken(user, { secret: SECRET })}` } }
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/private`, auth)).status, 200)
    clock += ACTIVE_WRITE_MS - 1000
    assert.equal((await fetch(`${base}/private`, auth)).status, 200)
    clock += 2000
    assert.equal((await fetch(`${base}/private`, auth)).status, 200)
    assert.equal(touches.length, 2)

    user.disabled = true
    assert.equal((await fetch(`${base}/private`, auth)).status, 401)
  })
})

test('登入：密碼對才說帳號被停用；成功登入記下時間與方式', async () => {
  // 登入路由簽 token 用環境變數的密鑰（和 auth.test.js 同樣作法）
  process.env.JWT_SECRET = process.env.JWT_SECRET || SECRET
  const passwordHash = await hashPassword('right-password')
  const user = { _id: MEMBER_ID, email: 'a@example.com', passwordHash, role: 'member', disabled: false, toPublicJSON: () => ({ id: MEMBER_ID }) }
  const updates = []
  const Users = {
    findOne: () => ({ select: async () => user }),
    updateOne: async (filter, update) => updates.push([filter, update]),
  }
  const { requireAuth } = createAuthMiddleware({ findUserById: async () => null, secret: SECRET })
  const app = express()
  app.use(express.json())
  app.use('/api/auth', createAuthRouter({ ensureDatabase: () => true, requireAuth, Users, now: () => Date.UTC(2026, 10, 10) }))
  await withServer(app, async (base) => {
    const ok = await fetch(`${base}/api/auth/login`, json({ email: 'a@example.com', password: 'right-password' }))
    assert.equal(ok.status, 200)
    assert.equal(updates.length, 1)
    assert.equal(updates[0][1].$set.lastLoginMethod, 'password')
    assert.equal(updates[0][1].$set.lastLoginAt.getTime(), Date.UTC(2026, 10, 10))

    user.disabled = true
    const wrong = await fetch(`${base}/api/auth/login`, json({ email: 'a@example.com', password: 'wrong' }))
    assert.equal(wrong.status, 401)
    assert.equal((await wrong.json()).message, LOGIN_FAILED)
    const blocked = await fetch(`${base}/api/auth/login`, json({ email: 'a@example.com', password: 'right-password' }))
    assert.equal(blocked.status, 403)
    assert.equal((await blocked.json()).message, ACCOUNT_DISABLED)
    assert.equal(updates.length, 1)
  })
})

// ---- 管理路由（假的資料模型）----

function fakeUser(fields) {
  return {
    tokenVersion: 0,
    disabled: false,
    aiAccess: false,
    stockAccess: false,
    ...fields,
    async save() {},
    toAdminJSON() {
      return { id: this._id, role: this.role, disabled: this.disabled, aiAccess: this.aiAccess }
    },
  }
}

function buildAdmin() {
  const users = new Map(
    [
      fakeUser({ _id: ADMIN_ID, role: 'admin' }),
      fakeUser({ _id: MEMBER_ID, role: 'member' }),
      fakeUser({ _id: OTHER_ADMIN_ID, role: 'admin' }),
    ].map((u) => [u._id, u]),
  )
  const logs = []
  const models = {
    User: {
      findById: (id) => {
        const doc = users.get(String(id)) ?? null
        const query = Promise.resolve(doc)
        query.select = () => Promise.resolve(doc)
        return query
      },
      // 只支援這裡用到的 $set、$inc，以及 disabled 的 $ne 條件
      findOneAndUpdate: (filter, update) => {
        let doc = users.get(String(filter._id)) ?? null
        if (doc && filter.disabled && Boolean(doc.disabled) === filter.disabled.$ne) doc = null
        if (doc) {
          Object.assign(doc, update.$set || {})
          for (const [key, amount] of Object.entries(update.$inc || {})) doc[key] = (doc[key] || 0) + amount
        }
        return { select: async () => doc }
      },
    },
    AdminLog: { create: async (entry) => logs.push(entry) },
  }
  const requireAdmin = (req, _res, next) => {
    req.auth = { userId: ADMIN_ID, role: 'admin' }
    next()
  }
  const app = express()
  app.use(express.json())
  app.use('/api/admin', createAdminRouter({ ensureDatabase: () => true, requireAdmin, models, now: () => Date.UTC(2026, 10, 10) }))
  // 讓個別測試換掉查詢（模擬讀到舊資料）
  buildAdmin.lastModels = models
  return { app, users, logs }
}

const patch = (body) => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('停用：會員停用後版本號加 1、記一筆紀錄；不能停用自己與其他管理者；恢復不再加版本號', async () => {
  const { app, users, logs } = buildAdmin()
  await withServer(app, async (base) => {
    const self = await fetch(`${base}/api/admin/users/${ADMIN_ID}/disabled`, patch({ disabled: true }))
    assert.equal(self.status, 409)
    const otherAdmin = await fetch(`${base}/api/admin/users/${OTHER_ADMIN_ID}/disabled`, patch({ disabled: true }))
    assert.equal(otherAdmin.status, 409)
    assert.equal((await fetch(`${base}/api/admin/users/${MEMBER_ID}/disabled`, patch({ disabled: 'yes' }))).status, 400)

    const member = users.get(MEMBER_ID)
    assert.equal((await fetch(`${base}/api/admin/users/${MEMBER_ID}/disabled`, patch({ disabled: true }))).status, 200)
    assert.equal(member.disabled, true)
    assert.equal(member.tokenVersion, 1)
    assert.ok(member.disabledAt)
    // 再停用一次：沒有變化，不重複記錄，停用時間也不會被改成現在
    const firstDisabledAt = member.disabledAt
    await fetch(`${base}/api/admin/users/${MEMBER_ID}/disabled`, patch({ disabled: true }))
    assert.equal(member.tokenVersion, 1)
    assert.equal(member.disabledAt, firstDisabledAt)

    await fetch(`${base}/api/admin/users/${MEMBER_ID}/disabled`, patch({ disabled: false }))
    assert.equal(member.disabled, false)
    assert.equal(member.disabledAt, null)
    assert.equal(member.tokenVersion, 1)
    assert.deepEqual(
      logs.map((l) => l.action),
      ['disable', 'enable'],
    )
    assert.equal(String(logs[0].admin), ADMIN_ID)
  })
})

test('停用：兩位管理者同時按，讀到的都是「還沒停用」，只有先寫入的那個算數', async () => {
  const { app, users, logs } = buildAdmin()
  const member = users.get(MEMBER_ID)
  // 另一位管理者剛停用完（資料庫已是停用），這個請求讀到的卻是停用前的舊資料
  Object.assign(member, { disabled: true, tokenVersion: 1 })
  const realFindById = buildAdmin.lastModels.User.findById
  buildAdmin.lastModels.User.findById = (id) => {
    const stale = String(id) === MEMBER_ID ? { ...member, disabled: false } : null
    const query = Promise.resolve(stale ?? realFindById(id))
    query.select = () => query
    return query
  }
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/admin/users/${MEMBER_ID}/disabled`, patch({ disabled: true }))
    assert.equal(response.status, 200)
    assert.equal(member.tokenVersion, 1)
    assert.equal(logs.length, 0)
  })
})

test('強制登出：版本號加 1 並記錄；不能從這裡登出自己；權限開通也記錄，沒變化不記', async () => {
  const { app, users, logs } = buildAdmin()
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}/api/admin/users/${ADMIN_ID}/logout-all`, { method: 'POST' })).status, 409)
    assert.equal((await fetch(`${base}/api/admin/users/${MEMBER_ID}/logout-all`, { method: 'POST' })).status, 200)
    assert.equal(users.get(MEMBER_ID).tokenVersion, 1)
    assert.equal((await fetch(`${base}/api/admin/users/not-an-id/logout-all`, { method: 'POST' })).status, 404)

    await fetch(`${base}/api/admin/users/${MEMBER_ID}/ai-access`, patch({ allowed: true }))
    await fetch(`${base}/api/admin/users/${MEMBER_ID}/ai-access`, patch({ allowed: true }))
    assert.deepEqual(
      logs.map((l) => [l.action, l.value]),
      [
        ['logoutAll', null],
        ['aiAccess', true],
      ],
    )
  })
})

test('會員列表：「很久沒來」包含沒有活動紀錄的舊帳號；本月起點是台北時間 1 號', () => {
  const now = Date.UTC(2026, 10, 10)
  const condition = FILTERS.inactive(now)
  assert.deepEqual(condition.$or[1], { lastActiveAt: null })
  assert.equal(condition.$or[0].lastActiveAt.$lt.getTime(), now - 30 * 24 * 60 * 60 * 1000)
  // 台北 11/1 00:00 = UTC 10/31 16:00
  assert.equal(startOfTaipeiMonth(now).toISOString(), '2026-10-31T16:00:00.000Z')
  // 台北已經是 12/1 凌晨（UTC 還是 11/30）
  assert.equal(startOfTaipeiMonth(Date.UTC(2026, 10, 30, 17)).toISOString(), '2026-11-30T16:00:00.000Z')
})

test('停用：背景排程用的 canUseAi／canUseStock 對停用帳號一律 false（管理者也一樣）', () => {
  const User = require('../src/models/User')
  const member = new User({ email: 'm@example.com', passwordHash: 'x', aiAccess: true, stockAccess: true })
  assert.equal(member.canUseStock(), true)
  member.disabled = true
  assert.equal(member.canUseStock(), false)
  assert.equal(member.canUseAi(), false)
  const admin = new User({ email: 'a@example.com', passwordHash: 'x', role: 'admin', disabled: true })
  assert.equal(admin.canUseStock(), false)
})

test('Google 登入：同信箱的帳號被停用時回 403，而且不會被綁上 googleId', async () => {
  const user = { _id: MEMBER_ID, email: 'a@example.com', disabled: true, googleId: undefined, saved: false }
  user.save = async () => {
    user.saved = true
  }
  const Users = {
    findOne: async (where) => (where.email === 'a@example.com' ? user : null),
    updateOne: async () => {},
  }
  const google = { isConfigured: () => true, verify: async () => ({ googleId: 'g-1', email: 'a@example.com', name: 'A' }) }
  const { requireAuth } = createAuthMiddleware({ findUserById: async () => null, secret: SECRET })
  const app = express()
  app.use(express.json())
  app.use('/api/auth', createAuthRouter({ ensureDatabase: () => true, requireAuth, Users, google }))
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/auth/google`, json({ credential: 'x' }))
    assert.equal(response.status, 403)
    assert.equal((await response.json()).message, ACCOUNT_DISABLED)
    assert.equal(user.googleId, undefined)
    assert.equal(user.saved, false)
  })
})
