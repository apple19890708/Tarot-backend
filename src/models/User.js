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
    // 最後一次登入（密碼、Google、註冊）的時間與方式；舊帳號沒有
    lastLoginAt: { type: Date, default: null },
    lastLoginMethod: { type: String, enum: ['password', 'google', 'register', null], default: null },
    // 最後一次帶 token 呼叫 API 的時間（middleware/auth.js 更新，同一小時內只寫一次）。
    // 只看登入時間看不出活不活躍：token 有效 7 天，這段期間一直在用也不會再登入
    lastActiveAt: { type: Date, default: null },
    // 管理者停用的帳號：不能登入，已發出的 token 也失效（停用時 tokenVersion 加 1，middleware 也會擋）
    disabled: { type: Boolean, default: false },
    disabledAt: { type: Date, default: null },
  },
  {
    timestamps: true,
  },
)

// 管理頁依最後活動排序、篩「30 天沒來」
userSchema.index({ lastActiveAt: -1 })

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

// 管理頁用的形狀：多了登入、活動、停用狀態與登入方式。
// 有沒有設密碼要查詢時帶 .select('+passwordHash') 才知道，這裡只回布林，雜湊本身永遠不出去
userSchema.methods.toAdminJSON = function toAdminJSON() {
  return {
    ...this.toPublicJSON(),
    lastLoginAt: this.lastLoginAt ?? null,
    lastLoginMethod: this.lastLoginMethod ?? null,
    lastActiveAt: this.lastActiveAt ?? null,
    disabled: Boolean(this.disabled),
    disabledAt: this.disabledAt ?? null,
    loginMethods: { password: Boolean(this.passwordHash), google: Boolean(this.googleId) },
  }
}

// 能不能用 AI 解析：admin 一律可以，member 要被開通
// 停用的帳號一律不行：背景排程（到價推播、資產快照）不經過 middleware，只靠這兩個方法判斷
userSchema.methods.canUseAi = function canUseAi() {
  if (this.disabled) return false
  return this.role === 'admin' || Boolean(this.aiAccess)
}

// 能不能用金融股市功能：admin 一律可以，member 要被開通
userSchema.methods.canUseStock = function canUseStock() {
  if (this.disabled) return false
  return this.role === 'admin' || Boolean(this.stockAccess)
}

const User = mongoose.model('User', userSchema)

module.exports = User
module.exports.ROLES = ROLES
