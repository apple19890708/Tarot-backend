// 每日資產快照與資產走勢（v16 階段 3）。純函式的部分（加總、報酬率）可以直接測試。
//
// 報酬率用「時間加權」：每天的報酬 = (今天市值 − 昨天市值 − 資金進出 + 股利) ÷ 昨天市值，再連乘。
// 資金進出 = 成本變化 − 已實現變化（買進時成本增加＝投入；賣出時拿回的錢＝成本減少＋已實現增加）。
// 這樣加碼或賣出不會被誤算成賺賠，才能和大盤指數的漲跌直接比較。

const TW_TIMEZONE = 'Asia/Taipei'
// 台股 13:30 收盤，收盤價約 14:00 前定案
const SNAPSHOT_AFTER_MINUTES = 14 * 60

function taipeiNow(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TW_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

// 現在是不是記快照的時間：平日台北 14:00 之後
function snapshotDue(date = new Date()) {
  const now = taipeiNow(date)
  if (now.weekday === 'Sat' || now.weekday === 'Sun') return null
  return now.minutes >= SNAPSHOT_AFTER_MINUTES ? now.date : null
}

const round2 = (value) => Math.round(value * 100) / 100

// items：[{ market, position }]（position 是 portfolio.computePosition 的結果）
// 報價取不到的那檔（marketValue 為 null）用成本代替，避免總額突然掉一大截
function buildSnapshot(items, usdTwd) {
  const sides = { tw: { value: 0, cost: 0, realized: 0, dividends: 0 }, us: { value: 0, cost: 0, realized: 0, dividends: 0 } }
  for (const { market, position } of items) {
    if (!position || !sides[market]) continue
    const side = sides[market]
    side.cost += position.costBasis || 0
    side.value += position.marketValue ?? position.costBasis ?? 0
    side.realized += position.realized || 0
    side.dividends += position.dividends || 0
  }
  for (const side of Object.values(sides)) for (const key of Object.keys(side)) side[key] = round2(side[key])
  const fx = Number.isFinite(usdTwd) && usdTwd > 0 ? usdTwd : null
  const total = {}
  for (const key of ['value', 'cost', 'realized', 'dividends']) {
    total[key] = round2(sides.tw[key] + (fx ? sides.us[key] * fx : 0))
  }
  return { tw: sides.tw, us: sides.us, usdTwd: fx, total }
}

// snapshots：依日期排序的快照（只用 total）。回傳每天的累積報酬率（%），第一天是 0
function timeWeightedReturns(snapshots) {
  const result = []
  let growth = 1
  let prev = null
  for (const snap of snapshots) {
    const t = snap.total
    if (prev && prev.value > 0) {
      const flow = t.cost - prev.cost - (t.realized - prev.realized)
      const income = t.dividends - prev.dividends
      const dailyReturn = (t.value - prev.value - flow + income) / prev.value
      if (Number.isFinite(dailyReturn)) growth *= 1 + dailyReturn
    }
    result.push({ date: snap.date, returnPct: round2((growth - 1) * 100) })
    prev = t
  }
  return result
}

// bars：指數日 K。回傳從 baseDate（含）起算的累積漲跌 %，日期和快照對齊（沒有交易的日子沿用前一天）
function benchmarkReturns(bars, dates) {
  if (!bars?.length || !dates.length) return []
  const closeOn = (date) => {
    let close = null
    for (const bar of bars) {
      if (bar.date > date) break
      close = bar.close
    }
    return close
  }
  const base = closeOn(dates[0])
  if (!base) return []
  return dates.map((date) => {
    const close = closeOn(date)
    return { date, returnPct: close ? round2((close / base - 1) * 100) : null }
  })
}

module.exports = { taipeiNow, snapshotDue, buildSnapshot, timeWeightedReturns, benchmarkReturns }
