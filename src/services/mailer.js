// 寄信（v17 規格 I）：用 Gmail API 寄，不走 SMTP（Render 免費方案擋 SMTP 連接埠）。
// 用 OAuth 的 refresh token 換 access token（約 1 小時有效，快取到過期前 1 分鐘），再呼叫 Gmail 的 messages.send。
// 環境變數：GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET、GMAIL_REFRESH_TOKEN、GMAIL_SENDER（寄件人，就是授權的那個 Gmail）
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'

// 標頭裡的中文要用 RFC 2047 編碼（=?UTF-8?B?…?=）
const encodeHeader = (text) => `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`

// 純文字＋HTML 兩個版本的 MIME 信件，整封再轉成 Gmail API 要的 base64url
function buildRawMessage({ from, to, subject, text, html }) {
  const boundary = `tarot-${Date.now().toString(36)}`
  const lines = [
    `From: ${encodeHeader('塔羅占卜')} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(text, 'utf8').toString('base64'),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64'),
    `--${boundary}--`,
  ]
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url')
}

function createMailer({ env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const config = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    refreshToken: env.GMAIL_REFRESH_TOKEN,
    sender: env.GMAIL_SENDER,
  }
  let cached = null

  const isConfigured = () => Boolean(config.clientId && config.clientSecret && config.refreshToken && config.sender)

  async function accessToken() {
    if (cached && cached.expiresAt > now()) return cached.token
    const response = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || !payload.access_token) {
      throw new Error(`Gmail 授權失敗（${response.status} ${payload.error || ''}）`)
    }
    cached = { token: payload.access_token, expiresAt: now() + ((payload.expires_in || 3600) - 60) * 1000 }
    return cached.token
  }

  async function send({ to, subject, text, html }) {
    if (!isConfigured()) throw new Error('寄信功能尚未設定')
    const token = await accessToken()
    const response = await fetchImpl(SEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: buildRawMessage({ from: config.sender, to, subject, text, html }) }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      // access token 被撤銷時下次重新換
      if (response.status === 401) cached = null
      throw new Error(`Gmail 寄信失敗（${response.status} ${payload.error?.message || ''}）`)
    }
  }

  return { isConfigured, send }
}

module.exports = { createMailer, buildRawMessage }
