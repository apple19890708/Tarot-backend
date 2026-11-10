const mongoose = require('mongoose')

// 管理操作紀錄：誰在什麼時候對誰做了什麼（開通／收回權限、停用／恢復、強制登出）。
// 一次操作一筆、資料很小，不設保留期限；會員被刪除時紀錄照留（target 查不到就顯示「已刪除的帳號」）
const ACTIONS = ['aiAccess', 'stockAccess', 'disable', 'enable', 'logoutAll']

const adminLogSchema = new mongoose.Schema(
  {
    admin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    target: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, enum: ACTIONS, required: true },
    // 權限類：開通 true、收回 false；其他動作是 null
    value: { type: Boolean, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

adminLogSchema.index({ createdAt: -1 })
adminLogSchema.index({ target: 1, createdAt: -1 })

module.exports = mongoose.model('AdminLog', adminLogSchema)
module.exports.ACTIONS = ACTIONS
