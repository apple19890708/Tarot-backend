const mongoose = require('mongoose')

// 自選清單（例如「長期存股」「短線觀察」）。一檔股票只屬於一個清單（MarketWatch.group），
// 沒有清單的是「未分類」。持股總覽與資產走勢不分清單
const MAX_GROUPS_PER_USER = 10

const marketWatchGroupSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, maxlength: 20 },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
)

marketWatchGroupSchema.index({ user: 1, order: 1 })
// 同一個使用者的清單不能同名（同時送出兩次時由這裡擋下）
marketWatchGroupSchema.index({ user: 1, name: 1 }, { unique: true })

module.exports = mongoose.model('MarketWatchGroup', marketWatchGroupSchema)
module.exports.MAX_GROUPS_PER_USER = MAX_GROUPS_PER_USER
