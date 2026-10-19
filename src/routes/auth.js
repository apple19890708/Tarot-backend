// 註冊、登入、取得目前使用者。路由本身不碰 mongoose 連線狀態，由 ensureDatabase 注入。
const express = require('express')
const mongoose = require('mongoose')

const UserModel = require('../models/User')
const { signToken } = require('../lib/jwt')
const {
  hashPassword,
  comparePassword,
  validateEmail,
  validatePassword,
} = require('../lib/password')

// 登入失敗一律用同一句，不透露帳號存不存在
const LOGIN_FAILED = 'email 或密碼不正確。'

const LOGIN_WINDOW_MS = 60 * 1000
const LOGIN_MAX_ATTEMPTS = 10

// 簡易防爆破：同一 IP 每分鐘最多 10 次登入嘗試。單機部署夠用，要擴再換 Redis。
function createRateLimiter({ windowMs = LOGIN_WINDOW_MS, max = LOGIN_MAX_ATTEMPTS } = {}) {
  const hits = new Map()

  return function rateLimit(req, res, next) {
    const key = req.ip || 'unknown'
    const now = Date.now()
    const entry = hits.get(key)

    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 })
      next()
      return
    }

    entry.count += 1
    if (entry.count > max) {
      res.status(429).json({ message: '嘗試次數過多，請稍後再試。' })
      return
    }
    next()
  }
}

// Users 可注入，測試時換成假的 model 就不必連資料庫
function createAuthRouter({ ensureDatabase, requireAuth, Users = UserModel }) {
  const router = express.Router()
  const loginRateLimit = createRateLimiter()

  router.post('/register', async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) {
        return
      }

      const { email, error: emailError } = validateEmail(req.body.email)
      if (emailError) {
        res.status(400).json({ message: emailError })
        return
      }

      const { password, error: passwordError } = validatePassword(req.body.password)
      if (passwordError) {
        res.status(400).json({ message: passwordError })
        return
      }

      const existing = await Users.findOne({ email })
      if (existing) {
        res.status(409).json({ message: '這個 email 已經註冊過了。' })
        return
      }

      const rawName = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : ''
      const user = await Users.create({
        email,
        passwordHash: await hashPassword(password),
        displayName: rawName.slice(0, 40) || email.split('@')[0],
        role: 'member',
      })

      // 註冊完直接給 token，不必再登入一次
      res.status(201).json({ token: signToken(user), user: user.toPublicJSON() })
    } catch (error) {
      // unique index 撞到時也回 409，避免兩個請求同時註冊同一個 email
      if (error && error.code === 11000) {
        res.status(409).json({ message: '這個 email 已經註冊過了。' })
        return
      }
      next(error)
    }
  })

  router.post('/login', loginRateLimit, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) {
        return
      }

      const { email, error: emailError } = validateEmail(req.body.email)
      if (emailError) {
        res.status(401).json({ message: LOGIN_FAILED })
        return
      }

      // passwordHash 在 schema 設了 select: false，這裡要明確取出來
      const user = await Users.findOne({ email }).select('+passwordHash')
      const matched = user ? await comparePassword(String(req.body.password || ''), user.passwordHash) : false

      if (!user || !matched) {
        res.status(401).json({ message: LOGIN_FAILED })
        return
      }

      res.json({ token: signToken(user), user: user.toPublicJSON() })
    } catch (error) {
      next(error)
    }
  })

  // 前端重新整理後用這支復原登入狀態
  router.get('/me', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) {
        return
      }

      const user = mongoose.isValidObjectId(req.auth.userId)
        ? await Users.findById(req.auth.userId)
        : null
      if (!user) {
        res.status(401).json({ message: '請先登入。' })
        return
      }

      res.json({ user: user.toPublicJSON() })
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createAuthRouter, createRateLimiter, LOGIN_FAILED }
