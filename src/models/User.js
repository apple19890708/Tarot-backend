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
    // bcrypt 雜湊；預設不查出來，避免不小心回傳給前端。
    // 用 Google 註冊的帳號沒有密碼（之後可以用忘記密碼設定一組），所以只有沒綁 Google 時才必填
    passwordHash: {
      type: String,
      required() {
        return !this.googleId
      },
      select: false,
    },
    // Google 帳號的 sub（Google 登入時用來找人）；沒用過 Google 登入的帳號沒有這個欄位
    googleId: { type: String, unique: true, sparse: true },
    displayName: { type: String, default: '' },
    role: { type: String, enum: ROLES, default: 'member' },
    // AI 解析要由管理者逐一開通；admin 本身不看這個欄位，一律放行
    aiAccess: { type: Boolean, default: false },
    // 金融股市（股市諮詢、股市追蹤）也要由管理者逐一開通，和 AI 權限分開；admin 一律放行
    stockAccess: { type: Boolean, default: false },
    // 登入憑證的版本號：重設密碼、登出所有裝置時加 1，之前發出的 token 全部失效（見 middleware/auth.js）
    tokenVersion: { type: Number, default: 0 },
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
    stockAccess: this.role === 'admin' ? true : Boolean(this.stockAccess),
    createdAt: this.createdAt,
  }
}

// 能不能用 AI 解析：admin 一律可以，member 要被開通
userSchema.methods.canUseAi = function canUseAi() {
  return this.role === 'admin' || Boolean(this.aiAccess)
}

// 能不能用金融股市功能：admin 一律可以，member 要被開通
userSchema.methods.canUseStock = function canUseStock() {
  return this.role === 'admin' || Boolean(this.stockAccess)
}

const User = mongoose.model('User', userSchema)

module.exports = User
module.exports.ROLES = ROLES
