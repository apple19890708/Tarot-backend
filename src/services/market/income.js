// 獲利與股利（v20）：歷史股利、持有期間的應收股利、未來 12 個月的股利預估。純函式，抓資料與快取在 marketService。
//
// 資料：Yahoo chart API 的 events=div|split（台股、上櫃、美股都有）＋證交所／櫃買的除權息預告（corporateEvents）。
// Yahoo 的兩個特性（2026-11-10 用證交所 TWT49U 核對過玉山金 2884）：
// 1. 台股配股以 split 事件出現，比例 1020.0332:1000 就是每股配 0.0200332 股
// 2. 歷史現金股利已依「之後的」分割與配股調整：2024 年實際 1.2 元，Yahoo 寫 1.188（÷ 2025 年配股 1.0101）
//    → 算當年應收要乘回之後的比例；預估未來直接用調整後的（它對應的是現在的股數）

const DAY_MS = 24 * 60 * 60 * 1000
// 比例在這之間（台股）才當成配股；之外（2:1、4:1 或反分割）是真正的股票分割
const STOCK_DIVIDEND_MAX_RATIO = 1.5

const DEFAULT_INCOME_SETTINGS = Object.freeze({
  // 二代健保補充保費：台股單次股利達門檻才扣
  nhi: true,
  nhiRate: 0.0211,
  nhiThreshold: 20000,
  // 美股股利預扣稅（台灣居民目前 30%；租稅協定生效會降低，所以做成設定）
  usWithholding: 0.3,
})

const round2 = (value) => (value === null || value === undefined || !Number.isFinite(value) ? null : Math.round(value * 100) / 100)
const round6 = (value) => Math.round(value * 1e6) / 1e6

function normalizeIncomeSettings(raw) {
  const pick = (key, ok) => (ok(raw?.[key]) ? raw[key] : DEFAULT_INCOME_SETTINGS[key])
  return {
    nhi: pick('nhi', (v) => typeof v === 'boolean'),
    nhiRate: pick('nhiRate', (v) => Number.isFinite(v) && v >= 0 && v <= 0.1),
    nhiThreshold: pick('nhiThreshold', (v) => Number.isFinite(v) && v >= 0 && v <= 1e6),
    usWithholding: pick('usWithholding', (v) => Number.isFinite(v) && v >= 0 && v <= 0.5),
  }
}

// Yahoo chart 的 events → { cash: [{ date, amount }], splits: [{ date, ratio, kind }] }，依日期排序。
// dateOf(ts 秒) 由呼叫端給（用交易所時區轉日期）。kind：stockDividend（台股配股）／split（真正的分割）
function parseYahooEvents(events, { market, dateOf }) {
  const cash = Object.values(events?.dividends || {})
    .filter((d) => Number.isFinite(d?.amount) && d.amount > 0 && Number.isFinite(d?.date))
    // Yahoo 的金額有浮點雜訊（2330 的 5 元是 5.000011），台股、美股的股利都不會超過小數 4 位
    .map((d) => ({ date: dateOf(d.date), amount: Math.round(d.amount * 1e4) / 1e4 }))
  const splits = Object.values(events?.splits || {})
    .filter((s) => Number.isFinite(s?.numerator) && Number.isFinite(s?.denominator) && s.numerator > 0 && s.denominator > 0)
    .map((s) => {
      const ratio = s.numerator / s.denominator
      const kind = market === 'tw' && ratio > 1 && ratio < STOCK_DIVIDEND_MAX_RATIO ? 'stockDividend' : 'split'
      return { date: dateOf(s.date), ratio: round6(ratio), kind }
    })
  const byDate = (a, b) => a.date.localeCompare(b.date)
  return { cash: cash.sort(byDate), splits: splits.filter((s) => s.ratio !== 1).sort(byDate) }
}

// 當年實際的每股現金股利：乘回這次之後所有分割、配股的比例
function actualPerShare(event, splits) {
  return splits.filter((s) => s.date > event.date).reduce((amount, s) => amount * s.ratio, event.amount)
}

// 領股利時的扣款：台股單次達門檻扣健保補充保費；美股扣預扣稅
function deductionsOf(market, gross, settings) {
  if (gross <= 0) return 0
  if (market === 'tw') return settings.nhi && gross >= settings.nhiThreshold ? Math.round(gross * settings.nhiRate) : 0
  return gross * settings.usWithholding
}

// 某天（不含）以前持有的股數。stockDividend 是配股（加股數）
function sharesBefore(trades, date, unit) {
  let shares = 0
  for (const trade of trades) {
    if (!trade.date || trade.date >= date) continue
    shares += (trade.side === 'sell' ? -1 : 1) * trade.quantity * unit
  }
  return Math.max(0, shares)
}

// 已記錄的股利是不是這一次：帶入時記了 exDate 就一定是；手動記的（沒有 exDate）在除息後 75 天內入帳的算「可能已記錄」
const RECORD_WINDOW_DAYS = 75
function recordedStatus(exDate, dividends) {
  if (dividends.some((d) => d.exDate === exDate)) return { recorded: 'yes', matchIndex: null }
  const start = Date.parse(exDate)
  // 「可能已記錄」時給是哪一筆（dividends 的索引），畫面的「是同一筆」按鈕用它補上 exDate，前端不用再找一次
  const matchIndex = dividends.findIndex((d) => {
    if (d.exDate || !d.date) return false
    const diff = (Date.parse(d.date) - start) / DAY_MS
    return diff >= 0 && diff <= RECORD_WINDOW_DAYS
  })
  return matchIndex >= 0 ? { recorded: 'maybe', matchIndex } : { recorded: 'no', matchIndex: null }
}

// 持有期間的應收股利（現金與配股），和已記錄的對照。
// 有任何一筆買賣沒有日期就判斷不出當時有沒有持有，整檔不算（available: false），不猜
// dismissed：使用者刪掉的那幾次（[{ type, exDate }]）。照樣算、標 dismissed: true（過去月份的實際應收、預估準不準還要用），
// 只是不算進「還沒記錄」的合計，畫面也不再列出來
function computeEntitlements({ target, trades = [], dividends = [], dismissed = [], history, settings: rawSettings, today, unit }) {
  const settings = normalizeIncomeSettings(rawSettings)
  if (!trades.length) return { available: false, reason: 'noTrades', events: [] }
  if (trades.some((t) => !t.date)) return { available: false, reason: 'missingDates', events: [] }
  if (!history) return { available: false, reason: 'noData', events: [] }

  // 持有起點是第一筆買進（配股的日期不能當起點）
  const first = trades
    .filter((t) => t.side === 'buy')
    .map((t) => t.date)
    .sort()[0]
  if (!first) return { available: false, reason: 'noTrades', events: [] }
  const inRange = (date) => date > first && date <= today
  const events = []

  for (const event of history.cash.filter((e) => inRange(e.date))) {
    const shares = sharesBefore(trades, event.date, unit)
    if (shares <= 0) continue
    const perShare = actualPerShare(event, history.splits)
    const gross = perShare * shares
    const deduction = deductionsOf(target.market, gross, settings)
    events.push({
      type: 'cash',
      exDate: event.date,
      perShare: round6(perShare),
      shares: round2(shares),
      gross: round2(gross),
      deduction: round2(deduction),
      net: round2(gross - deduction),
      ...recordedStatus(event.date, dividends),
    })
  }
  for (const split of history.splits.filter((s) => s.kind === 'stockDividend' && inRange(s.date))) {
    const shares = sharesBefore(trades, split.date, unit)
    if (shares <= 0) continue
    // 不足一股的部分公司會折發現金，這裡只算整股
    const addShares = Math.floor(shares * (split.ratio - 1) + 1e-9)
    if (addShares <= 0) continue
    const recorded = trades.some((t) => t.side === 'stockDividend' && t.date === split.date) ? 'yes' : 'no'
    events.push({
      type: 'stock',
      exDate: split.date,
      ratio: round6(split.ratio - 1),
      shares: round2(shares),
      addShares,
      addQuantity: round6(addShares / unit),
      recorded,
    })
  }
  events.sort((a, b) => a.exDate.localeCompare(b.exDate))
  const dismissedKeys = new Set(dismissed.map((d) => `${d.type}:${d.exDate}`))
  for (const event of events) event.dismissed = dismissedKeys.has(`${event.type}:${event.exDate}`)

  // 持有期間做過真正的分割：使用者記的張數多半是分割前的，提醒要手動調整
  const splitDuring = history.splits.find((s) => s.kind === 'split' && inRange(s.date))
  const unrecorded = events.filter((e) => e.recorded === 'no' && !e.dismissed)
  return {
    available: true,
    events,
    splitWarning: splitDuring ? { date: splitDuring.date, ratio: splitDuring.ratio } : null,
    unrecordedCash: round2(unrecorded.filter((e) => e.type === 'cash').reduce((sum, e) => sum + e.net, 0)),
    unrecordedShares: unrecorded.filter((e) => e.type === 'stock').reduce((sum, e) => sum + e.addShares, 0),
  }
}

// 從 today 這個月起 12 個月（YYYY-MM）
function nextMonths(today, count = 12) {
  const [year, month] = today.slice(0, 7).split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const total = year * 12 + (month - 1) + i
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
  })
}
const shiftYear = (month, years) => `${Number(month.slice(0, 4)) + years}${month.slice(4)}`

// 推估日期：把去年那次的「日」放到今年這個月（月底不夠就取月底），遇到週六日往後移到週一，移出這個月就改往前到週五
function guessDate(month, lastYearDate) {
  if (!lastYearDate) return null
  const [year, mon] = month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  const day = Math.min(Number(lastYearDate.slice(8, 10)), lastDay)
  let date = new Date(Date.UTC(year, mon - 1, day))
  const weekday = date.getUTCDay()
  if (weekday === 6 || weekday === 0) {
    const forward = new Date(date.getTime() + (weekday === 6 ? 2 : 1) * DAY_MS)
    date = forward.getUTCMonth() === mon - 1 ? forward : new Date(date.getTime() - (weekday === 6 ? 1 : 2) * DAY_MS)
  }
  return date.toISOString().slice(0, 10)
}

// 配息頻率（給畫面看）：過去 12 個月配了幾次
function frequencyOf(count) {
  if (count >= 10) return 'monthly'
  if (count >= 3) return 'quarterly'
  if (count === 2) return 'semiannual'
  if (count === 1) return 'annual'
  return 'none'
}

// 未來 12 個月的股利預估（依除息月）。
// 每個月：證交所已公告（有金額）→ 用公告的；本月已經除息 → 用實際的；去年同月有配 → 推估，金額用過去 12 個月每次的平均。
// 配股只列已公告的。shares 是目前持有股數（0 也算，畫面用 perShare 給「每持有 1 張一年約領多少」）
function projectDividends({ target, history, announced = [], shares = 0, settings: rawSettings, today, unit }) {
  const settings = normalizeIncomeSettings(rawSettings)
  const months = nextMonths(today)
  const cash = history?.cash ?? []
  // 「近 12 個月」以月為單位：本月還沒除息 → 從去年同月算起（去年這個月有配，今年這個月才會推估；
  // 用「365 天前」當邊界時，去年剛好在今天這個日期除息的會被排除，2026-11-10 實測 AAPL 漏了 11 月）；
  // 本月已經除息 → 從 11 個月前算起，不把去年同月和今年同月重複算進平均
  const thisMonth = months[0]
  const doneThisMonth = cash.some((e) => e.date.startsWith(thisMonth) && e.date <= today)
  const windowStart = `${doneThisMonth ? nextMonths(shiftYear(thisMonth, -1), 2)[1] : shiftYear(thisMonth, -1)}-01`
  const recent = cash.filter((e) => e.date >= windowStart && e.date <= today)
  const average = recent.length ? recent.reduce((sum, e) => sum + e.amount, 0) / recent.length : null
  const recentMonths = new Set(recent.map((e) => e.date.slice(0, 7)))
  // 月配：每個月都推估，不看去年同月有沒有配。Yahoo 的除息日偶爾會擠到同一個月
  // （2026-11-10 實測 00929：3 月兩筆、2 月沒有），只看同月份會讓月配少一個月
  const frequency = frequencyOf(recent.length)
  // Yahoo 有時會先列出即將除息的配息（美股沒有證交所那種預告表，靠這個）；證交所預告優先
  const future = [
    ...announced.filter((e) => e.date >= today),
    ...cash.filter((e) => e.date > today && !announced.some((a) => a.date === e.date)).map((e) => ({ date: e.date, cashDividend: e.amount, stockRatio: null })),
  ]

  const result = months.map((month) => {
    const notice = future.find((e) => e.date.startsWith(month) && e.cashDividend)
    const noticeDateOnly = future.find((e) => e.date.startsWith(month) && !e.cashDividend && !e.stockRatio)
    const done = cash.find((e) => e.date.startsWith(month) && e.date <= today)
    let entry = null
    if (notice) entry = { perShare: notice.cashDividend, source: 'announced', exDate: notice.date }
    else if (done) entry = { perShare: done.amount, source: 'exDone', exDate: done.date }
    else if (average !== null && (frequency === 'monthly' || recentMonths.has(shiftYear(month, -1)) || noticeDateOnly))
      // 已公告除息日但還沒公告金額（例如主動式 ETF 的預告）：日期用公告的，金額推估
      entry = {
        perShare: average,
        source: 'estimated',
        exDate: noticeDateOnly?.date ?? null,
        // 月曆用的推估日期：去年同月那次的除息日加一年（遇到週末移到平日）；推不出來（月配去年該月剛好沒配）是 null
        estimatedDate: noticeDateOnly ? null : guessDate(month, cash.filter((e) => e.date.startsWith(shiftYear(month, -1))).pop()?.date ?? null),
      }

    let cashOut = null
    if (entry) {
      const gross = entry.perShare * shares
      const deduction = deductionsOf(target.market, gross, settings)
      cashOut = { ...entry, perShare: round6(entry.perShare), gross: round2(gross), deduction: round2(deduction), net: round2(gross - deduction) }
    }
    const stockNotice = future.find((e) => e.date.startsWith(month) && e.stockRatio)
    const stock = stockNotice
      ? {
          exDate: stockNotice.date,
          ratio: stockNotice.stockRatio,
          addShares: Math.floor(shares * stockNotice.stockRatio + 1e-9),
          addQuantity: round6(Math.floor(shares * stockNotice.stockRatio + 1e-9) / unit),
        }
      : null
    return { month, cash: cashOut, stock }
  })

  const annualPerShare = result.reduce((sum, m) => sum + (m.cash?.perShare ?? 0), 0)
  const annualGross = result.reduce((sum, m) => sum + (m.cash?.gross ?? 0), 0)
  const annualNet = result.reduce((sum, m) => sum + (m.cash?.net ?? 0), 0)
  return {
    months: result,
    frequency,
    annualPerShare: round6(annualPerShare),
    // 每持有 1 張（台股）或 1 股（美股）一年約領多少（未扣款）
    annualPerUnit: round2(annualPerShare * unit),
    annualGross: round2(annualGross),
    annualNet: round2(annualNet),
    hasEstimate: result.some((m) => m.cash?.source === 'estimated'),
  }
}

// ---- 年化報酬（XIRR，v20 階段 5）----
// 用每一筆實際的現金流算：買進付出（含手續費）、賣出收回（扣手續費與稅）、記錄的股利，
// 最後把「現在全部賣掉能拿回的錢」（市值扣預估賣出成本）當成今天收回的一筆。配股沒有現金流，不算。
// 持有不到 90 天不算：年化會把幾天的漲跌放大成誇張的數字
const XIRR_MIN_DAYS = 90

// flows：[{ date: 'YYYY-MM-DD', amount }]（付出為負、收回為正）→ 年化報酬率（小數）；解不出來是 null
function xirr(flows) {
  if (flows.length < 2 || !flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return null
  const start = Math.min(...flows.map((f) => Date.parse(f.date)))
  const points = flows.map((f) => ({ years: (Date.parse(f.date) - start) / (365 * DAY_MS), amount: f.amount }))
  const npv = (rate) => points.reduce((sum, p) => sum + p.amount / (1 + rate) ** p.years, 0)
  const slope = (rate) => points.reduce((sum, p) => sum - (p.years * p.amount) / (1 + rate) ** (p.years + 1), 0)
  // 先用牛頓法；跑出合理範圍或不收斂就改用二分法
  let rate = 0.1
  for (let i = 0; i < 50; i += 1) {
    const value = npv(rate)
    const d = slope(rate)
    if (!Number.isFinite(value) || !Number.isFinite(d) || d === 0) break
    const next = rate - value / d
    if (!Number.isFinite(next) || next <= -0.9999 || next > 100) break
    if (Math.abs(next - rate) < 1e-9) return next
    rate = next
  }
  let low = -0.9999
  let high = 100
  if (npv(low) * npv(high) > 0) return null
  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2
    if (npv(low) * npv(mid) <= 0) high = mid
    else low = mid
    if (high - low < 1e-9) break
  }
  return (low + high) / 2
}

// 一檔的現金流。不能算時回 reason：missingDates（買賣或股利沒填日期）、noQuote（還有持股但報價取不到）
function cashFlowsOf(item, today) {
  const { position, target } = item
  const trades = item.trades ?? []
  const dividends = item.dividends ?? []
  if (!position || !trades.length) return { reason: 'noTrades' }
  if (trades.some((t) => !t.date) || dividends.some((d) => !d.date)) return { reason: 'missingDates' }
  const unit = unitOfMarket(target.market)
  const flows = []
  trades.forEach((trade, index) => {
    if (trade.side === 'stockDividend') return
    const cost = position.trades?.[index] ?? { fee: 0, tax: 0 }
    const amount = trade.price * trade.quantity * unit
    if (trade.side === 'buy') flows.push({ date: trade.date, amount: -(amount + (cost.fee ?? 0)) })
    else flows.push({ date: trade.date, amount: amount - (cost.fee ?? 0) - (cost.tax ?? 0) })
  })
  for (const dividend of dividends) flows.push({ date: dividend.date, amount: dividend.amount })
  if (position.quantity > 0) {
    if (position.marketValue === null || position.marketValue === undefined) return { reason: 'noQuote' }
    flows.push({ date: today, amount: position.marketValue - (position.sellCost ?? 0) })
  }
  return { flows }
}

// flows → { pct（%）, reason }；reason：tooShort（不到 90 天）、noSolution（解不出來）
function annualizedOf(flows, today) {
  const first = flows.filter((f) => f.amount < 0).map((f) => f.date).sort()[0]
  if (!first) return { pct: null, reason: 'noSolution' }
  if ((Date.parse(today) - Date.parse(first)) / DAY_MS < XIRR_MIN_DAYS) return { pct: null, reason: 'tooShort' }
  const rate = xirr(flows)
  return rate === null ? { pct: null, reason: 'noSolution' } : { pct: round2(rate * 100), reason: null }
}

// ---- 多年平均股利（v20 2.9.9 存股試算 2.0）----
// 近 3 年平均每年的現金股利（當年實際的每股金額）。只看近 12 個月容易抓到高點（高股息 ETF 配息起伏大），
// 存股試算預設用這個比較穩的基準。
// 依配息頻率取「最近 N 次」（年配 3 次、半年配 6 次、季配 12 次、月配 36 次）再除以年數，不用「往回 36 個月切一刀」：
// 每年除息日會前後差幾週，年配的股票剛好在切點附近時會抓到 2 次或 4 次，平均少算或多算三分之一（2026-11-11 審查發現）。
// 期間多放寬 2 個月容許除息日漂移；次數不夠（上市不久、中途改了配息頻率）就退成 2 年、1 年；連 1 年都不夠是 null。
// price 有給才算殖利率（未扣款，%）
const AVERAGE_YEARS = [3, 2, 1]
const AVERAGE_DRIFT_MONTHS = 2
// 一年配幾次：看最近 4 個配息間隔的中位數（約 30 天月配、90 天季配、180 天半年配、365 天年配）。
// 不用「近 12 個月配了幾次」：除息日漂移時，年配可能在 12 個月內出現 2 次（被當成半年配）或 0 次。
// 只看最近的間隔，中途改了頻率（年配改季配）時跟著新的頻率。近 14 個月都沒配息就當作沒在配（null）
function payoutsPerYearOf(past, today) {
  if (!past.some((e) => e.date > shiftMonths(today, 12 + AVERAGE_DRIFT_MONTHS))) return null
  const recent = past.slice(-5)
  const gaps = recent.slice(1).map((e, i) => (Date.parse(e.date) - Date.parse(recent[i].date)) / DAY_MS).sort((a, b) => a - b)
  if (!gaps.length) return 1
  const median = gaps[Math.floor(gaps.length / 2)]
  if (median <= 45) return 12
  if (median <= 135) return 4
  if (median <= 270) return 2
  return 1
}
function shiftMonths(date, months) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - months)
  return d.toISOString().slice(0, 10)
}
function dividendAverageOf(history, price, today) {
  if (!history?.cash?.length) return null
  const past = history.cash.filter((e) => e.date <= today)
  const perYear = payoutsPerYearOf(past, today)
  if (!perYear) return null
  for (const years of AVERAGE_YEARS) {
    const inWindow = past.filter((e) => e.date > shiftMonths(today, years * 12 + AVERAGE_DRIFT_MONTHS))
    if (inWindow.length < perYear * years) continue
    const recent = inWindow.slice(-perYear * years)
    const total = recent.reduce((sum, e) => sum + actualPerShare(e, history.splits), 0)
    if (total <= 0) return null
    const perShare = Math.round((total / years) * 1e4) / 1e4
    return { months: years * 12, perShare, yieldPct: Number.isFinite(price) && price > 0 ? round2((perShare / price) * 100) : null }
  }
  return null
}

// 近 2 年（從 24 個月前的 1 號起、到今天）實際的除息與配股，給股利月曆往前看。
// 現金股利用當年實際的每股金額（乘回之後的配股、分割，和應收股利同一個算法）
const PAST_YEARS = 2
function pastEventsOf(history, today) {
  if (!history) return []
  const from = `${Number(today.slice(0, 4)) - PAST_YEARS}${today.slice(4, 7)}-01`
  const inRange = (date) => date >= from && date <= today
  const cash = history.cash
    .filter((e) => inRange(e.date))
    .map((e) => ({ type: 'cash', date: e.date, perShare: round6(actualPerShare(e, history.splits)) }))
  const stock = history.splits
    .filter((s) => s.kind === 'stockDividend' && inRange(s.date))
    .map((s) => ({ type: 'stock', date: s.date, ratio: round6(s.ratio - 1) }))
  return [...cash, ...stock].sort((a, b) => a.date.localeCompare(b.date))
}

// ---- 填息追蹤（v20 階段 7）----
// 除息後，收盤價第一次回到「除息前一個交易日的收盤價」那天就是填息（除權息的話是填權息）；天數用交易日、除息當天就填算 1 天。
// Yahoo 的日 K 已依分割與配股調整（2026-11-10 核對玉山金：2025-07-21 實際收 34.20，Yahoo 是 33.861 ＝ 34.20 ÷ 1.0101514），
// 所以每根 K 棒都乘回「之後的」分割、配股比例，還原成當天的實際價格再比，填息發生在下一次配股之後也不會算錯
const FILL_EVENTS = 8
const FILL_TOLERANCE = 0.0005
// 日 K 還原成當天的實際收盤價（乘回之後的分割、配股比例）
function realClosesOf(history, bars) {
  const factor = (date) => history.splits.filter((s) => s.date > date).reduce((product, s) => product * s.ratio, 1)
  return bars.map((bar) => ({ date: bar.date, close: bar.close * factor(bar.date) }))
}

// 某個除權息日的填息狀況；日 K 不夠（除息前或除息後沒有資料）回傳 null。配股（填權）也適用：還原後的除權當天價格本來就是除權後的實際價
function fillOf(real, exDate) {
  const preIndex = real.findLastIndex((bar) => bar.date < exDate)
  const start = real.findIndex((bar) => bar.date >= exDate)
  if (preIndex < 0 || start < 0) return null
  const target = real[preIndex].close
  // 容許萬分之五：Yahoo 的調整價只到小數 3 位，還原回去會比實際前收多一點點（33.861 × 1.0101514 ＝ 34.2047，實際 34.20），
  // 不容許的話收盤回到 34.20 也判成沒填。萬分之五比台股一檔跳動還小，不會把沒填的判成填了
  const filledAt = real.findIndex((bar, i) => i >= start && bar.close >= target * (1 - FILL_TOLERANCE))
  if (filledAt >= 0) return { preClose: round2(target), filledOn: real[filledAt].date, days: filledAt - start + 1, gap: null, gapPct: null, daysSince: null }
  const gap = target - real[real.length - 1].close
  return { preClose: round2(target), filledOn: null, days: null, gap: round2(gap), gapPct: round2((gap / target) * 100), daysSince: real.length - start }
}

function computeFills({ history, bars, today }) {
  if (!history || !bars?.length) return null
  const from = `${Number(today.slice(0, 4)) - PAST_YEARS}${today.slice(4, 7)}-01`
  const real = realClosesOf(history, bars)
  const events = []
  for (const event of history.cash.filter((e) => e.date >= from && e.date <= today)) {
    const fill = fillOf(real, event.date)
    if (fill) events.push({ exDate: event.date, perShare: round6(actualPerShare(event, history.splits)), ...fill })
  }
  const filled = events.filter((e) => e.days !== null)
  return {
    // 新到舊，最多 8 次
    events: events.slice(-FILL_EVENTS).reverse(),
    total: events.length,
    filledCount: filled.length,
    avgDays: filled.length ? Math.round((filled.reduce((sum, e) => sum + e.days, 0) / filled.length) * 10) / 10 : null,
  }
}

// ---- 個股分析的除權息分頁 ----
// 歷年每一次除權息一列（同一天的現金與配股合併）：當年實際的每股現金股利、配股（台股換算成「元」：每股配 0.02 股＝面額 10 元 × 0.02 ＝ 0.2 元）、
// 殖利率（現金股利 ÷ 除息前一個交易日的實際收盤價）、填息狀況。新到舊；history 抓不到回傳 null，沒配過息回傳空陣列
const TW_PAR_VALUE = 10
function buildDividendRecords({ history, bars, market, today }) {
  if (!history) return null
  const real = bars?.length ? realClosesOf(history, bars) : []
  const byDate = new Map()
  const rowOf = (date) => {
    if (!byDate.has(date)) byDate.set(date, { year: Number(date.slice(0, 4)), exDate: date, cash: null, stock: null })
    return byDate.get(date)
  }
  for (const event of history.cash.filter((e) => e.date <= today)) {
    const row = rowOf(event.date)
    row.cash = round6((row.cash ?? 0) + actualPerShare(event, history.splits))
  }
  if (market === 'tw') {
    for (const split of history.splits.filter((s) => s.kind === 'stockDividend' && s.date <= today)) {
      // Yahoo 的配股比例有雜訊（玉山金 2025 年 0.1 元算出 0.10015），台股配股公告都是到「角」左右，取到小數 2 位
      rowOf(split.date).stock = round2((split.ratio - 1) * TW_PAR_VALUE)
    }
  }
  return [...byDate.values()]
    .sort((a, b) => b.exDate.localeCompare(a.exDate))
    .map((row) => {
      const fill = real.length ? fillOf(real, row.exDate) : null
      return {
        ...row,
        preClose: fill?.preClose ?? null,
        yieldPct: row.cash !== null && fill?.preClose ? round2((row.cash / fill.preClose) * 100) : null,
        fill: fill ? { filledOn: fill.filledOn, days: fill.days, gapPct: fill.gapPct, daysSince: fill.daysSince } : null,
      }
    })
}

// ---- 集中度提醒（v20 2.9.8）----
// 有持股、有市值的才算；美股換成台幣（取不到匯率時美股不算，excludedUs 記幾檔）。
// 單一持股超過 thresholds.holding%、單一產業超過 thresholds.industry% 就提醒。產業別只有台股個股有（ETF 沒有產業，不算進任何產業）。
// 至少要有 2 檔持股才提醒（只有一檔一定是 100%，提醒沒有意義）。提醒文字在這裡產生，前端直接顯示
const DEFAULT_CONCENTRATION = Object.freeze({ holding: 30, industry: 50 })
const CONCENTRATION_LIST = 10
function normalizeConcentration(raw) {
  const pick = (key) => (Number.isFinite(raw?.[key]) && raw[key] >= 5 && raw[key] <= 100 ? raw[key] : DEFAULT_CONCENTRATION[key])
  return { holding: pick('holding'), industry: pick('industry') }
}
function concentrationOf({ rows, usdTwd = null, industries = new Map(), thresholds: rawThresholds }) {
  const thresholds = normalizeConcentration(rawThresholds)
  const fx = Number.isFinite(usdTwd) && usdTwd > 0 ? usdTwd : null
  const held = rows.filter((row) => row.quantity > 0 && row.position?.marketValue > 0)
  const usable = held.filter((row) => row.target.market === 'tw' || fx !== null)
  const valueOf = (row) => row.position.marketValue * (row.target.market === 'us' ? fx : 1)
  const total = usable.reduce((sum, row) => sum + valueOf(row), 0)
  const base = { thresholds, total: round2(total), count: usable.length, excludedUs: held.length - usable.length }
  if (!usable.length || total <= 0) return { ...base, holdings: [], industries: [], unclassifiedPct: null, warnings: [] }

  const nameOf = (row) => row.target.name || row.target.code || row.target.symbol
  const holdings = usable
    .map((row) => ({ id: row.id, name: nameOf(row), code: row.target.code || row.target.symbol, pct: round2((valueOf(row) / total) * 100) }))
    .sort((a, b) => b.pct - a.pct)
  const groups = new Map()
  let classified = 0
  for (const row of usable) {
    const industry = row.target.market === 'tw' && row.target.code ? industries.get(row.target.code) : null
    if (!industry) continue
    classified += valueOf(row)
    if (!groups.has(industry.code)) groups.set(industry.code, { code: industry.code, label: industry.label, value: 0, names: [] })
    const group = groups.get(industry.code)
    group.value += valueOf(row)
    group.names.push(nameOf(row))
  }
  const industryList = [...groups.values()]
    .map((g) => ({ code: g.code, label: g.label, pct: round2((g.value / total) * 100), names: g.names }))
    .sort((a, b) => b.pct - a.pct)

  const warnings = []
  if (usable.length >= 2) {
    for (const h of holdings.filter((h) => h.pct > thresholds.holding)) {
      warnings.push({ type: 'holding', key: h.id, pct: h.pct, text: `${h.name} 佔持股市值 ${h.pct}%，超過你設的 ${thresholds.holding}%：這一檔大跌時，整體資產會跟著受很大影響。` })
    }
    for (const g of industryList.filter((g) => g.pct > thresholds.industry)) {
      warnings.push({ type: 'industry', key: g.code, pct: g.pct, text: `${g.label}（${g.names.join('、')}）合計佔持股市值 ${g.pct}%，超過你設的 ${thresholds.industry}%：同一個產業不景氣時會一起跌。` })
    }
  }
  return {
    ...base,
    holdings: holdings.slice(0, CONCENTRATION_LIST),
    industries: industryList,
    // 沒有產業別的（ETF、美股、查不到的）佔多少
    unclassifiedPct: round2(((total - classified) / total) * 100),
    warnings,
  }
}

const unitOfMarket = (market) => (market === 'tw' ? 1000 : 1)
const pct = (part, whole) => (Number.isFinite(part) && Number.isFinite(whole) && whole > 0 ? round2((part / whole) * 100) : null)

function emptyTotals(months, pastMonths = []) {
  return {
    count: 0,
    cost: 0,
    value: 0,
    unrealized: 0,
    realized: 0,
    dividends: 0,
    totalReturn: 0,
    annualNet: 0,
    unrecordedCash: 0,
    monthly: months.map(() => 0),
    // 每月預估裡「推估」的部分（其餘是已公告或本月已除息）：圖表分實色／斜線用
    monthlyEstimated: months.map(() => 0),
    // 過去 24 個月（不含本月）的實際應收：依買賣紀錄算當時持股 × 實際配息（扣款後），和應收股利同一份計算
    // （2026-11-10 使用者要求：圖表能看過去、自己選區間，拿來對照預估準不準）
    pastActual: pastMonths.map(() => 0),
    // 有持股但報價取不到：市值相關的合計不完整
    missingQuote: 0,
    // 報酬拆解（v20 階段 8）：和 totalReturn 同樣只算有報價的
    breakdown: { price: 0, dividends: 0, fees: 0, tax: 0, sellCost: 0 },
  }
}

// 報酬拆解（v20 階段 8）：總報酬 ＝ 價差 ＋ 股利 − 手續費 − 稅 − 現在賣出還要付的成本。
// computePosition 的已實現、未實現都已經扣掉費用，所以價差（未扣費用）＝ 已實現 ＋ 未實現 ＋ 已付手續費 ＋ 已付稅 ＋ 預估賣出成本；
// 五塊加起來剛好等於 totalReturn。費用類回傳正數（畫面顯示成減項）。報價取不到（未實現算不出來）時是 null
function breakdownOf(position) {
  if (!position || position.unrealized === null || position.unrealized === undefined) return null
  const fees = position.feesPaid ?? 0
  const tax = position.taxPaid ?? 0
  const sellCost = position.sellCost ?? 0
  return {
    price: round2((position.realized ?? 0) + position.unrealized + fees + tax + sellCost),
    dividends: round2(position.dividends ?? 0),
    fees: round2(fees),
    tax: round2(tax),
    sellCost: round2(sellCost),
  }
}

// 「獲利與股利」頁的整份資料。items 是 routes/market.js 的 watchJSON（含 position、summary）；
// histories、notices 與 items 同順序／以代號查；usdTwd 取不到時美股不併入台幣合計
// barsList：每檔的日 K（填息追蹤用，與 items 同順序；沒有就不算）
// industries：台股代號 → { code, label }（集中度用）；concentration：集中度門檻（使用者設定）
function buildIncomeReport({ items, histories = [], barsList = [], notices = null, settings: rawSettings, usdTwd = null, industries = new Map(), concentration = null, today }) {
  const settings = normalizeIncomeSettings(rawSettings)
  const months = nextMonths(today)
  // 過去 24 個月（不含本月；本月在 months 裡，含本月已除息的）
  const pastMonths = nextMonths(shiftYear(months[0], -2), 24)
  const totals = { tw: emptyTotals(months, pastMonths), us: emptyTotals(months, pastMonths) }
  // 合計的年化報酬：同一個市場所有持股的現金流放在一起算；有一檔算不出來就整個不算（只算其中幾檔會有偏差），記下幾檔
  const marketFlows = { tw: [], us: [] }
  const flowBlocked = { tw: 0, us: 0 }

  const rows = items.map((item, index) => {
    const { target, position } = item
    const unit = unitOfMarket(target.market)
    const isStock = target.kind === 'stock'
    const history = histories[index] ?? null
    const announced = isStock && target.market === 'tw' && notices ? notices.get(target.code) ?? [] : []
    const shares = position ? position.quantity * unit : 0
    const price = item.summary?.quote?.price ?? null

    const dividendStatus = !isStock ? 'notStock' : history ? 'ok' : announced.length ? 'noticeOnly' : 'failed'
    const entitlement = isStock
      ? computeEntitlements({ target, trades: item.trades, dividends: item.dividends, dismissed: item.dismissedEntitlements ?? [], history, settings, today, unit })
      : null
    const projection =
      isStock && (history || announced.length)
        ? projectDividends({ target, history, announced, shares, settings, today, unit })
        : null

    if (position) {
      const side = totals[target.market]
      side.count += 1
      side.cost += position.costBasis ?? 0
      side.realized += position.realized ?? 0
      side.dividends += position.dividends ?? 0
      if (position.marketValue === null) {
        if (shares > 0) side.missingQuote += 1
      } else {
        side.value += position.marketValue
        side.unrealized += position.unrealized ?? 0
        side.totalReturn += position.totalReturn ?? 0
        const parts = breakdownOf(position)
        if (parts) for (const key of Object.keys(side.breakdown)) side.breakdown[key] += parts[key]
      }
      if (projection) {
        side.annualNet += projection.annualNet ?? 0
        projection.months.forEach((m, i) => {
          side.monthly[i] += m.cash?.net ?? 0
          if (m.cash?.source === 'estimated') side.monthlyEstimated[i] += m.cash.net ?? 0
        })
      }
      if (entitlement?.available) {
        side.unrecordedCash += entitlement.unrecordedCash ?? 0
        for (const event of entitlement.events) {
          if (event.type !== 'cash') continue
          const index = pastMonths.indexOf(event.exDate.slice(0, 7))
          if (index >= 0) side.pastActual[index] += event.net ?? 0
        }
      }
    }

    let annualized = null
    if (position) {
      const { flows, reason } = cashFlowsOf(item, today)
      if (flows) {
        annualized = annualizedOf(flows, today)
        marketFlows[target.market].push(...flows)
      } else {
        annualized = { pct: null, reason }
        if (reason !== 'noTrades') flowBlocked[target.market] += 1
      }
    }

    return {
      id: item.id,
      target,
      groups: item.groups,
      price,
      quantity: position?.quantity ?? 0,
      position,
      // 頁內編輯持股（沿用自訂追蹤的 MarketHoldings）要用原始紀錄
      trades: item.trades ?? [],
      dividends: item.dividends ?? [],
      // 刪掉的應收股利：前端再刪一筆時要用這份當基底（PATCH 是整批替換，少了它會把之前刪的蓋掉）
      dismissedEntitlements: item.dismissedEntitlements ?? [],
      // 股利月曆往前看（近 2 年的實際除息；2026-11-10 使用者要求月曆能看過去）
      pastEvents: isStock ? pastEventsOf(history, today) : [],
      // 填息追蹤（近 2 年每次除息後幾天填息、這次還差多少）；沒有日 K 或股利資料時是 null
      fills: isStock ? computeFills({ history, bars: barsList[index] ?? null, today }) : null,
      dividendStatus,
      entitlement,
      projection,
      // 殖利率（未扣款）：成本殖利率 = 預估一年股利 ÷ 投入成本；現價殖利率 = 每股一年股利 ÷ 現價
      yieldOnCost: projection && position ? pct(projection.annualGross, position.costBasis) : null,
      currentYield: projection && price ? pct(projection.annualPerShare, price) : null,
      // 多年平均股利（存股試算的殖利率基準）；股利紀錄不夠 12 個月是 null
      dividendAverage: isStock ? dividendAverageOf(history, price, today) : null,
      // 年化報酬（XIRR，%）；算不出來時 pct 是 null、reason 寫原因
      annualized,
      // 報酬拆解（價差、股利、手續費、稅、預估賣出成本）
      breakdown: breakdownOf(position),
    }
  })

  for (const side of Object.values(totals)) {
    for (const key of ['cost', 'value', 'unrealized', 'realized', 'dividends', 'totalReturn', 'annualNet', 'unrecordedCash']) {
      side[key] = round2(side[key])
    }
    side.monthly = side.monthly.map(round2)
    side.monthlyEstimated = side.monthlyEstimated.map(round2)
    side.pastActual = side.pastActual.map(round2)
    side.unrealizedPct = pct(side.unrealized, side.cost)
    for (const key of Object.keys(side.breakdown)) side.breakdown[key] = round2(side.breakdown[key])
  }
  const totalAnnualized = (flows, blocked) =>
    blocked ? { pct: null, reason: 'partial', blocked } : flows.length ? annualizedOf(flows, today) : { pct: null, reason: 'noTrades' }
  totals.tw.annualized = totalAnnualized(marketFlows.tw, flowBlocked.tw)
  totals.us.annualized = totalAnnualized(marketFlows.us, flowBlocked.us)

  // 合併成台幣：美股用今天的匯率；取不到匯率時只放台股（twd.usIncluded = false）
  const fx = Number.isFinite(usdTwd) && usdTwd > 0 ? usdTwd : null
  const usFactor = fx ?? 0
  const combine = (key) => round2(totals.tw[key] + totals.us[key] * usFactor)
  const twd = {
    usIncluded: fx !== null || totals.us.count === 0,
    cost: combine('cost'),
    value: combine('value'),
    unrealized: combine('unrealized'),
    realized: combine('realized'),
    dividends: combine('dividends'),
    totalReturn: combine('totalReturn'),
    annualNet: combine('annualNet'),
    monthly: months.map((_, i) => round2(totals.tw.monthly[i] + totals.us.monthly[i] * usFactor)),
    monthlyEstimated: months.map((_, i) => round2(totals.tw.monthlyEstimated[i] + totals.us.monthlyEstimated[i] * usFactor)),
    pastActual: pastMonths.map((_, i) => round2(totals.tw.pastActual[i] + totals.us.pastActual[i] * usFactor)),
    breakdown: Object.fromEntries(
      Object.keys(totals.tw.breakdown).map((key) => [key, round2(totals.tw.breakdown[key] + totals.us.breakdown[key] * usFactor)]),
    ),
  }
  twd.unrealizedPct = pct(twd.unrealized, twd.cost)
  // 台幣合計的年化：美股的現金流都用今天的匯率換算（不回頭查每一天的匯率，匯率變動造成的損益不算）
  twd.annualized =
    marketFlows.us.length && fx === null
      ? { pct: null, reason: 'noFx' }
      : totalAnnualized([...marketFlows.tw, ...marketFlows.us.map((f) => ({ ...f, amount: f.amount * (fx ?? 0) }))], flowBlocked.tw + flowBlocked.us)

  return {
    today,
    months,
    pastMonths,
    settings,
    usdTwd: fx,
    items: rows,
    totals: { ...totals, twd },
    concentration: concentrationOf({ rows, usdTwd: fx, industries, thresholds: concentration }),
  }
}

module.exports = {
  DEFAULT_INCOME_SETTINGS,
  STOCK_DIVIDEND_MAX_RATIO,
  normalizeIncomeSettings,
  parseYahooEvents,
  actualPerShare,
  deductionsOf,
  sharesBefore,
  computeEntitlements,
  projectDividends,
  buildIncomeReport,
  xirr,
  computeFills,
  dividendAverageOf,
  buildDividendRecords,
  concentrationOf,
  normalizeConcentration,
  DEFAULT_CONCENTRATION,
  nextMonths,
  frequencyOf,
}
