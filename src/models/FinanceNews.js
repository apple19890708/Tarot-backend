const mongoose = require('mongoose')

// 財經新聞（v17 規格 G）：國內外免費來源的標題、摘要與連結，全站共用。
// 只存來源公開給的摘要，不存全文；保留 7 天（TTL 索引自動刪除），同一則用 key（來源｜原始 id）去重
const KEEP_DAYS = 7

const financeNewsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    source: { type: String, required: true },
    sourceLabel: { type: String, default: '' },
    region: { type: String, enum: ['tw', 'intl'], required: true },
    lang: { type: String, enum: ['zh', 'en'], required: true },
    title: { type: String, required: true },
    summary: { type: String, default: '' },
    url: { type: String, required: true },
    publishedAt: { type: Date, required: true },
    // 主題標籤（data/newsThemes.js 的 key）
    themes: { type: [String], default: [] },
    // 標題裡提到的台股代號
    codes: { type: [String], default: [] },
    // 新聞重點彈窗的結果（newsDigest.buildDigest）：第一次有人打開時產生，全站共用；沒產生過為 null
    digest: { type: mongoose.Schema.Types.Mixed, default: null },
    expireAt: { type: Date, required: true },
  },
  { timestamps: true },
)

financeNewsSchema.index({ publishedAt: -1 })
financeNewsSchema.index({ region: 1, publishedAt: -1 })
financeNewsSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model('FinanceNews', financeNewsSchema)
module.exports.KEEP_DAYS = KEEP_DAYS
