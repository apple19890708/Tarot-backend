// JWT 的簽發與驗證。密鑰只從環境變數來，沒有預設值——有預設值的密鑰等於沒有密鑰。
const jwt = require('jsonwebtoken')

const DEFAULT_TTL = '7d'

function getSecret(override) {
  if (override) {
    return override
  }
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET 未設定。')
  }
  return secret
}

// payload 只放最小集合：使用者 id、角色、憑證版本號（帳號的 tokenVersion 加 1 時這個 token 就失效）
function signToken(user, options = {}) {
  const payload = {
    sub: String(user.id || user._id),
    role: user.role,
    ver: Number.isInteger(user.tokenVersion) ? user.tokenVersion : 0,
  }
  return jwt.sign(payload, getSecret(options.secret), {
    expiresIn: options.expiresIn || DEFAULT_TTL,
  })
}

// 驗證失敗（過期、簽章不符、格式錯誤）一律回 null，呼叫端不必分辨原因
function verifyToken(token, options = {}) {
  if (!token) {
    return null
  }
  try {
    return jwt.verify(token, getSecret(options.secret))
  } catch {
    return null
  }
}

// 每日一牌的領取憑證（v26）：訪客抽完牌拿到這個，登入或註冊後用它把那張牌存進月曆。
// 和登入 token 同一把密鑰，但帶 purpose、不帶 sub：不能拿來登入，登入 token 也不能拿來領牌。
// 內容是伺服器抽的牌，前端改不了，不能自己挑一張好牌來存
const DAILY_CLAIM_PURPOSE = 'daily-claim'

function signDailyClaim({ date, cardId, orientation }, options = {}) {
  return jwt.sign({ purpose: DAILY_CLAIM_PURPOSE, date, cardId: String(cardId), orientation }, getSecret(options.secret), {
    // 後端只收今天的憑證，1 天就夠，外流的憑證不要多活（api-reviewer 2026-11-20）
    expiresIn: options.expiresIn || '1d',
  })
}

// 驗證失敗或用途不對回 null
function verifyDailyClaim(token, options = {}) {
  const payload = verifyToken(token, options)
  if (!payload || payload.purpose !== DAILY_CLAIM_PURPOSE || payload.sub) return null
  // 格式不對的（密鑰輪替、格式改版留下的）當成無效，回 400 而不是存檔時才 500（api-reviewer 2026-11-20）
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.date)) || !/^[a-f\d]{24}$/i.test(String(payload.cardId))) return null
  if (!['upright', 'reversed'].includes(payload.orientation)) return null
  return { date: payload.date, cardId: payload.cardId, orientation: payload.orientation }
}

// 從 Authorization: Bearer <token> 取出 token
function readBearerToken(headerValue) {
  if (typeof headerValue !== 'string') {
    return ''
  }
  const match = headerValue.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

module.exports = { signToken, verifyToken, readBearerToken, DEFAULT_TTL, signDailyClaim, verifyDailyClaim }
