const mongoose = require('mongoose')

// AI 的用量紀錄（每日次數用）。AI 開始產生（開始計費）時記一筆，
// 中途停止、沒存成分析紀錄的也算，避免「開始後馬上停止」繞過每日上限。
// v29 項目 6：完整產生後寫回 token 數與費用（不記問題內容），觀察提示快取值不值得留；
// 保留天數從 2 天改成 14 天，才看得到一週以上的資料（每日次數只算今天，多留不影響計數）
const KEEP_DAYS = 14

const marketAiUsageSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // stock：個股 AI 深度分析；news：財經新聞 AI 影響分析；tarot：塔羅 AI 解讀；followUp：抽牌追問（v24 1-4）。各自計算每日上限
    kind: { type: String, enum: ['stock', 'news', 'tarot', 'followUp', 'lenormand'], required: true },
    expireAt: { type: Date, required: true },
    // 費用觀測（v29 項目 6）：OpenRouter 回報的 token 數與費用（美元）；中途停止或舊紀錄沒有
    model: { type: String, default: null },
    promptTokens: { type: Number, default: null },
    completionTokens: { type: Number, default: null },
    cachedTokens: { type: Number, default: null },
    reasoningTokens: { type: Number, default: null },
    cost: { type: Number, default: null },
  },
  { timestamps: true },
)

marketAiUsageSchema.index({ user: 1, kind: 1, createdAt: -1 })
marketAiUsageSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model('MarketAiUsage', marketAiUsageSchema)
module.exports.KEEP_DAYS = KEEP_DAYS
