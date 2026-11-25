// 雷諾曼占卜紀錄（v27 階段 6，詳見 doc/v27-lenormand-plan.md 3-7、3-13、決定事項 D7）。
// 不擴充塔羅的 Reading：Reading.cards 是指向 Card 的 ObjectId、orientation 必填，AI 品質檢查也是塔羅專用。
// 和塔羅一樣只存「重算需要的輸入」（問題、牌陣、代表牌、牌號），分析讀取時重算——規則更新後舊紀錄也看到最新判斷。
// 唯一存下來的文字是 AI 解讀（階段 7）：它要花錢、無法重現。
const mongoose = require('mongoose')

const { spreads } = require('../data/lenormand/spreads')
const { LENORMAND_DOMAINS } = require('../data/lenormand/ruleConfig')

// 每位使用者保留的紀錄上限，和塔羅相同；超過就從最舊的刪（services/readingHistory.js 的 trimHistory）
const MAX_LENORMAND_READINGS_PER_USER = 100
const MODES = ['draw', 'manual']

const lenormandReadingSchema = new mongoose.Schema(
  {
    // 索引由下方的 { user: 1, createdAt: -1 } 複合索引涵蓋
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    question: { type: String, default: '', maxlength: 500 },
    domain: { type: String, enum: [...Object.keys(LENORMAND_DOMAINS), null], default: null },
    spreadKey: { type: String, enum: spreads.map((spread) => spread.key), required: true },
    spreadName: { type: String, default: '' },
    // 求問者選的代表牌（紳士 28／淑女 29），小牌陣可以沒有
    significator: { type: Number, enum: [28, 29, null], default: null },
    mode: { type: String, enum: MODES, default: 'manual' },
    // 牌號，依位置順序（由左到右、由上到下）；端點已驗證過，這裡是寫進資料庫前的第二道防線
    cards: {
      type: [{ type: Number, min: 1, max: 52 }],
      required: true,
      validate: { validator: (ids) => ids.length >= 1 && ids.length <= 36 && new Set(ids).size === ids.length, message: '牌號不正確。' },
    },
    // AI 解讀（階段 7）；沒用過 AI 是 null
    narration: {
      type: new mongoose.Schema(
        {
          text: { type: String, required: true },
          model: { type: String, default: '' },
          createdAt: { type: Date, default: Date.now },
          // 寫完的程式檢查（services/lenormand/narrationCheck.js），存檔時算
          checks: { type: [String], default: [] },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
)

// 列表固定以使用者 ＋ 時間倒序查詢
lenormandReadingSchema.index({ user: 1, createdAt: -1 })

// 列表的摘要：牌名從靜態牌庫查（不存快照，牌名不會變），只列前 5 張
const PREVIEW_CARDS = 5
lenormandReadingSchema.methods.toSummaryJSON = function toSummaryJSON(cardById) {
  return {
    id: String(this._id),
    question: this.question || '',
    domain: this.domain || null,
    spreadKey: this.spreadKey,
    spreadName: this.spreadName || '',
    significator: this.significator ?? null,
    cardCount: this.cards.length,
    cards: this.cards.slice(0, PREVIEW_CARDS).map((id) => ({ id, nameZh: cardById.get(id)?.nameZh || '' })),
    hasNarration: Boolean(this.narration && this.narration.text),
    createdAt: this.createdAt,
  }
}

const LenormandReading = mongoose.model('LenormandReading', lenormandReadingSchema)

module.exports = LenormandReading
module.exports.MAX_LENORMAND_READINGS_PER_USER = MAX_LENORMAND_READINGS_PER_USER
module.exports.PREVIEW_CARDS = PREVIEW_CARDS
module.exports.MODES = MODES
