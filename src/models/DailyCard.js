// 每日一牌（v26 計畫 1）：每位會員每天（台北時間）一張，抽出後當天固定（D1：不能重抽）。
// user＋date 唯一：同時送兩次抽牌也只會存一張（第二次撞到唯一索引，路由改回傳已存的那張）
const mongoose = require('mongoose')

const ORIENTATIONS = ['upright', 'reversed']

const dailyCardSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 台北時間的日期 YYYY-MM-DD（不用 Date：跨時區比對「同一天」容易錯）
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    cardId: { type: mongoose.Schema.Types.ObjectId, ref: 'Card', required: true },
    orientation: { type: String, enum: ORIENTATIONS, required: true },
    // 牌名與圖片的快照（同 Reading）：重新匯入牌庫時 cardId 會整批換新，對不到牌時月曆與今天的牌仍看得到（api-reviewer 2026-11-20）
    nameZh: { type: String, default: '' },
    nameEn: { type: String, default: '' },
    image: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

dailyCardSchema.index({ user: 1, date: 1 }, { unique: true })

module.exports = mongoose.model('DailyCard', dailyCardSchema)
module.exports.ORIENTATIONS = ORIENTATIONS
