const mongoose = require('mongoose')

// 瀏覽器推播的訂閱：一台裝置（一個瀏覽器）一筆，同一個會員可以有多台。
// endpoint 是推播服務給的網址，全域唯一；同一台裝置換帳號登入時改掛到新帳號
const MAX_DEVICES_PER_USER = 10

const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    // 讓使用者分辨是哪台裝置（例如「Chrome · Windows」），由前端給、只用來顯示
    label: { type: String, default: '', maxlength: 60 },
  },
  { timestamps: true },
)

pushSubscriptionSchema.index({ user: 1, createdAt: 1 })

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema)
module.exports.MAX_DEVICES_PER_USER = MAX_DEVICES_PER_USER
