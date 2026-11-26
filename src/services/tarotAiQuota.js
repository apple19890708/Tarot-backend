// 塔羅 AI 的每日次數（v24 1-4）：AI 解讀（tarot）、抽牌追問（followUp）、雷諾曼（lenormand）各自計算，admin 不限。
// 原因：個股與財經新聞分析早就有每日上限，塔羅只檢查有沒有開通；帳號被盜或被寫程式狂打時 AI 費用沒有上限。
// 用量記在 MarketAiUsage（和股市 AI 同一張表、用 kind 分開），AI 開始產生（開始計費）才記一筆，
// 中途被使用者停止的也算；伺服器或 AI 那邊出錯時退還。v21 點數制上線後，這裡留著當防濫用的天花板。
// v29 項目 1：檢查次數到開始產生之間要等 AI 回應，同一個人同時送很多個請求時全部都會通過檢查，
// 所以加上「同一人同一種 AI 同時只能一個」的鎖（acquire／release），路由在檢查次數前先上鎖。
const { startOfTaipeiDay } = require('./clock')
const { createAiUsage, createUserLock } = require('./aiStream')

// lenormand：雷諾曼 AI 解讀（v27 D6），和塔羅分開計
const TAROT_AI_DAILY_LIMITS = { tarot: 30, followUp: 30, lenormand: 30 }
const LABELS = { tarot: 'AI 解讀', followUp: 'AI 追問', lenormand: '雷諾曼 AI 解讀' }

function createTarotAiQuota({ Usage, now = () => Date.now() } = {}) {
  const usage = createAiUsage({ Usage, now })
  const lock = createUserLock()

  // { allowed, used, limit }；admin 或沒有用量表時一律放行（limit 為 null）
  async function check(auth, kind) {
    const limit = auth?.role === 'admin' || !Usage ? null : TAROT_AI_DAILY_LIMITS[kind]
    if (limit === null) return { allowed: true, used: null, limit }
    const used = await Usage.countDocuments({ user: auth.userId, kind, createdAt: { $gte: startOfTaipeiDay(now()) } })
    return { allowed: used < limit, used, limit }
  }

  const limitMessage = (kind, limit) => `今天的${LABELS[kind]}已用完（每天 ${limit} 次），明天再試。`

  return {
    check,
    limitMessage,
    record: usage.record,
    refund: usage.refund,
    report: usage.report,
    // 同一人同一種 AI 同時只能一個（admin 也一樣：擋的是重複送出，不是次數）。
    // takeOver：新請求取代同一人進行中的舊請求（見 aiStream.js），拿不到回 false（409）
    acquire: (userId, kind, controller) => lock.acquire(`${kind}:${userId}`, controller),
    takeOver: (userId, kind, controller) => lock.takeOver(`${kind}:${userId}`, controller),
    release: (userId, kind) => lock.release(`${kind}:${userId}`),
  }
}

module.exports = { createTarotAiQuota, TAROT_AI_DAILY_LIMITS }
