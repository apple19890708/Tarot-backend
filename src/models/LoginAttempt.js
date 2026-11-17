const mongoose = require('mongoose')

// 登入失敗計數（v24 1-3）：同一個帳號連續失敗太多次就暫時鎖住。
// key 是「email:信箱」（之後改密碼的舊密碼核對用「user:id」）；expireAt 每次失敗往後延，Mongo 到期自動刪除。
// 存在資料庫而不是記憶體：Cloud Run 重開或多個實例時計數不會歸零
const loginAttemptSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  expireAt: { type: Date, required: true },
})

loginAttemptSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 })

module.exports = mongoose.model('LoginAttempt', loginAttemptSchema)
