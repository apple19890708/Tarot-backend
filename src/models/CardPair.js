const mongoose = require('mongoose')

// 牌對組合辭典。詳見 doc/v05-tarot-pair-dictionary-plan.md
// key 以 slug 組成（不用 _id），重新 seed 後仍然有效
const cardPairSchema = new mongoose.Schema(
  {
    // 例：cups-03|upright>pentacles-02|reversed
    key: { type: String, required: true },
    fromSlug: { type: String, required: true },
    fromOrientation: { type: String, enum: ['upright', 'reversed'], required: true },
    toSlug: { type: String, required: true },
    toOrientation: { type: String, enum: ['upright', 'reversed'], required: true },
    // 五個真實領域之一；'any' 代表不分領域通用（人工精選多半用這個）
    domain: { type: String, required: true },
    text: { type: String, required: true },
    // 規則引擎當時算出的關係，用來檢查生成內容有沒有與判定衝突
    relation: { type: String, default: '' },
    source: { type: String, enum: ['curated', 'ai'], required: true },
    model: { type: String, default: '' },
    reviewed: { type: Boolean, default: false },
  },
  { timestamps: true },
)

cardPairSchema.index({ key: 1, domain: 1 }, { unique: true })
cardPairSchema.index({ source: 1, reviewed: 1 })

module.exports = mongoose.model('CardPair', cardPairSchema)
