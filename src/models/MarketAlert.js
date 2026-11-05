const mongoose = require('mongoose')

// 價位提醒：價格、單日漲跌幅、均線、KD、RSI、量能等條件（判斷在 services/market/alertChecker.js）。
// 伺服器不常駐排程（Render 免費方案會休眠），由前端開著時定期請後端檢查。
const MAX_ALERTS_PER_USER = 50

const marketAlertSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 查報價需要的標的資訊（和市場快照的欄位一致）
    target: {
      symbol: { type: String, default: null },
      code: { type: String, default: null },
      exchange: { type: String, default: null },
      market: { type: String, enum: ['tw', 'us'], required: true },
      kind: { type: String, enum: ['index', 'stock'], required: true },
      name: { type: String, default: '' },
    },
    // 提醒種類：price（價格）、changePct（單日漲跌幅）、ma（均線）、kd、rsi、volume（量比）。舊資料沒有這欄，當成 price
    kind: { type: String, enum: ['price', 'changePct', 'ma', 'kd', 'rsi', 'volume'], default: 'price' },
    // price 種類用：漲到（above）／跌到（below）某價
    condition: { type: String, enum: ['above', 'below', null], default: null },
    price: { type: Number, default: null },
    // 其他種類的參數：direction（up／down、above／below、golden／dead）、value（門檻）、period（均線 20／60）
    params: {
      direction: { type: String, default: null },
      value: { type: Number, default: null },
      period: { type: Number, default: null },
    },
    // 均線提醒：上一次檢查時價格在均線哪一側（above／below），穿越才觸發
    lastSide: { type: String, default: null },
    // 漲跌幅、KD、RSI、量比上一次觸發的行情日期：同一個交易日不重複觸發（重新啟用也不清掉）
    lastTriggeredOn: { type: String, default: null },
    // 觸發時的補充說明（例如「MA60 1,050」「今日 +5.2%」）
    triggeredNote: { type: String, default: '' },
    note: { type: String, default: '', maxlength: 100 },
    active: { type: Boolean, default: true },
    triggeredAt: { type: Date, default: null },
    triggeredPrice: { type: Number, default: null },
    // 推播（Discord）送出的時間；網頁與排程都可能觸發，有值就不再重送
    notifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

marketAlertSchema.index({ user: 1, createdAt: -1 })

module.exports = mongoose.model('MarketAlert', marketAlertSchema)
module.exports.MAX_ALERTS_PER_USER = MAX_ALERTS_PER_USER
