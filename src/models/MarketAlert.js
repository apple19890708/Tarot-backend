const mongoose = require('mongoose')

// 價位提醒：價格漲到（above）或跌到（below）指定價位時提醒。
// 伺服器不常駐排程（Render 免費方案會休眠），由前端開著時定期請後端檢查。
const MAX_ALERTS_PER_USER = 50

const marketAlertSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 查報價需要的標的資訊（和市場快照的欄位一致）
    target: {
      symbol: { type: String, default: null },
      code: { type: String, default: null },
      exchange: { type: String, default: null },
      market: { type: String, enum: ['tw', 'us'], required: true },
      kind: { type: String, enum: ['index', 'stock'], required: true },
      name: { type: String, default: '' },
    },
    condition: { type: String, enum: ['above', 'below'], required: true },
    price: { type: Number, required: true },
    note: { type: String, default: '', maxlength: 100 },
    active: { type: Boolean, default: true },
    triggeredAt: { type: Date, default: null },
    triggeredPrice: { type: Number, default: null },
  },
  { timestamps: true },
)

marketAlertSchema.index({ user: 1, createdAt: -1 })

module.exports = mongoose.model('MarketAlert', marketAlertSchema)
module.exports.MAX_ALERTS_PER_USER = MAX_ALERTS_PER_USER
