const mongoose = require('mongoose')

// 每位使用者保留的筆數上限，超過就從最舊的開始刪
const MAX_ANALYSES_PER_USER = 30

// 財經新聞的 AI 影響分析紀錄（v17 規格 G）。使用者手動按才產生（會計費），完整產生才存；
// 連同當時交給 AI 的新聞清單一起存，回顧時看得出 AI 根據哪些新聞。只有本人看得到
const financeNewsAnalysisSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 分析範圍：區域（all／tw／intl）與主題（null 代表不限）
    region: { type: String, enum: ['all', 'tw', 'intl'], default: 'all' },
    theme: { type: String, default: null },
    text: { type: String, required: true, maxlength: 20000 },
    model: { type: String, default: '' },
    news: [
      {
        _id: false,
        title: { type: String, default: '' },
        sourceLabel: { type: String, default: '' },
        region: { type: String, default: '' },
        url: { type: String, default: '' },
        publishedAt: { type: Date, default: null },
      },
    ],
  },
  { timestamps: true },
)

financeNewsAnalysisSchema.index({ user: 1, createdAt: -1 })

financeNewsAnalysisSchema.methods.toSummaryJSON = function toSummaryJSON() {
  return {
    id: String(this._id),
    region: this.region,
    theme: this.theme || null,
    newsCount: (this.news || []).length,
    model: this.model || '',
    createdAt: this.createdAt,
  }
}

financeNewsAnalysisSchema.methods.toDetailJSON = function toDetailJSON() {
  return {
    ...this.toSummaryJSON(),
    text: this.text,
    news: (this.news || []).map((n) => ({
      title: n.title,
      sourceLabel: n.sourceLabel,
      region: n.region,
      url: n.url,
      publishedAt: n.publishedAt ? new Date(n.publishedAt).toISOString() : null,
    })),
  }
}

module.exports = mongoose.model('FinanceNewsAnalysis', financeNewsAnalysisSchema)
module.exports.MAX_ANALYSES_PER_USER = MAX_ANALYSES_PER_USER
