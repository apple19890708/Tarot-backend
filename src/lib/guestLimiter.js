// 訪客的每 IP 限速（每日一牌 api-reviewer 2026-11-20；塔羅抽牌 v29 項目 4）。
// 不用登入就能一直打的端點（每次一個資料庫 $sample 聚合或重算分析）用這個擋；登入的人不受限制。
// 前面要先掛 optionalAuth（req.auth 有值才知道是登入的人）。
// 計數放記憶體（同 auth.js 的限速器），Cloud Run 多實例各算各的，只當第一道。
const { rateLimit } = require('express-rate-limit')

// 門檻：一般人一分鐘不會抽超過幾次；30 次是每日一牌既有的值，塔羅抽牌沿用（見 doc/v29-optimization-plan.md）
const GUEST_WINDOW_MS = 60 * 1000
const GUEST_MAX = 30

function createGuestLimiter({ windowMs = GUEST_WINDOW_MS, limit = GUEST_MAX, message = '抽牌次數太多，請稍後再試。' } = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => Boolean(req.auth),
    message: { message },
  })
}

module.exports = { createGuestLimiter, GUEST_WINDOW_MS, GUEST_MAX }
