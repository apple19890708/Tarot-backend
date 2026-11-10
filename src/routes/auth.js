// 註冊、登入、取得目前使用者；Google 登入與忘記密碼（v17 規格 I）。路由本身不碰 mongoose 連線狀態，由 ensureDatabase 注入。
const crypto = require('crypto')
const express = require('express')
const mongoose = require('mongoose')

const UserModel = require('../models/User')
const { GoogleTokenError } = require('../services/googleAuth')
const { signToken } = require('../lib/jwt')
const {
  hashPassword,
  comparePassword,
  validateEmail,
  validatePassword,
} = require('../lib/password')

// 登入失敗一律用同一句，不透露帳號存不存在
const LOGIN_FAILED = 'email 或密碼不正確。'
const GOOGLE_ONLY = '這個帳號是用 Google 註冊的，請按「使用 Google 登入」，或用「忘記密碼」設定一組密碼。'
// 被管理者停用：密碼對了才說（密碼錯一律 LOGIN_FAILED，不透露帳號狀態）
const ACCOUNT_DISABLED = '這個帳號已被停用，請聯絡管理者。'

// 忘記密碼：重設連結的有效時間；同一個帳號多久才能再寄一封（避免被拿來轟炸別人的信箱）
const RESET_TTL_MS = 30 * 60 * 1000
const RESET_RESEND_MS = 5 * 60 * 1000

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')

// a***@gmail.com：重設頁只讓使用者確認是哪個帳號，不顯示完整信箱
function maskEmail(email) {
  const [name, domain] = email.split('@')
  return `${name.slice(0, 1)}***@${domain}`
}

function resetMail(link) {
  const text = [
    '你好：',
    '',
    '我們收到重設塔羅占卜帳號密碼的申請。請在 30 分鐘內打開下面的連結設定新密碼：',
    link,
    '',
    '如果不是你本人申請的，可以忽略這封信，你的密碼不會被更改。',
  ].join('\n')
  const html = `<div style="font-family:sans-serif;line-height:1.7;color:#222">
<p>你好：</p>
<p>我們收到重設塔羅占卜帳號密碼的申請。請在 <b>30 分鐘內</b>按下面的按鈕設定新密碼：</p>
<p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#b45309;color:#fff;text-decoration:none;border-radius:6px">設定新密碼</a></p>
<p style="color:#666;font-size:13px">按鈕打不開的話，把這個網址貼到瀏覽器：<br>${link}</p>
<p style="color:#666;font-size:13px">如果不是你本人申請的，可以忽略這封信，你的密碼不會被更改。</p>
</div>`
  return { subject: '重設你的塔羅占卜密碼', text, html }
}

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

// Users、PasswordResets、mailer、google 可注入，測試時換成假的就不必連資料庫與外部服務。
// appUrl：前端網址（含 GitHub Pages 的子路徑），重設信的連結用；只從環境變數來，不採用前端傳來的網址（避免連結被導到別的網站）
function createAuthRouter({
  ensureDatabase,
  requireAuth,
  Users = UserModel,
  PasswordResets = null,
  mailer = null,
  google = null,
  appUrl = '',
  now = () => Date.now(),
}) {
  const router = express.Router()
  const loginRateLimit = createRateLimiter()
  // 忘記密碼：同一 IP 每 15 分鐘 5 次；重設密碼：每分鐘 10 次
  const forgotRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 })
  const resetRateLimit = createRateLimiter()

  // 記下最後登入的時間與方式（管理頁用）；寫入失敗不影響登入
  async function recordLogin(user, method) {
    const at = new Date(now())
    try {
      await Users.updateOne({ _id: user._id }, { $set: { lastLoginAt: at, lastLoginMethod: method, lastActiveAt: at } })
    } catch (error) {
      console.error('記錄登入時間失敗：', error.message)
    }
  }

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
      await recordLogin(user, 'register')
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

      // 用 Google 註冊、還沒設密碼的帳號：告訴他改用 Google 登入
      if (user && !user.passwordHash && user.googleId) {
        res.status(401).json({ message: GOOGLE_ONLY })
        return
      }

      if (!user || !matched) {
        res.status(401).json({ message: LOGIN_FAILED })
        return
      }

      if (user.disabled) {
        res.status(403).json({ message: ACCOUNT_DISABLED })
        return
      }

      await recordLogin(user, 'password')
      res.json({ token: signToken(user), user: user.toPublicJSON() })
    } catch (error) {
      next(error)
    }
  })

  // ---- Google 登入／註冊 ----
  // 先找 googleId，再找同一個信箱（信箱已由 Google 驗證，綁上 googleId）；都沒有就建立新會員
  router.post('/google', loginRateLimit, async (req, res, next) => {
    try {
      if (!google?.isConfigured()) {
        res.status(503).json({ message: 'Google 登入尚未設定。' })
        return
      }
      if (!ensureDatabase(res)) return

      let profile
      try {
        profile = await google.verify(req.body.credential)
      } catch (error) {
        if (error instanceof GoogleTokenError) {
          res.status(401).json({ message: error.message })
          return
        }
        throw error
      }

      let user = await Users.findOne({ googleId: profile.googleId })
      if (!user) {
        user = await Users.findOne({ email: profile.email })
        // 停用的帳號先擋，不要在停用期間替它綁上 googleId（恢復後登入方式會被改掉）
        if (user?.disabled) {
          res.status(403).json({ message: ACCOUNT_DISABLED })
          return
        }
        if (user) {
          user.googleId = profile.googleId
          await user.save()
        } else {
          user = await Users.create({
            email: profile.email,
            googleId: profile.googleId,
            displayName: (profile.name || profile.email.split('@')[0]).slice(0, 40),
            role: 'member',
          })
          await recordLogin(user, 'register')
          res.status(201).json({ token: signToken(user), user: user.toPublicJSON(), created: true })
          return
        }
      }
      if (user.disabled) {
        res.status(403).json({ message: ACCOUNT_DISABLED })
        return
      }
      await recordLogin(user, 'google')
      res.json({ token: signToken(user), user: user.toPublicJSON() })
    } catch (error) {
      next(error)
    }
  })

  // ---- 忘記密碼 ----
  // 核對信箱：沒有這個帳號就直接說（使用者決定），有才建立憑證並寄信
  router.post('/forgot-password', forgotRateLimit, async (req, res, next) => {
    try {
      if (!mailer?.isConfigured() || !PasswordResets || !appUrl) {
        res.status(503).json({ message: '寄信功能尚未設定，暫時無法重設密碼，請聯絡管理者。' })
        return
      }
      if (!ensureDatabase(res)) return

      const { email, error: emailError } = validateEmail(req.body.email)
      if (emailError) {
        res.status(400).json({ message: emailError })
        return
      }
      const user = await Users.findOne({ email })
      if (!user) {
        res.status(404).json({ message: '這個信箱沒有註冊。請確認是不是註冊時用的信箱。' })
        return
      }

      const recent = await PasswordResets.findOne({ user: user._id, createdAt: { $gt: new Date(now() - RESET_RESEND_MS) } })
      if (recent) {
        res.status(429).json({ message: '剛剛已經寄過重設信了，請先到信箱（含垃圾郵件匣）找找看；5 分鐘後才能再寄一次。' })
        return
      }

      // 舊的憑證一律作廢，只有最新的一封信有效
      await PasswordResets.deleteMany({ user: user._id })
      const token = crypto.randomBytes(32).toString('base64url')
      const reset = await PasswordResets.create({ user: user._id, tokenHash: sha256(token), expireAt: new Date(now() + RESET_TTL_MS) })

      const link = `${appUrl.replace(/\/+$/, '')}/reset-password?token=${token}`
      try {
        await mailer.send({ to: user.email, ...resetMail(link) })
      } catch (error) {
        // 沒寄出去的憑證刪掉，使用者可以馬上再試
        await PasswordResets.deleteOne({ _id: reset._id })
        console.error('重設密碼信寄送失敗：', error.message)
        res.status(502).json({ message: '重設信暫時寄不出去，請稍後再試。' })
        return
      }
      res.json({ sent: true, email: user.email })
    } catch (error) {
      next(error)
    }
  })

  // 重設頁打開時先確認連結還能不能用（無效、過期、用過都算不能用）
  async function findValidReset(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null
    const reset = await PasswordResets.findOne({ tokenHash: sha256(token) })
    if (!reset || reset.usedAt || reset.expireAt.getTime() < now()) return null
    return reset
  }

  router.get('/reset-password/:token', resetRateLimit, async (req, res, next) => {
    try {
      if (!PasswordResets) {
        res.status(503).json({ message: '重設密碼功能尚未設定。' })
        return
      }
      if (!ensureDatabase(res)) return
      const reset = await findValidReset(req.params.token)
      const user = reset ? await Users.findById(reset.user) : null
      res.json(user ? { valid: true, email: maskEmail(user.email) } : { valid: false })
    } catch (error) {
      next(error)
    }
  })

  router.post('/reset-password', resetRateLimit, async (req, res, next) => {
    try {
      if (!PasswordResets) {
        res.status(503).json({ message: '重設密碼功能尚未設定。' })
        return
      }
      if (!ensureDatabase(res)) return

      const { password, error: passwordError } = validatePassword(req.body.password)
      if (passwordError) {
        res.status(400).json({ message: passwordError })
        return
      }
      const reset = await findValidReset(req.body.token)
      const user = reset ? await Users.findById(reset.user).select('+passwordHash') : null
      if (!user) {
        res.status(400).json({ message: '這個重設連結已經失效（超過 30 分鐘、已經用過，或有更新的一封信），請重新申請。' })
        return
      }

      user.passwordHash = await hashPassword(password)
      // 改了密碼，之前所有裝置上的登入一起失效（帳號可能是被盜才來重設的）
      user.tokenVersion = (Number.isInteger(user.tokenVersion) ? user.tokenVersion : 0) + 1
      await user.save()
      // 用過就作廢，同帳號其他還沒用的也一起刪
      await PasswordResets.deleteMany({ user: user._id })
      res.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  // 登出所有裝置：帳號的憑證版本號加 1，所有已發出的 token（含這一個）立刻失效。
  // 懷疑帳號被盜、或在別人的電腦登入忘了登出時用
  router.post('/logout-all', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      await Users.updateOne({ _id: req.auth.userId }, { $inc: { tokenVersion: 1 } })
      res.json({ ok: true })
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

module.exports = { createAuthRouter, createRateLimiter, LOGIN_FAILED, GOOGLE_ONLY, ACCOUNT_DISABLED, maskEmail }
