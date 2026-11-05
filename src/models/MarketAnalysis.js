const mongoose = require('mongoose')

// 每位使用者保留的筆數上限（和塔羅紀錄一樣）。超過就從最舊的開始刪
const MAX_ANALYSES_PER_USER = 100

// 個股 AI 深度分析的紀錄（v17 規格 F）。每跑完一次存一筆，顯示在「我的紀錄」的「股票分析」。
// AI 文字要花錢、無法重現，所以連同當時交給 AI 的資料（snapshot）與持股一起存，回顧時看得出根據。
// 刪除追蹤項目時不刪：要不要刪由使用者在紀錄頁決定
const marketAnalysisSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 產生時的追蹤項目；之後被移除也保留這個 id（只用來找「這檔最新一筆」）
    watch: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketWatch', default: null },
    target: {
      symbol: { type: String, default: null },
      code: { type: String, default: null },
      exchange: { type: String, default: null },
      market: { type: String, enum: ['tw', 'us'], required: true },
      kind: { type: String, enum: ['index', 'stock'], required: true },
      name: { type: String, default: '' },
    },
    // 列表要顯示當時的股價，不必讀整份 snapshot
    quote: {
      price: { type: Number, default: null },
      change: { type: Number, default: null },
      changePct: { type: Number, default: null },
      date: { type: String, default: null },
    },
    text: { type: String, required: true, maxlength: 20000 },
    model: { type: String, default: '' },
    // 當時的單檔快照（buildTargetSnapshot 的結果）
    snapshot: { type: mongoose.Schema.Types.Mixed, default: null },
    // 當時的持股摘要；沒有持股時為 null
    holding: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
)

marketAnalysisSchema.index({ user: 1, createdAt: -1 })
marketAnalysisSchema.index({ user: 1, watch: 1, createdAt: -1 })

marketAnalysisSchema.methods.toSummaryJSON = function toSummaryJSON() {
  return {
    id: String(this._id),
    watch: this.watch ? String(this.watch) : null,
    target: {
      symbol: this.target.symbol,
      code: this.target.code,
      exchange: this.target.exchange,
      market: this.target.market,
      kind: this.target.kind,
      name: this.target.name,
    },
    quote: {
      price: this.quote?.price ?? null,
      change: this.quote?.change ?? null,
      changePct: this.quote?.changePct ?? null,
      date: this.quote?.date ?? null,
    },
    model: this.model || '',
    createdAt: this.createdAt,
  }
}

marketAnalysisSchema.methods.toDetailJSON = function toDetailJSON() {
  return { ...this.toSummaryJSON(), text: this.text, snapshot: this.snapshot || null, holding: this.holding || null }
}

module.exports = mongoose.model('MarketAnalysis', marketAnalysisSchema)
module.exports.MAX_ANALYSES_PER_USER = MAX_ANALYSES_PER_USER
