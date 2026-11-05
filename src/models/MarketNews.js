const mongoose = require('mongoose')

// 公開資訊觀測站的每日重大訊息（上市、上櫃）。來源只給當天的，所以抓到就存，保留 30 天（TTL 索引自動刪除）。
// 全站共用，不分使用者；同一則用 key（代號｜發言日期｜時間｜主旨前段）去重
const KEEP_DAYS = 30

const marketNewsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    code: { type: String, required: true },
    exchange: { type: String, enum: ['tse', 'otc'], required: true },
    name: { type: String, default: '' },
    // 發言日期 YYYY-MM-DD 與時間 HH:MM:SS（台北時間）
    date: { type: String, required: true },
    time: { type: String, default: '' },
    title: { type: String, default: '' },
    // 說明全文（公司原文，畫面只當純文字顯示）
    detail: { type: String, default: '' },
    clause: { type: String, default: '' },
    // 到這個時間 Mongo 會自動刪除
    expireAt: { type: Date, required: true },
  },
  { timestamps: true },
)

marketNewsSchema.index({ code: 1, date: -1, time: -1 })
marketNewsSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model('MarketNews', marketNewsSchema)
module.exports.KEEP_DAYS = KEEP_DAYS
