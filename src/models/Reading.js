const mongoose = require('mongoose')

// 每位使用者保留的紀錄上限。超過就從最舊的開始刪，避免單一帳號無限成長。
const MAX_READINGS_PER_USER = 100

const ORIENTATIONS = ['upright', 'reversed']

// 占卜紀錄（v13）。
// 只存「重算需要的輸入」：牌 id、正逆位、問題、牌陣（或自訂位置）。
// 分析文字不存，讀取時由後端依規則引擎重算——規則更新後，舊紀錄看到的也是最新的判斷。
// 唯一存下來的文字是 AI 解讀：它要花錢、無法重現，刪了就回不來。
const readingCardSchema = new mongoose.Schema(
  {
    cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', required: true },
    orientation: { type: String, enum: ORIENTATIONS, required: true },
    // 列表要顯示牌名又不想每筆都去查牌庫，存一份當下的名稱快照；詳情頁仍以牌庫為準
    nameZh: { type: String, default: '' },
  },
  { _id: false },
)

const readingSchema = new mongoose.Schema(
  {
    // 索引由下方的 { user: 1, createdAt: -1 } 複合索引涵蓋，欄位上不再另外建一個
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 長度上限與端點一致（QUESTION_MAX_LENGTH），當作寫進資料庫前的第二道防線
    question: { type: String, default: '', maxlength: 500 },
    domain: { type: String, default: null },
    // 牌陣 key；手動選牌沒有牌陣時為 null，位置改由 positions 決定
    spreadKey: { type: String, default: null },
    spreadName: { type: String, default: '' },
    // 不指定牌陣時使用者自己定義的位置含意，重算時要原樣帶回去
    positions: {
      type: [{ label: String, prompt: String, _id: false }],
      default: undefined,
    },
    cards: { type: [readingCardSchema], required: true },
    // AI 解讀的成果；沒用過 AI 時為 null，使用者之後仍可在紀錄頁補做
    narration: {
      type: new mongoose.Schema(
        {
          text: { type: String, required: true },
          model: { type: String, default: '' },
          createdAt: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
)

// 列表固定以使用者 ＋ 時間倒序查詢
readingSchema.index({ user: 1, createdAt: -1 })

// 列表用的摘要，不含會隨規則重算的內容
readingSchema.methods.toSummaryJSON = function toSummaryJSON() {
  return {
    id: String(this._id),
    question: this.question || '',
    domain: this.domain || null,
    spreadKey: this.spreadKey || null,
    spreadName: this.spreadName || '',
    cardCount: this.cards.length,
    cards: this.cards.map((card) => ({
      id: String(card.cardId),
      nameZh: card.nameZh || '',
      orientation: card.orientation,
    })),
    hasNarration: Boolean(this.narration && this.narration.text),
    createdAt: this.createdAt,
  }
}

const Reading = mongoose.model('Reading', readingSchema)

module.exports = Reading
module.exports.MAX_READINGS_PER_USER = MAX_READINGS_PER_USER
