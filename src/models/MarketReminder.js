const mongoose = require('mongoose')

// 已送出的提醒（v20 階段 6，除息前推播）：同一位會員、同一個 key（exDividend:代號:除息日）只送一次。
// 唯一索引讓重疊執行的排程只有一個送得出去；60 天後自動刪除（除息日早就過了）
const marketReminderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

marketReminderSchema.index({ user: 1, key: 1 }, { unique: true })
marketReminderSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 24 * 60 * 60 })

module.exports = mongoose.model('MarketReminder', marketReminderSchema)
