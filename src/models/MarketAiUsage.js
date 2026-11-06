const mongoose = require('mongoose')

// 股市 AI 的用量紀錄（每日次數用）。AI 開始產生（開始計費）時記一筆，
// 中途停止、沒存成分析紀錄的也算，避免「開始後馬上停止」繞過每日上限。只用來計數，保留 2 天
const KEEP_DAYS = 2

const marketAiUsageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // stock：個股 AI 深度分析；news：財經新聞 AI 影響分析（兩者各自計算每日上限）
    kind: { type: String, enum: ['stock', 'news'], required: true },
    expireAt: { type: Date, required: true },
  },
  { timestamps: true },
)

marketAiUsageSchema.index({ user: 1, kind: 1, createdAt: -1 })
marketAiUsageSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model('MarketAiUsage', marketAiUsageSchema)
module.exports.KEEP_DAYS = KEEP_DAYS
