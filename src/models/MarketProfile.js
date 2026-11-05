const mongoose = require('mongoose')

// 股市追蹤的個人設定：推播通知（Discord Webhook）、交易成本設定。一個使用者一筆，沒有就用預設值
const marketProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    // Discord Webhook：網址等於密碼，不回傳給前端（只回遮罩後的提示）
    discord: {
      webhookUrl: { type: String, default: null },
      linkedAt: { type: Date, default: null },
    },
    // 交易成本。台股手續費 0.1425% × 折扣（1 = 不打折，0.28 = 2.8 折），單筆最低 twMinFee 元；
    // 證交稅固定（股票 0.3%、ETF 0.1%），不開放設定。美股每筆固定 usFee 美元
    fees: {
      twDiscount: { type: Number, default: 1, min: 0.1, max: 1 },
      twMinFee: { type: Number, default: 20, min: 0, max: 1000 },
      usFee: { type: Number, default: 0, min: 0, max: 100 },
    },
  },
  { timestamps: true },
)

module.exports = mongoose.model('MarketProfile', marketProfileSchema)
