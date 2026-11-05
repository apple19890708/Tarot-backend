// 瀏覽器推播（Web Push）：一般會員的主要通知方式。會員在網站按「開啟通知」，瀏覽器給一組訂閱資訊，
// 存在 PushSubscription；到價時由後端用 VAPID 金鑰簽章、加密後送到瀏覽器廠商的推播服務。
//
// 環境變數：VAPID_PUBLIC_KEY、VAPID_PRIVATE_KEY、VAPID_SUBJECT（mailto: 開頭的聯絡信箱）。
// 產生金鑰：npx web-push generate-vapid-keys。沒設定時 available 為 false，推播自動關閉。
const webpush = require('web-push')

// 訂閱的 endpoint 由瀏覽器給、後端會直接 POST 過去，所以只接受各大瀏覽器推播服務的網域（防止被拿去打任意網址）
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome、Edge（舊版）、Android
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/, // Safari、iOS（加入主畫面）
  /^[\w-]+\.notify\.windows\.com$/, // Edge（Windows）
]
const TTL_SECONDS = 60 * 60

function isAllowedEndpoint(raw) {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.port && PUSH_HOSTS.some((pattern) => pattern.test(url.hostname))
  } catch {
    return false
  }
}

// 前端傳來的 PushSubscription（JSON）→ 只留需要的欄位；格式不對回傳 null
function parseSubscription(raw) {
  if (!raw || typeof raw !== 'object') return null
  const { endpoint, keys } = raw
  if (typeof endpoint !== 'string' || endpoint.length > 1000 || !isAllowedEndpoint(endpoint)) return null
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null
  if (!/^[\w-]{20,200}$/.test(keys.p256dh) || !/^[\w-]{10,100}$/.test(keys.auth)) return null
  return { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } }
}

class PushGoneError extends Error {}

// VAPID_SUBJECT 要是 mailto: 或 https: 開頭。只填 email 時自動補 mailto:；其他格式回傳 null
function normalizeSubject(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!value) return null
  if (/^[^@\s:/]+@[^@\s]+\.[^@\s]+$/.test(value)) return `mailto:${value}`
  if (/^mailto:[^@\s]+@[^@\s]+$/.test(value)) return value
  try {
    if (new URL(value).protocol === 'https:') return value
  } catch {
    // 不是網址
  }
  return null
}

function createWebPush({
  publicKey = process.env.VAPID_PUBLIC_KEY,
  privateKey = process.env.VAPID_PRIVATE_KEY,
  subject: rawSubject = process.env.VAPID_SUBJECT,
  sendImpl = (subscription, payload, options) => webpush.sendNotification(subscription, payload, options),
} = {}) {
  const subject = normalizeSubject(rawSubject)
  if (rawSubject && !subject) {
    console.warn('VAPID_SUBJECT 格式不正確（要是 email、mailto: 或 https: 網址），瀏覽器推播已關閉。')
  }
  const available = Boolean(publicKey && privateKey && subject)

  return {
    available,
    publicKey: available ? publicKey : null,

    // payload：{ title, body, url }。訂閱已失效（使用者關掉通知、換瀏覽器）時丟 PushGoneError，呼叫端要刪掉這筆
    async send(subscription, payload) {
      if (!available) throw new Error('瀏覽器推播尚未設定')
      try {
        await sendImpl(subscription, JSON.stringify(payload), {
          TTL: TTL_SECONDS,
          vapidDetails: { subject, publicKey, privateKey },
          urgency: 'high',
        })
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) throw new PushGoneError('訂閱已失效')
        // 推播服務的回應（例如 403 金鑰不符）帶出來，畫面上才看得出原因
        const detail = error?.statusCode ? `推播服務回應 ${error.statusCode}${error.body ? `：${String(error.body).slice(0, 120)}` : ''}` : error?.message
        throw new Error(`推播失敗（${detail || '未知錯誤'}）`)
      }
    },
  }
}

module.exports = { createWebPush, parseSubscription, isAllowedEndpoint, normalizeSubject, PushGoneError }
