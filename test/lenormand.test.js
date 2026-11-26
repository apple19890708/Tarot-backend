// 雷諾曼（v27 階段 1）：資料完整性、/api/lenormand 權限、管理端開關
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { cards, cardById, TONES, MEANING_KEYS, SUITS, RANKS } = require('../src/data/lenormand/cards')
const { houses } = require('../src/data/lenormand/houses')
const { spreads, spreadByKey, GRAND_COLS, GRAND_ROWS } = require('../src/data/lenormand/spreads')
const { playingCardGuide } = require('../src/data/lenormand/playingCards')
const { signToken } = require('../src/lib/jwt')
const { createAuthMiddleware, LENORMAND_DENIED } = require('../src/middleware/auth')
const { createLenormandRouter } = require('../src/routes/lenormand')
const { createAdminRouter, FILTERS } = require('../src/routes/admin')
const AdminLog = require('../src/models/AdminLog')
const User = require('../src/models/User')

const SECRET = 'test-secret-do-not-use-in-production'
const ADMIN_ID = '507f1f77bcf86cd799439011'
const MEMBER_ID = '507f1f77bcf86cd799439012'

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

// ---- 資料完整性 ----

test('牌：52 張、編號 1～52 連續、slug 唯一、1～36 是傳統牌', () => {
  assert.equal(cards.length, 52)
  cards.forEach((card, index) => assert.equal(card.id, index + 1))
  assert.equal(new Set(cards.map((c) => c.slug)).size, 52)
  assert.ok(cards.every((c) => /^[a-z]+$/.test(c.slug)))
  assert.equal(new Set(cards.map((c) => c.nameZh)).size, 52)
  assert.ok(cards.every((c) => c.traditional === c.id <= 36))
  assert.equal(cardById.get(28).slug, 'gentleman')
  assert.equal(cardById.get(29).slug, 'lady')
})

test('牌：每張都有關鍵詞、六段牌義、牌性，圖片路徑是 /lenormand/NN-slug.svg', () => {
  for (const card of cards) {
    assert.ok(card.nameZh && card.nameEn, `#${card.id} 缺名稱`)
    assert.ok(Array.isArray(card.keywords) && card.keywords.length >= 3, `#${card.id} 關鍵詞不足`)
    assert.ok(
      card.keywords.every((k) => typeof k === 'string' && k.trim() && !/[?？]/.test(k)),
      `#${card.id} 關鍵詞有空白或問號`,
    )
    assert.deepEqual(Object.keys(card.meaning).sort(), [...MEANING_KEYS].sort(), `#${card.id} 牌義段落不齊`)
    for (const key of MEANING_KEYS) {
      assert.ok(card.meaning[key].length >= 10, `#${card.id} 的 ${key} 太短`)
      // 雷諾曼沒有正逆位，牌義不能出現
      assert.doesNotMatch(card.meaning[key], /正位|逆位/, `#${card.id} 的 ${key} 提到正逆位`)
    }
    assert.ok(TONES.includes(card.tone), `#${card.id} 牌性不合法`)
    assert.equal(card.image, `/lenormand/${String(card.id).padStart(2, '0')}-${card.slug}.svg`)
    // 朝向（階段 2 和插畫一起決定）的詳細檢查在 lenormandArt.test.js
    assert.ok(card.facing === null || ['left', 'right'].includes(card.facing))
  }
})

test('牌：1～36 有撲克對應且 52 張不重複，37～52 待補（null）', () => {
  const seen = new Set()
  for (const card of cards) {
    if (card.id > 36) {
      assert.equal(card.playingCard, null, `#${card.id} 應先填 null`)
      continue
    }
    assert.ok(SUITS.includes(card.playingCard.suit), `#${card.id} 花色不合法`)
    assert.ok(RANKS.includes(card.playingCard.rank), `#${card.id} 點數不合法`)
    const key = `${card.playingCard.suit}-${card.playingCard.rank}`
    assert.ok(!seen.has(key), `#${card.id} 撲克對應重複：${key}`)
    seen.add(key)
  }
  // 傳統 36 張是每種花色的 6～10、J、Q、K、A
  for (const suit of SUITS) {
    const ranks = cards.filter((c) => c.playingCard?.suit === suit).map((c) => c.playingCard.rank)
    assert.deepEqual(ranks.sort(), ['10', '6', '7', '8', '9', 'A', 'J', 'K', 'Q'])
  }
})

test('牌：牌性照附錄 A 初稿抽查', () => {
  const tone = (id) => cardById.get(id).tone
  assert.equal(tone(1), 'neutral') // 騎士
  assert.equal(tone(2), 'positive') // 四葉草
  assert.equal(tone(8), 'negative') // 棺材
  assert.equal(tone(36), 'negative') // 十字架
  assert.equal(tone(38), 'negative') // 影子
  assert.equal(tone(52), 'positive') // 鑽石
})

test('宮位：剛好 36 個，第 n 宮對應第 n 張傳統牌', () => {
  assert.equal(houses.length, 36)
  houses.forEach((entry, index) => {
    assert.equal(entry.house, index + 1)
    assert.equal(entry.cardId, index + 1)
    assert.ok(cardById.get(entry.cardId).traditional)
    assert.ok(entry.theme)
  })
  assert.equal(houses[23].theme, '愛情')
  assert.equal(houses[34].theme, '穩定／工作')
})

test('牌陣：5 種、key 唯一、位置數等於張數、位置 key 唯一、grid 座標在範圍內且不重疊', () => {
  assert.deepEqual(
    spreads.map((s) => s.key),
    ['theme-3', 'theme-5', 'timeline-3', 'nine-box', 'grand-tableau'],
  )
  for (const spread of spreads) {
    assert.equal(spread.positions.length, spread.cardCount, `${spread.key} 位置數不等於張數`)
    assert.equal(new Set(spread.positions.map((p) => p.key)).size, spread.cardCount, `${spread.key} 位置 key 重複`)
    const cells = new Set()
    for (const position of spread.positions) {
      const { col, row } = position.layout
      assert.ok(col >= 1 && col <= spread.grid.cols && row >= 1 && row <= spread.grid.rows, `${spread.key} 座標超出`)
      assert.ok(!position.layout.overlay, `${spread.key} 不該有疊放`)
      const cell = `${col},${row}`
      assert.ok(!cells.has(cell), `${spread.key} 座標重疊：${cell}`)
      cells.add(cell)
    }
    // 順序是由左到右、由上到下（輸入實體牌的順序）
    const order = spread.positions.map((p) => (p.layout.row - 1) * spread.grid.cols + p.layout.col)
    assert.deepEqual(order, [...order].sort((a, b) => a - b), `${spread.key} 位置順序不是由左到右、由上到下`)
    for (const relation of spread.relations) {
      assert.ok(relation.from >= 0 && relation.from < spread.cardCount && relation.to >= 0 && relation.to < spread.cardCount)
      assert.ok(['modifier', 'sequence'].includes(relation.kind))
    }
    assert.ok(Array.isArray(spread.drawModes) && spread.drawModes.includes('auto') && spread.drawModes.includes('input'))
    assert.equal(spread.requiresSignificator, spread.key === 'grand-tableau')
    assert.ok(spread.positions.every((p) => p.weight === undefined), `${spread.key} 不該有權重`)
  }
})

test('牌陣：九宮格的標籤是「欄時間 × 列主題」，中心格是現在 × 現實', () => {
  const nine = spreadByKey.get('nine-box')
  assert.deepEqual(nine.grid, { cols: 3, rows: 3 })
  const center = nine.positions.find((p) => p.layout.col === 2 && p.layout.row === 2)
  assert.equal(center.label, '現在 × 現實／問題的狀況')
  assert.equal(nine.positions[0].label, '過去 × 思想／未掌握／希望的事')
  assert.equal(nine.positions[8].label, '未來 × 內心感受／已掌握的事')
})

test('牌陣：大藍圖 9×4 填滿 36 格，每格帶宮位，第 n 個位置是第 n 宮；不提供扇形抽牌', () => {
  const grand = spreadByKey.get('grand-tableau')
  assert.equal(GRAND_COLS * GRAND_ROWS, 36)
  assert.deepEqual(grand.grid, { cols: 9, rows: 4 })
  grand.positions.forEach((position, index) => {
    assert.equal(position.house, index + 1)
    assert.equal(position.houseTheme, houses[index].theme)
  })
  assert.deepEqual(grand.positions[9].layout, { col: 1, row: 2 })
  assert.ok(!grand.drawModes.includes('fan'))
})

test('撲克花色解說：四種花色、黑桃列兩種說法、註明各家說法不同', () => {
  assert.deepEqual(
    playingCardGuide.suits.map((s) => s.suit),
    ['hearts', 'diamonds', 'clubs', 'spades'],
  )
  const spades = playingCardGuide.suits.find((s) => s.suit === 'spades')
  assert.equal(spades.readings.length, 2)
  assert.match(playingCardGuide.disclaimer, /各家說法不同/)
  assert.deepEqual(
    playingCardGuide.ranks.map((r) => r.rank),
    ['K', 'Q', 'J', 'A'],
  )
})

test('資料凍結：路由回傳的共用物件改不動', () => {
  assert.ok(Object.isFrozen(cards) && Object.isFrozen(cards[0].meaning) && Object.isFrozen(cards[0].keywords))
  assert.ok(Object.isFrozen(spreads[4].positions[0].layout) && Object.isFrozen(houses[0]))
  assert.ok(Object.isFrozen(playingCardGuide.suits[3].readings[0]))
  assert.throws(() => {
    'use strict'
    cards[0].meaning.core = 'x'
  }, TypeError)
})

// ---- 權限：/api/lenormand ----

function buildLenormandApp(usersById) {
  const { requireLenormandAccess } = createAuthMiddleware({
    findUserById: async (id) => usersById[id] ?? null,
    secret: SECRET,
  })
  const app = express()
  app.use('/api/lenormand', createLenormandRouter({ requireLenormandAccess }))
  return app
}

const bearer = (user) => ({ headers: { Authorization: `Bearer ${signToken(user, { secret: SECRET })}` } })

test('權限：未登入 401、沒開通 403（固定訊息）、開通與 admin 200、停用帳號 401', async () => {
  const users = {
    plain: new User({ email: 'p@example.com', passwordHash: 'x', role: 'member' }),
    granted: new User({ email: 'g@example.com', passwordHash: 'x', role: 'member', lenormandAccess: true }),
    // 有其他權限、沒有雷諾曼權限
    others: new User({ email: 'o@example.com', passwordHash: 'x', role: 'member', aiAccess: true, stockAccess: true }),
    admin: new User({ email: 'a@example.com', passwordHash: 'x', role: 'admin' }),
  }
  const byId = Object.fromEntries(Object.values(users).map((u) => [String(u._id), u]))
  const app = buildLenormandApp(byId)
  await withServer(app, async (base) => {
    for (const path of ['/api/lenormand/cards', '/api/lenormand/spreads']) {
      assert.equal((await fetch(`${base}${path}`)).status, 401)

      for (const key of ['plain', 'others']) {
        const denied = await fetch(`${base}${path}`, bearer(users[key]))
        assert.equal(denied.status, 403, `${key} ${path}`)
        assert.equal((await denied.json()).message, '雷諾曼功能需要管理者開通，請聯絡管理者。')
      }

      assert.equal((await fetch(`${base}${path}`, bearer(users.granted))).status, 200)
      assert.equal((await fetch(`${base}${path}`, bearer(users.admin))).status, 200)
    }

    users.granted.disabled = true
    assert.equal((await fetch(`${base}/api/lenormand/cards`, bearer(users.granted))).status, 401)
    // 不存在的路徑也先過權限（router 層統一擋）
    assert.equal((await fetch(`${base}/api/lenormand/not-here`)).status, 401)
  })
  assert.equal(LENORMAND_DENIED, '雷諾曼功能需要管理者開通，請聯絡管理者。')
})

test('API 形狀：/cards 回 { cards, playingCardGuide }，/spreads 回 { spreads, houses }', async () => {
  const admin = new User({ email: 'a@example.com', passwordHash: 'x', role: 'admin' })
  const app = buildLenormandApp({ [String(admin._id)]: admin })
  await withServer(app, async (base) => {
    const cardsBody = await (await fetch(`${base}/api/lenormand/cards`, bearer(admin))).json()
    assert.deepEqual(Object.keys(cardsBody).sort(), ['cards', 'playingCardGuide'])
    assert.equal(cardsBody.cards.length, 52)
    assert.deepEqual(Object.keys(cardsBody.cards[0]).sort(), [
      'facing',
      'id',
      'image',
      'keywords',
      'meaning',
      'nameEn',
      'nameZh',
      'playingCard',
      'slug',
      'tone',
      'traditional',
    ])
    assert.deepEqual(cardsBody.cards[0].playingCard, { suit: 'hearts', rank: '9' })
    assert.equal(cardsBody.cards[51].playingCard, null)

    const spreadsBody = await (await fetch(`${base}/api/lenormand/spreads`, bearer(admin))).json()
    assert.deepEqual(Object.keys(spreadsBody).sort(), ['houses', 'spreads'])
    assert.equal(spreadsBody.spreads.length, 5)
    assert.equal(spreadsBody.houses.length, 36)
  })
})

// ---- User model ----

test('User：canUseLenormand 與 toPublicJSON／toAdminJSON 的 lenormandAccess（admin 一律 true，停用一律不行）', () => {
  const member = new User({ email: 'm@example.com', passwordHash: 'x' })
  assert.equal(member.lenormandAccess, false)
  assert.equal(member.canUseLenormand(), false)
  assert.equal(member.toPublicJSON().lenormandAccess, false)
  assert.equal(member.toAdminJSON().lenormandAccess, false)
  member.lenormandAccess = true
  assert.equal(member.canUseLenormand(), true)
  assert.equal(member.toPublicJSON().lenormandAccess, true)
  member.disabled = true
  assert.equal(member.canUseLenormand(), false)

  const admin = new User({ email: 'a@example.com', passwordHash: 'x', role: 'admin' })
  assert.equal(admin.toPublicJSON().lenormandAccess, true)
  assert.equal(admin.toAdminJSON().lenormandAccess, true)
  assert.equal(admin.canUseLenormand(), true)
  admin.disabled = true
  assert.equal(admin.canUseLenormand(), false)
  // 回應裡不會有雜湊
  assert.equal('passwordHash' in admin.toAdminJSON(), false)
})

// ---- 管理端開關 ----

function buildAdmin() {
  const users = new Map(
    [
      new User({ _id: ADMIN_ID, email: 'admin@example.com', passwordHash: 'x', role: 'admin' }),
      new User({ _id: MEMBER_ID, email: 'm@example.com', passwordHash: 'x', role: 'member', emailVerified: true }),
    ].map((u) => [String(u._id), u]),
  )
  for (const user of users.values()) user.save = async () => user
  const logs = []
  const counts = []
  const models = {
    User: {
      findById: (id) => {
        const doc = users.get(String(id)) ?? null
        const query = Promise.resolve(doc)
        query.select = () => Promise.resolve(doc)
        return query
      },
      countDocuments: async (where) => {
        counts.push(where)
        return 0
      },
      find: () => ({ select: () => ({ sort: () => ({ skip: () => ({ limit: async () => [] }) }) }) }),
    },
    AdminLog: { create: async (entry) => logs.push(entry) },
  }
  const requireAdmin = (req, _res, next) => {
    req.auth = { userId: ADMIN_ID, role: 'admin' }
    next()
  }
  const app = express()
  app.use(express.json())
  app.use('/api/admin', createAdminRouter({ ensureDatabase: () => true, requireAdmin, models, now: () => Date.UTC(2026, 10, 25) }))
  return { app, users, logs, counts }
}

const patch = (body) => ({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('管理端：開通／收回雷諾曼、寫入 AdminLog（action lenormandAccess），回傳 { user }', async () => {
  const { app, users, logs } = buildAdmin()
  const url = (id) => `/api/admin/users/${id}/lenormand-access`
  await withServer(app, async (base) => {
    assert.equal((await fetch(`${base}${url(MEMBER_ID)}`, patch({ allowed: 'yes' }))).status, 400)

    const granted = await fetch(`${base}${url(MEMBER_ID)}`, patch({ allowed: true }))
    assert.equal(granted.status, 200)
    const body = await granted.json()
    assert.deepEqual(Object.keys(body), ['user'])
    assert.equal(body.user.lenormandAccess, true)
    assert.equal(body.user.id, MEMBER_ID)
    assert.equal('passwordHash' in body.user, false)
    assert.equal(users.get(MEMBER_ID).lenormandAccess, true)

    // 沒有變化不重複記錄
    await fetch(`${base}${url(MEMBER_ID)}`, patch({ allowed: true }))
    await fetch(`${base}${url(MEMBER_ID)}`, patch({ allowed: false }))
    assert.equal(users.get(MEMBER_ID).lenormandAccess, false)
    assert.deepEqual(
      logs.map((l) => [l.action, l.value, String(l.admin), String(l.target)]),
      [
        ['lenormandAccess', true, ADMIN_ID, MEMBER_ID],
        ['lenormandAccess', false, ADMIN_ID, MEMBER_ID],
      ],
    )
    assert.equal((await fetch(`${base}${url('not-an-id')}`, patch({ allowed: true }))).status, 404)
  })
  assert.ok(AdminLog.ACTIONS.includes('lenormandAccess'))
  // AdminLog schema 也收這個 action（enum 驗證）
  const entry = new AdminLog({ admin: ADMIN_ID, target: MEMBER_ID, action: 'lenormandAccess', value: true })
  await entry.validate()
})

test('管理端：信箱未驗證的會員不能開通雷諾曼（409），管理者也回 409；都不寫紀錄', async () => {
  const { app, users, logs } = buildAdmin()
  users.get(MEMBER_ID).emailVerified = false
  await withServer(app, async (base) => {
    const unverified = await fetch(`${base}/api/admin/users/${MEMBER_ID}/lenormand-access`, patch({ allowed: true }))
    assert.equal(unverified.status, 409)
    assert.match((await unverified.json()).message, /信箱還沒驗證.*雷諾曼/)
    assert.equal(users.get(MEMBER_ID).lenormandAccess, false)

    const admin = await fetch(`${base}/api/admin/users/${ADMIN_ID}/lenormand-access`, patch({ allowed: false }))
    assert.equal(admin.status, 409)
    assert.match((await admin.json()).message, /管理者本來就能使用雷諾曼/)
  })
  assert.equal(logs.length, 0)
})

test('管理端：會員列表統計有 lenormandMembers，篩選 lenormand 只找開通的會員', async () => {
  assert.deepEqual(FILTERS.lenormand(), { role: 'member', lenormandAccess: true })
  const { app, counts } = buildAdmin()
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/admin/users?filter=lenormand`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.filter, 'lenormand')
    assert.equal(body.stats.lenormandMembers, 0)
    assert.ok(counts.some((where) => where.lenormandAccess === true && where.role === 'member' && !where.$and))
  })
})
