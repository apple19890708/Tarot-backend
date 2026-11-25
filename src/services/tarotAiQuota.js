// 塔羅 AI 的每日次數（v24 1-4）：AI 解讀（tarot）與抽牌追問（followUp）各自計算，admin 不限。
// 原因：個股與財經新聞分析早就有每日上限，塔羅只檢查有沒有開通；帳號被盜或被寫程式狂打時 AI 費用沒有上限。
// 用量記在 MarketAiUsage（和股市 AI 同一張表、用 kind 分開），AI 開始產生（開始計費）才記一筆，
// 中途被使用者停止的也算；伺服器或 AI 那邊出錯時退還。v21 點數制上線後，這裡留著當防濫用的天花板
const { startOfTaipeiDay } = require('../routes/marketAnalysis')

// lenormand：雷諾曼 AI 解讀（v27 D6），和塔羅分開計
const TAROT_AI_DAILY_LIMITS = { tarot: 30, followUp: 30, lenormand: 30 }
const LABELS = { tarot: 'AI 解讀', followUp: 'AI 追問', lenormand: '雷諾曼 AI 解讀' }

function createTarotAiQuota({ Usage, now = () => Date.now() } = {}) {
  // { allowed, used, limit }；admin 或沒有用量表時一律放行（limit 為 null）
  async function check(auth, kind) {
    const limit = auth?.role === 'admin' || !Usage ? null : TAROT_AI_DAILY_LIMITS[kind]
    if (limit === null) return { allowed: true, used: null, limit }
    const used = await Usage.countDocuments({ user: auth.userId, kind, createdAt: { $gte: startOfTaipeiDay(now()) } })
    return { allowed: used < limit, used, limit }
  }

  const limitMessage = (kind, limit) => `今天的${LABELS[kind]}已用完（每天 ${limit} 次），明天再試。`

  // 記錄失敗只寫 log，不中斷解讀
  function record(userId, kind) {
    if (!Usage) return null
    const expireAt = new Date(now() + (Usage.KEEP_DAYS || 2) * 86400000)
    return Promise.resolve(Usage.create({ user: userId, kind, expireAt })).catch((error) => {
      console.error('AI 用量記錄失敗：', error.message)
      return null
    })
  }

  async function refund(pending) {
    const entry = await pending
    if (!entry?._id || !Usage?.deleteOne) return
    await Promise.resolve(Usage.deleteOne({ _id: entry._id })).catch((error) => console.error('AI 用量退還失敗：', error.message))
  }

  return { check, limitMessage, record, refund }
}

module.exports = { createTarotAiQuota, TAROT_AI_DAILY_LIMITS }
