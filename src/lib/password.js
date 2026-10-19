// 密碼雜湊。bcrypt 只吃前 72 bytes，所以長度上限訂在 72。
const bcrypt = require('bcrypt')

const SALT_ROUNDS = 10
const PASSWORD_MIN = 8
const PASSWORD_MAX = 72
const EMAIL_MAX = 254

function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS)
}

function comparePassword(plain, hash) {
  if (!hash) {
    return Promise.resolve(false)
  }
  return bcrypt.compare(plain, hash)
}

function normalizeEmail(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : ''
}

// 不做過度嚴格的 email 正規表示式，只擋明顯不是 email 的輸入
function validateEmail(raw) {
  const email = normalizeEmail(raw)
  if (!email) {
    return { error: '請輸入 email。' }
  }
  if (email.length > EMAIL_MAX) {
    return { error: `email 不可超過 ${EMAIL_MAX} 字。` }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: 'email 格式不正確。' }
  }
  return { email }
}

function validatePassword(raw) {
  if (typeof raw !== 'string' || !raw) {
    return { error: '請輸入密碼。' }
  }
  if (raw.length < PASSWORD_MIN) {
    return { error: `密碼至少 ${PASSWORD_MIN} 個字元。` }
  }
  if (Buffer.byteLength(raw, 'utf8') > PASSWORD_MAX) {
    return { error: `密碼不可超過 ${PASSWORD_MAX} 個位元組。` }
  }
  return { password: raw }
}

module.exports = {
  hashPassword,
  comparePassword,
  normalizeEmail,
  validateEmail,
  validatePassword,
  SALT_ROUNDS,
  PASSWORD_MIN,
  PASSWORD_MAX,
}
