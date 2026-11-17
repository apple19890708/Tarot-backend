const mongoose = require('mongoose')

// 註冊後的信箱驗證憑證（v24 3-1），作法同忘記密碼的 PasswordReset：只存 token 的 SHA-256 雜湊、
// 24 小時後 Mongo 自動刪除（TTL 索引）、驗證成功就刪掉
const TTL_HOURS = 24

const emailVerificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expireAt: { type: Date, required: true },
  },
  { timestamps: true },
)

emailVerificationSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model('EmailVerification', emailVerificationSchema)
module.exports.TTL_HOURS = TTL_HOURS
