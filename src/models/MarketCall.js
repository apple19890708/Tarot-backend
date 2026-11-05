const mongoose = require('mongoose')

// 股市諮詢的操作建議紀錄（自動對答案用）。
// 每查一次行情就記下當時的建議；同一位使用者、同一個標的、同一個交易日只留最後一次。
// 之後依實際走勢計算 5／10／20 日後的報酬，統計這套規則的命中率。
const marketCallSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    symbol: { type: String, required: true },
    code: { type: String, default: null },
    exchange: { type: String, default: null },
    market: { type: String, enum: ['tw', 'us'], required: true },
    kind: { type: String, enum: ['index', 'stock'], required: true },
    name: { type: String, default: '' },
    // 報價所屬的交易日（YYYY-MM-DD）
    date: { type: String, required: true },
    price: { type: Number, required: true },
    stance: { type: String, enum: ['bullish', 'bearish', 'neutral'], required: true },
    confidence: { type: String, enum: ['high', 'medium', 'low'], required: true },
    stopLoss: { type: Number, default: null },
    targets: { type: [Number], default: [] },
  },
  { timestamps: true },
)

marketCallSchema.index({ user: 1, symbol: 1, date: 1 }, { unique: true })
marketCallSchema.index({ user: 1, date: -1 })

module.exports = mongoose.model('MarketCall', marketCallSchema)
