// Google 登入（v17 規格 I）：前端用 Google Identity Services 拿到 ID token，這裡向 Google 的 tokeninfo 端點驗證。
// 量不大，不加 google-auth-library；tokeninfo 會檢查簽章與過期，這裡再確認是發給我們的（aud）、信箱驗證過。
const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])

class GoogleTokenError extends Error {}

function createGoogleVerifier({ clientId = process.env.GOOGLE_CLIENT_ID, fetchImpl = fetch, now = () => Date.now() } = {}) {
  const isConfigured = () => Boolean(clientId)

  // 回傳 { googleId, email, name }；不合格就丟 GoogleTokenError
  async function verify(idToken) {
    if (!isConfigured()) throw new Error('Google 登入尚未設定')
    if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096) {
      throw new GoogleTokenError('Google 登入資料不正確。')
    }
    const response = await fetchImpl(`${TOKENINFO_URL}?id_token=${encodeURIComponent(idToken)}`)
    const info = await response.json().catch(() => ({}))
    if (!response.ok) throw new GoogleTokenError('Google 登入已失效，請再試一次。')
    if (info.aud !== clientId || !ISSUERS.has(info.iss)) throw new GoogleTokenError('Google 登入資料不正確。')
    if (Number(info.exp) * 1000 < now()) throw new GoogleTokenError('Google 登入已失效，請再試一次。')
    // tokeninfo 回的 email_verified 是字串 "true"
    if (!info.email || String(info.email_verified) !== 'true') {
      throw new GoogleTokenError('這個 Google 帳號的信箱還沒驗證，無法登入。')
    }
    return { googleId: String(info.sub), email: String(info.email).toLowerCase(), name: info.name ? String(info.name) : '' }
  }

  return { isConfigured, verify }
}

module.exports = { createGoogleVerifier, GoogleTokenError }
