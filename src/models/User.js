const mongoose = require('mongoose')

const ROLES = ['member', 'admin']

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    // bcrypt 雜湊；預設不查出來，避免不小心回傳給前端
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, default: '' },
    role: { type: String, enum: ROLES, default: 'member' },
    // AI 解析要由管理者逐一開通；admin 本身不看這個欄位，一律放行
    aiAccess: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  },
)

// 回給前端的形狀，永遠不含 passwordHash
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: String(this._id),
    email: this.email,
    displayName: this.displayName || this.email.split('@')[0],
    role: this.role,
    aiAccess: this.role === 'admin' ? true : Boolean(this.aiAccess),
    createdAt: this.createdAt,
  }
}

// 能不能用 AI 解析：admin 一律可以，member 要被開通
userSchema.methods.canUseAi = function canUseAi() {
  return this.role === 'admin' || Boolean(this.aiAccess)
}

const User = mongoose.model('User', userSchema)

module.exports = User
module.exports.ROLES = ROLES
