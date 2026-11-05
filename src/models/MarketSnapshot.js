const mongoose = require('mongoose')

// 每日資產快照：台股收盤後記一筆（同一天重記就覆蓋），畫資產走勢與和大盤比較用。保留 3 年。
// 各市場用原幣記；合併的台幣總額用當天匯率換算後存下來，之後不回頭重算
const sideSchema = new mongoose.Schema(
  {
    value: { type: Number, default: 0 },
    cost: { type: Number, default: 0 },
    realized: { type: Number, default: 0 },
    dividends: { type: Number, default: 0 },
  },
  { _id: false },
)

const marketSnapshotSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 台北時間的日期 YYYY-MM-DD
    date: { type: String, required: true },
    tw: { type: sideSchema, default: () => ({}) },
    us: { type: sideSchema, default: () => ({}) },
    // 1 美元 = 多少台幣；取不到時沿用前一筆（都沒有就是 null，美股不併入台幣總額）
    usdTwd: { type: Number, default: null },
    total: { type: sideSchema, default: () => ({}) },
  },
  { timestamps: true },
)

marketSnapshotSchema.index({ user: 1, date: 1 }, { unique: true })

module.exports = mongoose.model('MarketSnapshot', marketSnapshotSchema)
module.exports.KEEP_DAYS = 3 * 365
