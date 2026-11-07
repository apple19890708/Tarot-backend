const mongoose = require('mongoose')

// 忘記密碼的重設憑證（v17 規格 I）。只存 token 的 SHA-256 雜湊：資料庫外洩也拿不到能用的連結。
// 30 分鐘後 Mongo 自動刪除（TTL 索引）；用過的標 usedAt，不能再用第二次
const TTL_MINUTES = 30

const passwordResetSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expireAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

passwordResetSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model('PasswordReset', passwordResetSchema)
module.exports.TTL_MINUTES = TTL_MINUTES
