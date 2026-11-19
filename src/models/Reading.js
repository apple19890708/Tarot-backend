const mongoose = require('mongoose')
const { checkNarration, PROMPT_VERSION } = require('../services/narrationCheck')
const { analyzeQuestionType } = require('../services/rules/questionType')
const { isTimingQuestion } = require('../services/rules/timingRules')

// v25 階段 4：使用者對 AI 解讀的回饋（有幫助／沒幫助＋原因）
const FEEDBACK_VALUES = ['up', 'down']
const FEEDBACK_REASONS = ['off-topic', 'vague', 'timing', 'too-long', 'other']
const feedbackSchema = new mongoose.Schema(
  {
    value: { type: String, enum: FEEDBACK_VALUES, required: true },
    reason: { type: String, enum: [...FEEDBACK_REASONS, null], default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
)

// v25 階段 2：寫完的程式檢查結果與當時的提示詞版本（存檔前自動算，見下方 pre('validate')）
const qualityFields = {
  checks: { type: [String], default: undefined },
  promptVersion: { type: Number, default: null },
  feedback: { type: feedbackSchema, default: null },
}

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
          // 解讀當下查到的市場資料（股市問題才有）。之後回頭看可以對照當時的數字與後來的走勢
          market: { type: mongoose.Schema.Types.Mixed, default: null },
          createdAt: { type: Date, default: Date.now },
          ...qualityFields,
        },
        { _id: false },
      ),
      default: null,
    },
    // 抽牌追問（v23）：針對同一件事再問、再抽的補充牌，最多三次、每次 1～3 張。
    // 只存問題與牌，牌義讀取時重算；舊紀錄沒有這個欄位
    followUps: {
      type: [
        new mongoose.Schema(
          {
            question: { type: String, required: true, maxlength: 200 },
            cards: { type: [readingCardSchema], required: true },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: undefined,
    },
    // 追問的 AI 延伸回答：一篇涵蓋目前所有追問，重新產生就覆蓋
    followUpNarration: {
      type: new mongoose.Schema(
        {
          text: { type: String, required: true },
          model: { type: String, default: '' },
          // 寫的時候涵蓋了幾次追問；之後又追問的話，畫面要提示這篇還沒包含新的
          rounds: { type: Number, default: 0 },
          createdAt: { type: Date, default: Date.now },
          ...qualityFields,
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
)

// 解讀文字是新的（新紀錄、重新產生、補存）時才重算檢查與記下提示詞版本；
// 只改回饋時文字沒變，不能把舊解讀標成新版本
readingSchema.pre('validate', function assessNarrations() {
  if (this.narration?.text && (this.isNew || this.isModified('narration.text'))) {
    this.narration.checks = checkNarration(this.narration.text, {
      kinds: analyzeQuestionType({ question: this.question }).kinds,
      cardCount: this.cards.length,
      // 行情資料太大或格式不對時不會存，但文字仍是股市版的結構，所以也看類別（api-reviewer L2）
      market: Boolean(this.narration.market) || this.domain === 'stock',
    })
    this.narration.promptVersion = PROMPT_VERSION
  }
  if (this.followUpNarration?.text && (this.isNew || this.isModified('followUpNarration.text'))) {
    // 只看這篇回答涵蓋的那幾次追問：寫的途中又追問時，紀錄裡的追問會比回答多（api-reviewer L1）
    const all = Array.isArray(this.followUps) ? this.followUps : []
    const rounds = this.followUpNarration.rounds || all.length
    const covered = all.slice(0, rounds)
    this.followUpNarration.checks = checkNarration(this.followUpNarration.text, {
      kinds: covered.some((item) => isTimingQuestion(item.question)) ? ['timing'] : [],
      followUp: true,
      rounds,
    })
    this.followUpNarration.promptVersion = PROMPT_VERSION
  }
})

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
    followUpCount: Array.isArray(this.followUps) ? this.followUps.length : 0,
    createdAt: this.createdAt,
  }
}

const Reading = mongoose.model('Reading', readingSchema)

module.exports = Reading
module.exports.MAX_READINGS_PER_USER = MAX_READINGS_PER_USER
module.exports.FEEDBACK_VALUES = FEEDBACK_VALUES
module.exports.FEEDBACK_REASONS = FEEDBACK_REASONS
