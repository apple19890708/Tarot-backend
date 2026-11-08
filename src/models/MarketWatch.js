const mongoose = require('mongoose')

// 自訂股票追蹤：使用者自己加的觀察清單，可以另外記下持股（可分多筆買進）。
// 台股的數量單位是「張」（1 張 = 1000 股，可以有小數代表零股），美股是「股」
const MAX_WATCHES_PER_USER = 30
const MAX_TRADES_PER_WATCH = 100
const MAX_DIVIDENDS_PER_WATCH = 100

const marketWatchSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 同一個使用者同一個標的只能加一次（symbol，沒有 symbol 時是 exchange_code）
    key: { type: String, required: true },
    target: {
      symbol: { type: String, default: null },
      code: { type: String, default: null },
      exchange: { type: String, default: null },
      market: { type: String, enum: ['tw', 'us'], required: true },
      kind: { type: String, enum: ['index', 'stock'], required: true },
      name: { type: String, default: '' },
    },
    // 持股的買賣紀錄（依陣列順序先進先出沖銷），空陣列代表沒有持股。損益由 services/market/portfolio.js 計算。
    // date 是成交日期（選填，YYYY-MM-DD）
    trades: {
      type: [
        new mongoose.Schema(
          {
            side: { type: String, enum: ['buy', 'sell'], required: true },
            quantity: { type: Number, required: true },
            price: { type: Number, required: true },
            date: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    // 現金股利入帳（金額是實際收到的總額，台股台幣、美股美元）
    dividends: {
      type: [
        new mongoose.Schema(
          {
            amount: { type: Number, required: true },
            date: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    // 自選清單（MarketWatchGroup）：一檔可以同時放在好幾個清單（2026-11-08 起），空陣列＝「未分類」
    groups: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MarketWatchGroup' }], default: [] },
    // 舊格式：一檔只屬於一個清單。讀取時當成 groups 的唯一一個（routes/market.js 的 watchGroupIds）；
    // 寫入 groups 時一律清成 null，不再使用
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'MarketWatchGroup', default: null },
    // 自訂順序（越小越前面）；同順序時依加入時間
    order: { type: Number, default: 0 },
    // 舊格式（v16 階段 0）：只有買進。讀取時轉成買進紀錄，下次儲存持股時清空
    lots: {
      type: [
        new mongoose.Schema(
          {
            quantity: { type: Number, required: true },
            cost: { type: Number, required: true },
            date: { type: String, default: null },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { timestamps: true },
)

marketWatchSchema.index({ user: 1, key: 1 }, { unique: true })

module.exports = mongoose.model('MarketWatch', marketWatchSchema)
module.exports.MAX_WATCHES_PER_USER = MAX_WATCHES_PER_USER
module.exports.MAX_TRADES_PER_WATCH = MAX_TRADES_PER_WATCH
module.exports.MAX_DIVIDENDS_PER_WATCH = MAX_DIVIDENDS_PER_WATCH
