// 安全標頭（v24 1-5）與「不給搜尋引擎收錄」（v24 4-4），抽出來方便測試。
// - helmet：關掉 X-Powered-By，加上 nosniff、X-Frame-Options、HSTS 等
// - 牌卡圖片（塔羅 /cards、雷諾曼 /lenormand）由 GitHub Pages 的頁面跨網域載入，helmet 預設的 Cross-Origin-Resource-Policy: same-origin 會擋，改成 cross-origin
// - API 回應一律 X-Robots-Tag: noindex
const helmet = require('helmet')

function securityHeaders() {
  const headers = helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } })
  return function apply(req, res, next) {
    res.setHeader('X-Robots-Tag', 'noindex')
    headers(req, res, next)
  }
}

module.exports = { securityHeaders }
