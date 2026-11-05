// 每日資產快照的寫入與讀取：外部排程（台股收盤後）與使用者開自訂追蹤頁時都會呼叫，同一天只留一筆（覆蓋）。
const { computePosition, normalizeFees, tradesOf } = require('./portfolio')
const { benchmarkReturns, buildSnapshot, snapshotDue, timeWeightedReturns } = require('./snapshots')

const FX_TARGET = { symbol: 'TWD=X', market: 'us', kind: 'index', name: '美元兌台幣' }
const BENCHMARKS = [
  { key: 'twii', symbol: '^TWII', label: '加權指數' },
  { key: 'gspc', symbol: '^GSPC', label: '標普 500' },
]

function createSnapshotRecorder({ MarketSnapshot, MarketWatch, MarketProfile, User, marketService, now = () => new Date() }) {
  async function usdTwd(userId) {
    try {
      const quote = await marketService.getQuote(FX_TARGET)
      if (quote?.price) return quote.price
    } catch (error) {
      console.error('匯率取得失敗：', error.message)
    }
    const last = await MarketSnapshot.findOne({ user: userId, usdTwd: { $ne: null } }).sort({ date: -1 })
    return last?.usdTwd ?? null
  }

  async function save(userId, date, items) {
    const snapshot = buildSnapshot(items, await usdTwd(userId))
    await MarketSnapshot.findOneAndUpdate({ user: userId, date }, { $set: snapshot }, { upsert: true, new: true, setDefaultsOnInsert: true })
    // 超過保留期限的刪掉
    const cutoff = new Date(now().getTime() - MarketSnapshot.KEEP_DAYS * 86400000).toISOString().slice(0, 10)
    await MarketSnapshot.deleteMany({ user: userId, date: { $lt: cutoff } })
    return snapshot
  }

  // 已經算好 position 的清單（自訂追蹤頁載入時）：到了記錄時間就順便記今天這筆
  async function recordFromItems(userId, items) {
    const date = snapshotDue(now())
    if (!date || !items.some((item) => item.position)) return null
    return save(userId, date, items.map((item) => ({ market: item.target.market, position: item.position })))
  }

  // 從資料庫重算一個人的持股（排程用）
  async function recordFor(userId, date) {
    const watches = await MarketWatch.find({ user: userId })
    const holding = watches.filter((w) => tradesOf(w).length || (w.dividends || []).length)
    if (!holding.length) return null
    const [summaries, profile] = await Promise.all([
      marketService.getWatchSummaries(holding.map((w) => w.target)),
      MarketProfile ? MarketProfile.findOne({ user: userId }) : null,
    ])
    const fees = normalizeFees(profile?.fees)
    const items = holding.map((watch, index) => {
      const quote = summaries[index]?.quote
      return {
        market: watch.target.market,
        position: computePosition({
          target: watch.target,
          trades: tradesOf(watch),
          dividends: (watch.dividends || []).map((d) => ({ amount: d.amount, date: d.date || null })),
          fees,
          quote: quote ? { price: quote.price, change: quote.change, date: quote.date } : null,
        }),
      }
    })
    return save(userId, date, items)
  }

  // 排程：所有有持股、而且仍有金融股市權限的使用者。回傳記了幾筆；還沒到時間回傳 null
  async function recordAll() {
    const date = snapshotDue(now())
    if (!date) return null
    const userIds = await MarketWatch.distinct('user', {
      $or: [{ 'trades.0': { $exists: true } }, { 'lots.0': { $exists: true } }, { 'dividends.0': { $exists: true } }],
    })
    if (!userIds.length) return 0
    const users = await User.find({ _id: { $in: userIds } })
    let count = 0
    for (const user of users.filter((u) => u.canUseStock())) {
      try {
        if (await recordFor(user._id, date)) count += 1
      } catch (error) {
        console.error(`資產快照失敗（${user._id}）：`, error.message)
      }
    }
    return count
  }

  // 資產走勢：每天的總額與時間加權報酬率，加上大盤指數同期的漲跌
  async function history(userId) {
    const snapshots = await MarketSnapshot.find({ user: userId }).sort({ date: 1 }).lean()
    const dates = snapshots.map((s) => s.date)
    const returns = timeWeightedReturns(snapshots)
    const benchmarks = await Promise.all(
      BENCHMARKS.map(async ({ key, symbol, label }) => {
        if (!dates.length) return { key, label, points: [] }
        try {
          return { key, label, points: benchmarkReturns(await marketService.getHistoryBars(symbol), dates) }
        } catch (error) {
          console.error(`大盤歷史資料失敗（${symbol}）：`, error.message)
          return { key, label, points: [] }
        }
      }),
    )
    return {
      points: snapshots.map((s, i) => ({
        date: s.date,
        value: s.total.value,
        cost: s.total.cost,
        realized: s.total.realized,
        dividends: s.total.dividends,
        usdTwd: s.usdTwd,
        returnPct: returns[i].returnPct,
      })),
      benchmarks,
    }
  }

  return { recordFromItems, recordFor, recordAll, history }
}

module.exports = { createSnapshotRecorder }
