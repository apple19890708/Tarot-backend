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

// payload 只放最小集合：使用者 id 與角色
function signToken(user, options = {}) {
  const payload = {
    sub: String(user.id || user._id),
    role: user.role,
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

// 從 Authorization: Bearer <token> 取出 token
function readBearerToken(headerValue) {
  if (typeof headerValue !== 'string') {
    return ''
  }
  const match = headerValue.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

module.exports = { signToken, verifyToken, readBearerToken, DEFAULT_TTL }
