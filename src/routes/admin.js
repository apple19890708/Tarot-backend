// 管理者專用路由。掛載時整個 router 都會先過 requireAdmin。
// 會員列表（搜尋、篩選、排序、頁首統計）、單一會員詳細（使用量）、開通／收回權限、停用／恢復、強制登出、管理操作紀錄。
// 資料模型以參數注入（models），測試時不必連資料庫。
const express = require('express')
const mongoose = require('mongoose')

const DEFAULT_MODELS = {
  User: require('../models/User'),
  AdminLog: require('../models/AdminLog'),
  Reading: require('../models/Reading'),
  MarketAiUsage: require('../models/MarketAiUsage'),
  MarketAnalysis: require('../models/MarketAnalysis'),
  FinanceNewsAnalysis: require('../models/FinanceNewsAnalysis'),
  MarketWatch: require('../models/MarketWatch'),
  MarketAlert: require('../models/MarketAlert'),
  PushSubscription: require('../models/PushSubscription'),
}
const { startOfTaipeiDay, DAILY_LIMIT: STOCK_AI_DAILY_LIMIT } = require('./marketAnalysis')
const { DAILY_LIMIT: NEWS_AI_DAILY_LIMIT } = require('./financeNews')

const PAGE_SIZE_DEFAULT = 20
const PAGE_SIZE_MAX = 100
const DAY_MS = 24 * 60 * 60 * 1000
// 多久沒有活動算「很久沒來」
const INACTIVE_DAYS = 30
const ACTIVE_DAYS = 7
const SEARCH_MAX = 100
// 頁碼上限：太大的數字會讓 skip 超過資料庫能處理的範圍（回 500）
const MAX_PAGE = 10000

const FILTERS = {
  all: () => ({}),
  admin: () => ({ role: 'admin' }),
  ai: () => ({ role: 'member', aiAccess: true }),
  stock: () => ({ role: 'member', stockAccess: true }),
  // 沒有活動紀錄（功能上線前的舊帳號、註冊後沒再用）也算
  inactive: (now) => ({ $or: [{ lastActiveAt: { $lt: new Date(now - INACTIVE_DAYS * DAY_MS) } }, { lastActiveAt: null }] }),
  disabled: () => ({ disabled: true }),
}
const SORTS = {
  created: { createdAt: -1 },
  active: { lastActiveAt: -1, createdAt: -1 },
  login: { lastLoginAt: -1, createdAt: -1 },
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 台北時間這個月 1 號 00:00
function startOfTaipeiMonth(nowMs) {
  const day = startOfTaipeiDay(nowMs)
  const ymd = new Date(day.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 7)
  return new Date(`${ymd}-01T00:00:00+08:00`)
}

function createAdminRouter({ ensureDatabase, requireAdmin, models = DEFAULT_MODELS, now = () => Date.now() }) {
  const { User, AdminLog } = models
  const router = express.Router()

  router.use(requireAdmin)

  // 找會員；id 不合法或找不到回 404（已回應時回 null）
  async function findTarget(req, res, { withPassword = false } = {}) {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: '找不到這位使用者。' })
      return null
    }
    const query = User.findById(req.params.id)
    const user = await (withPassword ? query.select('+passwordHash') : query)
    if (!user) {
      res.status(404).json({ message: '找不到這位使用者。' })
      return null
    }
    return user
  }

  // 寫紀錄失敗不影響操作本身
  async function log(req, target, action, value = null) {
    try {
      await AdminLog.create({ admin: req.auth.userId, target: target._id, action, value })
    } catch (error) {
      console.error('管理操作紀錄寫入失敗：', error.message)
    }
  }

  router.get('/users', async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return

      const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1))
      const requestedSize = Number.parseInt(req.query.pageSize || '', 10)
      const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number.isNaN(requestedSize) ? PAGE_SIZE_DEFAULT : requestedSize))
      const filterKey = Object.hasOwn(FILTERS, req.query.filter) ? req.query.filter : 'all'
      const sortKey = Object.hasOwn(SORTS, req.query.sort) ? req.query.sort : 'created'
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, SEARCH_MAX) : ''
      const nowMs = now()

      const conditions = [FILTERS[filterKey](nowMs)]
      if (q) {
        const pattern = new RegExp(escapeRegex(q), 'i')
        conditions.push({ $or: [{ email: pattern }, { displayName: pattern }] })
      }
      const where = { $and: conditions }

      const [matched, users, stats] = await Promise.all([
        User.countDocuments(where),
        User.find(where)
          .select('+passwordHash')
          .sort(SORTS[sortKey])
          .skip((page - 1) * pageSize)
          .limit(pageSize),
        // 頁首統計（不受搜尋、篩選影響）
        Promise.all([
          User.countDocuments({}),
          User.countDocuments({ lastActiveAt: { $gte: new Date(nowMs - ACTIVE_DAYS * DAY_MS) } }),
          User.countDocuments({ createdAt: { $gte: startOfTaipeiMonth(nowMs) } }),
          User.countDocuments({ role: 'member', aiAccess: true }),
          User.countDocuments({ role: 'member', stockAccess: true }),
          User.countDocuments({ disabled: true }),
        ]).then(([total, active7d, newThisMonth, aiMembers, stockMembers, disabled]) => ({
          total,
          active7d,
          newThisMonth,
          aiMembers,
          stockMembers,
          disabled,
        })),
      ])

      res.json({
        page,
        pageSize,
        // total 是符合目前搜尋、篩選的人數（分頁用）
        total: matched,
        filter: filterKey,
        sort: sortKey,
        q,
        stats,
        users: users.map((user) => user.toAdminJSON()),
      })
    } catch (error) {
      next(error)
    }
  })

  // 單一會員的詳細：使用量與最近的管理操作
  router.get('/users/:id', async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const user = await findTarget(req, res, { withPassword: true })
      if (!user) return
      const id = user._id
      const nowMs = now()
      const today = startOfTaipeiDay(nowMs)
      const since30 = new Date(nowMs - INACTIVE_DAYS * DAY_MS)
      const count = (Model, where) => (Model ? Model.countDocuments(where) : Promise.resolve(null))
      const [readings, readings30, stockAiToday, newsAiToday, stockAnalyses, newsAnalyses, watches, activeAlerts, pushDevices, logs] =
        await Promise.all([
          count(models.Reading, { user: id }),
          count(models.Reading, { user: id, createdAt: { $gte: since30 } }),
          count(models.MarketAiUsage, { user: id, kind: 'stock', createdAt: { $gte: today } }),
          count(models.MarketAiUsage, { user: id, kind: 'news', createdAt: { $gte: today } }),
          count(models.MarketAnalysis, { user: id }),
          count(models.FinanceNewsAnalysis, { user: id }),
          count(models.MarketWatch, { user: id }),
          count(models.MarketAlert, { user: id, active: true }),
          count(models.PushSubscription, { user: id }),
          AdminLog.find({ target: id }).sort({ createdAt: -1 }).limit(10).populate('admin', 'email displayName').lean(),
        ])

      res.json({
        user: user.toAdminJSON(),
        usage: {
          readings: { total: readings, last30Days: readings30 },
          // 今天的 AI 次數與每日上限（admin 不限，上限給 null）
          ai: {
            stockToday: stockAiToday,
            newsToday: newsAiToday,
            stockLimit: user.role === 'admin' ? null : STOCK_AI_DAILY_LIMIT,
            newsLimit: user.role === 'admin' ? null : NEWS_AI_DAILY_LIMIT,
            stockAnalyses,
            newsAnalyses,
          },
          market: { watches, activeAlerts, pushDevices },
        },
        logs: logs.map(logJSON),
      })
    } catch (error) {
      next(error)
    }
  })

  // 開通／收回會員的權限：AI 解析（aiAccess）、金融股市（stockAccess）
  router.patch('/users/:id/ai-access', updateAccess('aiAccess', 'AI 解析'))
  router.patch('/users/:id/stock-access', updateAccess('stockAccess', '金融股市功能'))

  function updateAccess(field, label) {
    return async (req, res, next) => {
      try {
        if (!ensureDatabase(res)) return

        if (typeof req.body.allowed !== 'boolean') {
          res.status(400).json({ message: 'allowed 必須是 true 或 false。' })
          return
        }

        const user = await findTarget(req, res, { withPassword: true })
        if (!user) return

        // admin 本來就有權限，不需要也不應該被這支關掉
        if (user.role === 'admin') {
          res.status(409).json({ message: `管理者本來就能使用${label}，不需要開通。` })
          return
        }

        const changed = Boolean(user[field]) !== req.body.allowed
        user[field] = req.body.allowed
        await user.save()
        if (changed) await log(req, user, field, req.body.allowed)

        res.json({ user: user.toAdminJSON() })
      } catch (error) {
        next(error)
      }
    }
  }

  // 停用或恢復帳號。停用時憑證版本號加 1，所有裝置立刻登出；不能停用自己與其他管理者（避免把管理者全部鎖在外面）
  router.patch('/users/:id/disabled', async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (typeof req.body.disabled !== 'boolean') {
        res.status(400).json({ message: 'disabled 必須是 true 或 false。' })
        return
      }
      const user = await findTarget(req, res, { withPassword: true })
      if (!user) return
      if (String(user._id) === String(req.auth.userId)) {
        res.status(409).json({ message: '不能停用自己的帳號。' })
        return
      }
      if (user.role === 'admin') {
        res.status(409).json({ message: '不能停用管理者帳號。' })
        return
      }
      // 沒有變化（例如重複點擊）就原樣回傳：不改停用時間、不加版本號、不記錄
      if (Boolean(user.disabled) === req.body.disabled) {
        res.json({ user: user.toAdminJSON() })
        return
      }
      // 版本號用 $inc 原子地加：先讀再寫的話，會員同時重設密碼時兩邊會寫成同一個數字，舊 token 不會失效
      const update = req.body.disabled
        ? { $set: { disabled: true, disabledAt: new Date(now()) }, $inc: { tokenVersion: 1 } }
        : { $set: { disabled: false, disabledAt: null } }
      // 條件帶上「目前還不是目標狀態」：兩位管理者同時按停用時，只有一個會真的更新（版本號只加一次、只記一筆）
      const updated = await User.findOneAndUpdate({ _id: user._id, disabled: { $ne: req.body.disabled } }, update, {
        new: true,
      }).select('+passwordHash')
      if (!updated) {
        const current = await findTarget(req, res, { withPassword: true })
        if (current) res.json({ user: current.toAdminJSON() })
        return
      }
      await log(req, user, req.body.disabled ? 'disable' : 'enable')
      res.json({ user: updated.toAdminJSON() })
    } catch (error) {
      next(error)
    }
  })

  // 強制登出這位會員的所有裝置（憑證版本號加 1）。自己的請用水晶球選單的登出
  router.post('/users/:id/logout-all', async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const user = await findTarget(req, res, { withPassword: true })
      if (!user) return
      if (String(user._id) === String(req.auth.userId)) {
        res.status(409).json({ message: '不能從這裡登出自己。' })
        return
      }
      // 原子地加 1（理由同停用）
      const updated = await User.findOneAndUpdate({ _id: user._id }, { $inc: { tokenVersion: 1 } }, { new: true }).select('+passwordHash')
      await log(req, user, 'logoutAll')
      res.json({ user: updated.toAdminJSON() })
    } catch (error) {
      next(error)
    }
  })

  // 管理操作紀錄（全部會員，新到舊）
  router.get('/logs', async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1))
      const pageSize = 30
      const [total, logs] = await Promise.all([
        AdminLog.countDocuments({}),
        AdminLog.find({})
          .sort({ createdAt: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize)
          .populate('admin', 'email displayName')
          .populate('target', 'email displayName')
          .lean(),
      ])
      res.json({ page, pageSize, total, logs: logs.map(logJSON) })
    } catch (error) {
      next(error)
    }
  })

  return router
}

// 被 populate 的帳號只給 email 與名稱；帳號已被刪除時是 null
function personOf(value) {
  if (!value || typeof value !== 'object' || !value.email) return null
  return { id: String(value._id), email: value.email, displayName: value.displayName || value.email.split('@')[0] }
}

function logJSON(entry) {
  return {
    id: String(entry._id),
    action: entry.action,
    value: entry.value ?? null,
    createdAt: entry.createdAt,
    admin: personOf(entry.admin),
    target: personOf(entry.target),
  }
}

module.exports = { createAdminRouter, FILTERS, SORTS, startOfTaipeiMonth }
