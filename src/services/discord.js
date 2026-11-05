// Discord Webhook：價位提醒的推播通知（免費，不需要 bot）。
// 使用者在自己的 Discord 頻道建立 Webhook，把網址貼到網站；後端直接 POST 訊息過去。
//
// Webhook 網址等於密碼：只存在資料庫，不回傳給前端，也不印進 log。
// 只接受 Discord 官方網域的 webhook 網址，避免後端被拿去打任意網址（SSRF）。
const REQUEST_TIMEOUT_MS = 10000
const WEBHOOK_PATTERN = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/(\d{15,25})\/([\w-]{30,100})$/

function parseWebhookUrl(raw) {
  if (typeof raw !== 'string') return null
  const url = raw.trim()
  const match = WEBHOOK_PATTERN.exec(url)
  return match ? { url, id: match[1] } : null
}

// 畫面上顯示用：只留 webhook id 的頭尾
function maskWebhook(url) {
  const parsed = parseWebhookUrl(url)
  if (!parsed) return null
  const { id } = parsed
  return `discord.com/api/webhooks/${id.slice(0, 4)}…${id.slice(-4)}/••••`
}

class DiscordWebhookError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

function createDiscord({ fetchImpl = (...args) => fetch(...args) } = {}) {
  async function send(webhookUrl, content) {
    if (!parseWebhookUrl(webhookUrl)) throw new DiscordWebhookError('Webhook 網址格式不正確。', 400)
    const response = await fetchImpl(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 不讓訊息裡的文字觸發 @everyone 之類的提及
      body: JSON.stringify({ content, username: '塔羅股市提醒', allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status === 401 || response.status === 404) {
      throw new DiscordWebhookError('這個 Webhook 已經被刪除或網址不正確。', response.status)
    }
    if (!response.ok) {
      throw new DiscordWebhookError(`Discord 回應錯誤（${response.status}）。`, response.status)
    }
  }

  return { send }
}

module.exports = { createDiscord, parseWebhookUrl, maskWebhook, DiscordWebhookError }
