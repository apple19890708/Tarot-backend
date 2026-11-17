// 註冊、登入、取得目前使用者；Google 登入與忘記密碼（v17 規格 I）。路由本身不碰 mongoose 連線狀態，由 ensureDatabase 注入。
const crypto = require('crypto')
const express = require('express')
const mongoose = require('mongoose')
const { rateLimit } = require('express-rate-limit')

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
    '我們收到重設 Tarot Bar 帳號密碼的申請。請在 30 分鐘內打開下面的連結設定新密碼：',
    link,
    '',
    '如果不是你本人申請的，可以忽略這封信，你的密碼不會被更改。',
  ].join('\n')
  const html = `<div style="font-family:sans-serif;line-height:1.7;color:#222">
<p>你好：</p>
<p>我們收到重設 Tarot Bar 帳號密碼的申請。請在 <b>30 分鐘內</b>按下面的按鈕設定新密碼：</p>
<p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#b45309;color:#fff;text-decoration:none;border-radius:6px">設定新密碼</a></p>
<p style="color:#666;font-size:13px">按鈕打不開的話，把這個網址貼到瀏覽器：<br>${link}</p>
<p style="color:#666;font-size:13px">如果不是你本人申請的，可以忽略這封信，你的密碼不會被更改。</p>
</div>`
  return { subject: '重設你的 Tarot Bar 密碼', text, html }
}

// 帳號異動通知信（v24 2-2）：密碼被重設、改了密碼、綁上 Google、帳號被刪除時寄給本人，被盜時才會發現
const NOTICES = {
  passwordReset: {
    subject: '你的 Tarot Bar 密碼已重設',
    body: '你的帳號密碼剛剛透過「忘記密碼」的重設信改掉了，所有裝置都已登出。',
  },
  passwordChanged: {
    subject: '你的 Tarot Bar 密碼已變更',
    body: '你的帳號密碼剛剛在帳號設定頁改掉了，其他裝置都已登出。',
  },
  googleLinked: {
    subject: '你的 Tarot Bar 帳號已綁定 Google 登入',
    body: '你的帳號剛剛綁定了 Google 登入，之後可以直接用 Google 登入。',
  },
  googleLinkedPasswordCleared: {
    subject: '你的 Tarot Bar 帳號已綁定 Google 登入',
    body:
      '你的帳號剛剛綁定了 Google 登入。因為這個信箱之前用密碼註冊、但還沒驗證過，原本的密碼已經停用、所有裝置都已登出；想用密碼登入的話，請到登入頁按「忘記密碼」重新設定一組。',
  },
  deleted: {
    subject: '你的 Tarot Bar 帳號已刪除',
    body: '你的帳號和所有占卜紀錄、股市追蹤資料都已經刪除，無法復原。',
  },
}

// 註冊後的信箱驗證信（v24 3-1）
function verifyMail(link) {
  const text = [
    '你好：',
    '',
    '歡迎來到 Tarot Bar。請在 24 小時內打開下面的連結，確認這個信箱是你的：',
    link,
    '',
    '如果你沒有註冊 Tarot Bar，可以忽略這封信。',
  ].join('\n')
  const html = `<div style="font-family:sans-serif;line-height:1.7;color:#222">
<p>你好：</p>
<p>歡迎來到 Tarot Bar。請在 <b>24 小時內</b>按下面的按鈕，確認這個信箱是你的：</p>
<p><a href="${link}" style="display:inline-block;padding:10px 20px;background:#b45309;color:#fff;text-decoration:none;border-radius:6px">驗證信箱</a></p>
<p style="color:#666;font-size:13px">按鈕打不開的話，把這個網址貼到瀏覽器：<br>${link}</p>
<p style="color:#666;font-size:13px">如果你沒有註冊 Tarot Bar，可以忽略這封信。</p>
</div>`
  return { subject: '請驗證你的 Tarot Bar 信箱', text, html }
}

function taipeiTime(ms) {
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ms))
}

function noticeMail(kind, atMs) {
  const notice = NOTICES[kind]
  const when = `時間：${taipeiTime(atMs)}（台北時間）`
  const warning = kind === 'deleted' ? '' : '如果不是你本人做的，請立刻用「忘記密碼」重設密碼，並聯絡管理者。'
  const text = ['你好：', '', notice.body, when, '', warning].join('\n').trimEnd()
  const html = `<div style="font-family:sans-serif;line-height:1.7;color:#222">
<p>你好：</p>
<p>${notice.body}</p>
<p style="color:#666;font-size:13px">${when}</p>
${warning ? `<p style="color:#b91c1c">${warning}</p>` : ''}
</div>`
  return { subject: notice.subject, text, html }
}

const LOGIN_WINDOW_MS = 60 * 1000
const LOGIN_MAX_ATTEMPTS = 10
const TOO_MANY = '嘗試次數過多，請稍後再試。'

// 同一 IP 的限速（v24 1-2，改用 express-rate-limit）。計數放在記憶體：Cloud Run 重開會歸零、
// 多個實例各算各的，只當第一道；擋「換 IP 猜同一個帳號」的是下面存在 MongoDB 的帳號鎖定
function createRateLimiter({ windowMs = LOGIN_WINDOW_MS, max = LOGIN_MAX_ATTEMPTS } = {}) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: TOO_MANY },
  })
}

// 同一帳號（email）連續登入失敗就暫時鎖住（v24 1-3）。不管帳號存不存在都計數，回應一律同一句，
// 不透露有沒有這個帳號。只擋密碼登入：Google 登入、忘記密碼不受影響，本人被惡意鎖住時還有路進來
const LOCK_MAX_FAILURES = 10
const LOCK_MS = 15 * 60 * 1000
const LOCKED = '這個帳號登入失敗太多次，請 15 分鐘後再試，或用「忘記密碼」重設。'

// 信箱驗證信的有效時間；同一個帳號多久才能再寄一封
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000
const VERIFY_RESEND_MS = 5 * 60 * 1000

// 管理者只能用 Google 登入（v24 3-2 方案 A）：管理者能開權限、停用會員，兩步驟驗證交給 Google 帳號本身。
// Google 登入沒設定時不擋（否則管理者完全進不來）；緊急時設環境變數 ADMIN_PASSWORD_LOGIN=1 暫時放行密碼登入
const ADMIN_GOOGLE_ONLY = '管理者帳號請按「使用 Google 登入」。'

// 註冊：同一 IP 每小時 5 個（v24 1-2）
const REGISTER_WINDOW_MS = 60 * 60 * 1000
const REGISTER_MAX = 5

// Users、PasswordResets、mailer、google 可注入，測試時換成假的就不必連資料庫與外部服務。
// appUrl：前端網址（含 GitHub Pages 的子路徑），重設信的連結用；只從環境變數來，不採用前端傳來的網址（避免連結被導到別的網站）
function createAuthRouter({
  ensureDatabase,
  requireAuth,
  Users = UserModel,
  PasswordResets = null,
  // 登入失敗計數（models/LoginAttempt）；沒傳時不鎖帳號（測試不連資料庫）
  LoginAttempts = null,
  // 同一 IP 的限速；測試帳號鎖定時關掉，免得先被 IP 限速擋下
  ipRateLimit = true,
  // 刪除帳號時清掉這位會員所有資料（services/accountDeletion.js）；沒傳時刪除帳號回 503
  deleteUserData = null,
  // 信箱驗證憑證（models/EmailVerification）；沒傳時不寄驗證信
  EmailVerifications = null,
  // 管理者能不能用密碼登入（v24 3-2）；預設看環境變數，只在 Google 登入沒設定或緊急時放行
  adminPasswordLogin = process.env.ADMIN_PASSWORD_LOGIN === '1',
  mailer = null,
  google = null,
  appUrl = '',
  now = () => Date.now(),
}) {
  const router = express.Router()
  const limiter = (options) => (ipRateLimit ? createRateLimiter(options) : (_req, _res, next) => next())
  const loginRateLimit = limiter()
  const registerRateLimit = limiter({ windowMs: REGISTER_WINDOW_MS, max: REGISTER_MAX })
  // 忘記密碼：同一 IP 每 15 分鐘 5 次；重設密碼：每分鐘 10 次
  const forgotRateLimit = limiter({ windowMs: 15 * 60 * 1000, max: 5 })
  const resetRateLimit = limiter()

  // 記下最後登入的時間與方式（管理頁用）；寫入失敗不影響登入
  async function recordLogin(user, method) {
    const at = new Date(now())
    try {
      await Users.updateOne({ _id: user._id }, { $set: { lastLoginAt: at, lastLoginMethod: method, lastActiveAt: at } })
    } catch (error) {
      console.error('記錄登入時間失敗：', error.message)
    }
  }

  // 寄帳號異動通知信；沒設定寄信或寄失敗都不影響操作本身
  async function notifyAccount(user, kind) {
    if (!mailer?.isConfigured() || !user?.email) return
    try {
      await mailer.send({ to: user.email, ...noticeMail(kind, now()) })
    } catch (error) {
      console.error('帳號通知信寄送失敗：', error.message)
    }
  }

  // ---- 信箱驗證（v24 3-1）----
  const canVerify = () => Boolean(mailer?.isConfigured() && EmailVerifications && appUrl)

  // 寄驗證信；回傳有沒有寄出。舊的憑證一律作廢，只有最新的一封有效
  async function sendVerification(user) {
    if (!canVerify()) return false
    await EmailVerifications.deleteMany({ user: user._id })
    const token = crypto.randomBytes(32).toString('base64url')
    const record = await EmailVerifications.create({ user: user._id, tokenHash: sha256(token), expireAt: new Date(now() + VERIFY_TTL_MS) })
    const link = `${appUrl.replace(/\/+$/, '')}/verify-email?token=${token}`
    try {
      await mailer.send({ to: user.email, ...verifyMail(link) })
      return true
    } catch (error) {
      await EmailVerifications.deleteOne({ _id: record._id })
      console.error('驗證信寄送失敗：', error.message)
      return false
    }
  }

  // ---- 帳號鎖定（v24 1-3）----
  // 計數過期時間每次失敗往後延：最後一次失敗後 15 分鐘沒再錯就歸零；TTL 每分鐘才清一次，所以這裡自己也比對時間
  async function isLocked(key) {
    if (!LoginAttempts) return false
    const entry = await LoginAttempts.findOne({ key })
    return Boolean(entry && entry.count >= LOCK_MAX_FAILURES && entry.expireAt.getTime() > now())
  }
  async function recordFailure(key) {
    if (!LoginAttempts) return
    const existing = await LoginAttempts.findOne({ key })
    const expired = existing && existing.expireAt.getTime() <= now()
    const expireAt = new Date(now() + LOCK_MS)
    if (!existing || expired) {
      await LoginAttempts.findOneAndUpdate({ key }, { $set: { count: 1, expireAt } }, { upsert: true })
      return
    }
    await LoginAttempts.updateOne({ key }, { $inc: { count: 1 }, $set: { expireAt } })
  }
  async function clearFailures(key) {
    if (!LoginAttempts) return
    await LoginAttempts.deleteOne({ key })
  }

  router.post('/register', registerRateLimit, async (req, res, next) => {
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

      // 註冊完直接給 token，不必再登入一次；同時寄驗證信（寄不出去不影響註冊，之後可以在帳號設定頁重寄）
      await recordLogin(user, 'register')
      const verificationSent = await sendVerification(user)
      res.status(201).json({ token: signToken(user), user: user.toPublicJSON(), verificationSent })
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

      const lockKey = `email:${email}`
      if (await isLocked(lockKey)) {
        res.status(429).json({ message: LOCKED })
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
        await recordFailure(lockKey)
        res.status(401).json({ message: LOGIN_FAILED })
        return
      }

      if (user.disabled) {
        res.status(403).json({ message: ACCOUNT_DISABLED })
        return
      }

      // 密碼對了才說（密碼錯一律 LOGIN_FAILED，不透露誰是管理者）
      if (user.role === 'admin' && google?.isConfigured() && !adminPasswordLogin) {
        await clearFailures(lockKey)
        res.status(403).json({ message: ADMIN_GOOGLE_ONLY })
        return
      }

      await clearFailures(lockKey)
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
      // 這次綁 Google 時清掉了沒驗證過的舊密碼（前端要告訴使用者改用 Google 或忘記密碼）
      let passwordCleared = false
      // 舊的 Google 帳號（v24 以前建立）沒有 emailVerified：用 Google 登入過就補上
      if (user && !user.emailVerified && !user.disabled) {
        user.emailVerified = true
        await user.save()
      }
      if (!user) {
        user = await Users.findOne({ email: profile.email }).select('+passwordHash')
        // 停用的帳號先擋，不要在停用期間替它綁上 googleId（恢復後登入方式會被改掉）
        if (user?.disabled) {
          res.status(403).json({ message: ACCOUNT_DISABLED })
          return
        }
        if (user) {
          // 帳號被預先佔用（v24 1-1）：註冊不驗證信箱，別人可以先用這個信箱設一組密碼。
          // 信箱沒驗證過的帳號綁 Google 時，清掉那組密碼、所有裝置登出；本人要用密碼再走忘記密碼設一組
          if (!user.emailVerified && user.passwordHash) {
            user.passwordHash = undefined
            user.tokenVersion = (Number.isInteger(user.tokenVersion) ? user.tokenVersion : 0) + 1
            passwordCleared = true
          }
          user.googleId = profile.googleId
          user.emailVerified = true
          await user.save()
          await notifyAccount(user, passwordCleared ? 'googleLinkedPasswordCleared' : 'googleLinked')
        } else {
          user = await Users.create({
            email: profile.email,
            googleId: profile.googleId,
            emailVerified: true,
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
      res.json({ token: signToken(user), user: user.toPublicJSON(), ...(passwordCleared ? { passwordCleared: true } : {}) })
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
      // 收得到重設信，就代表信箱是他的（v24 1-1）
      user.emailVerified = true
      // 改了密碼，之前所有裝置上的登入一起失效（帳號可能是被盜才來重設的）
      user.tokenVersion = (Number.isInteger(user.tokenVersion) ? user.tokenVersion : 0) + 1
      await user.save()
      // 用過就作廢，同帳號其他還沒用的也一起刪
      await PasswordResets.deleteMany({ user: user._id })
      // 重設成功就解除登入失敗的鎖定
      await clearFailures(`email:${user.email}`)
      await notifyAccount(user, 'passwordReset')
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

  // ---- 帳號設定頁（v24 階段 2）----
  const changeRateLimit = limiter()
  const WRONG_PASSWORD = '目前的密碼不正確。'
  // 改密碼、刪帳號都要再核對一次密碼：用「user:id」計數，舊密碼不能拿來無限猜
  const PASSWORD_LOCKED = '密碼錯太多次，請 15 分鐘後再試，或用「忘記密碼」重設。'

  async function findSelf(req, res) {
    // token 的 sub 是後端自己簽的帳號 id
    const user = await Users.findById(req.auth.userId).select('+passwordHash')
    if (!user) res.status(401).json({ message: '請先登入。' })
    return user
  }

  // 核對密碼（有設密碼的帳號）。不通過時已經回應，回傳 false
  async function confirmPassword(user, given, res) {
    const lockKey = `user:${user._id}`
    if (await isLocked(lockKey)) {
      res.status(429).json({ message: PASSWORD_LOCKED })
      return false
    }
    if (!(await comparePassword(String(given || ''), user.passwordHash))) {
      await recordFailure(lockKey)
      // 不回 401：前端收到 401 會當成登出
      res.status(400).json({ message: WRONG_PASSWORD })
      return false
    }
    await clearFailures(lockKey)
    return true
  }

  // 帳號設定頁要的資料：登入方式（有沒有密碼、有沒有綁 Google）
  router.get('/account', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const user = await findSelf(req, res)
      if (!user) return
      res.json({
        account: {
          ...user.toPublicJSON(),
          emailVerified: Boolean(user.emailVerified),
          loginMethods: { password: Boolean(user.passwordHash), google: Boolean(user.googleId) },
        },
      })
    } catch (error) {
      next(error)
    }
  })

  // 改密碼：舊密碼＋新密碼。改完其他裝置登出，這台回一個新的 token 繼續用。
  // 只有 Google、沒設過密碼的帳號請走忘記密碼（收得到信才能設，借來的電腦設不了）
  router.post('/change-password', requireAuth, changeRateLimit, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const user = await findSelf(req, res)
      if (!user) return
      if (!user.passwordHash) {
        res.status(400).json({ message: '這個帳號還沒有設定密碼，請到登入頁用「忘記密碼」設定一組。' })
        return
      }
      const { password, error: passwordError } = validatePassword(req.body.newPassword)
      if (passwordError) {
        res.status(400).json({ message: passwordError })
        return
      }
      if (!(await confirmPassword(user, req.body.currentPassword, res))) return

      user.passwordHash = await hashPassword(password)
      user.tokenVersion = (Number.isInteger(user.tokenVersion) ? user.tokenVersion : 0) + 1
      await user.save()
      await notifyAccount(user, 'passwordChanged')
      res.json({ token: signToken(user) })
    } catch (error) {
      next(error)
    }
  })

  // 刪除帳號：有密碼的帳號再輸入一次密碼；只有 Google 的帳號重新做一次 Google 登入確認是本人。
  // 管理者不能刪自己（避免把管理者全部刪光）
  router.delete('/me', requireAuth, changeRateLimit, async (req, res, next) => {
    try {
      if (!deleteUserData) {
        res.status(503).json({ message: '刪除帳號功能尚未設定，請聯絡管理者。' })
        return
      }
      if (!ensureDatabase(res)) return
      const user = await findSelf(req, res)
      if (!user) return
      if (user.role === 'admin') {
        res.status(409).json({ message: '管理者帳號不能自己刪除。' })
        return
      }

      if (user.passwordHash) {
        if (!(await confirmPassword(user, req.body.password, res))) return
      } else if (user.googleId) {
        if (!google?.isConfigured()) {
          res.status(503).json({ message: 'Google 登入尚未設定，無法確認身分，請聯絡管理者。' })
          return
        }
        let profile
        try {
          profile = await google.verify(req.body.credential)
        } catch (error) {
          if (error instanceof GoogleTokenError) {
            res.status(400).json({ message: error.message })
            return
          }
          throw error
        }
        if (profile.googleId !== user.googleId) {
          res.status(400).json({ message: '請用這個帳號綁定的 Google 帳號確認。' })
          return
        }
      } else {
        res.status(400).json({ message: '無法確認身分，請聯絡管理者。' })
        return
      }

      await deleteUserData(user._id)
      await Users.deleteOne({ _id: user._id })
      await clearFailures(`email:${user.email}`)
      await clearFailures(`user:${user._id}`)
      await notifyAccount(user, 'deleted')
      res.json({ ok: true })
    } catch (error) {
      next(error)
    }
  })

  // ---- 信箱驗證 ----
  const verifyRateLimit = limiter()

  // 點驗證信的連結：前端驗證頁把 token 送過來。不需要登入（可能在別的裝置打開信）
  router.post('/verify-email', verifyRateLimit, async (req, res, next) => {
    try {
      if (!EmailVerifications) {
        res.status(503).json({ message: '信箱驗證功能尚未設定。' })
        return
      }
      if (!ensureDatabase(res)) return
      const token = req.body.token
      const record =
        typeof token === 'string' && token.length >= 20 && token.length <= 200
          ? await EmailVerifications.findOne({ tokenHash: sha256(token) })
          : null
      const user = record && record.expireAt.getTime() >= now() ? await Users.findById(record.user) : null
      if (!user) {
        res.status(400).json({ message: '這個驗證連結已經失效（超過 24 小時，或有更新的一封信），請登入後到帳號設定頁重寄一封。' })
        return
      }
      if (!user.emailVerified) {
        user.emailVerified = true
        await user.save()
      }
      await EmailVerifications.deleteMany({ user: user._id })
      res.json({ ok: true, email: maskEmail(user.email) })
    } catch (error) {
      next(error)
    }
  })

  // 重寄驗證信（帳號設定頁）：5 分鐘內只能寄一次
  router.post('/resend-verification', requireAuth, verifyRateLimit, async (req, res, next) => {
    try {
      if (!canVerify()) {
        res.status(503).json({ message: '寄信功能尚未設定，暫時無法驗證信箱，請聯絡管理者。' })
        return
      }
      if (!ensureDatabase(res)) return
      const user = await findSelf(req, res)
      if (!user) return
      if (user.emailVerified) {
        res.json({ sent: false, verified: true })
        return
      }
      const recent = await EmailVerifications.findOne({ user: user._id, createdAt: { $gt: new Date(now() - VERIFY_RESEND_MS) } })
      if (recent) {
        res.status(429).json({ message: '剛剛已經寄過驗證信了，請先到信箱（含垃圾郵件匣）找找看；5 分鐘後才能再寄一次。' })
        return
      }
      if (!(await sendVerification(user))) {
        res.status(502).json({ message: '驗證信暫時寄不出去，請稍後再試。' })
        return
      }
      res.json({ sent: true, email: user.email })
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

module.exports = {
  createAuthRouter,
  createRateLimiter,
  LOGIN_FAILED,
  GOOGLE_ONLY,
  ACCOUNT_DISABLED,
  LOCKED,
  LOCK_MAX_FAILURES,
  ADMIN_GOOGLE_ONLY,
  maskEmail,
}
