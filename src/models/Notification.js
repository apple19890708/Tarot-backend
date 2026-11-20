const mongoose = require('mongoose')

// 通知中心（v26 計畫 5）：推播與網頁上跳出的提示送出去就沒了，這裡留一份，錯過也找得回來。
// 推播失敗或沒開推播也照樣存。保留（D11）：每人最多 200 則（超過刪最舊，services/notificationCenter.js），90 天自動刪（TTL）
const KINDS = ['price-alert', 'ex-dividend', 'test', 'system']
const MAX_PER_USER = 200
const KEEP_DAYS = 90

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: KINDS, required: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, default: '', maxlength: 500 },
    // 站內路徑，不含開頭的 /（例如 market?tab=alerts），和推播的 url 同一種寫法
    url: { type: String, default: '', maxlength: 200 },
    // 同一件事只存一則（例如 alert:<提醒 id>:<觸發時間>）：網頁與排程同時觸發、推播失敗重試都不會重複
    key: { type: String, default: null, maxlength: 200 },
    readAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

// 列表（新到舊）與未讀數
notificationSchema.index({ user: 1, _id: -1 })
notificationSchema.index({ user: 1, readAt: 1 })
// 只有帶 key 的才唯一
notificationSchema.index({ user: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $type: 'string' } } })
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: KEEP_DAYS * 24 * 60 * 60 })

notificationSchema.statics.KINDS = KINDS
notificationSchema.statics.MAX_PER_USER = MAX_PER_USER
notificationSchema.statics.KEEP_DAYS = KEEP_DAYS

module.exports = mongoose.model('Notification', notificationSchema)
