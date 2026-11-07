// 櫃買指數的走勢（大盤概況重點卡點開）：Yahoo 沒有櫃買指數，改用櫃買中心「櫃買指數(月查詢)」，一次一個月的每日開高低收。
// 櫃買中心沒有盤中分時資料，所以只有日線的範圍（1 個月～1 年）；今天盤中的數字用和卡片同一份 MIS 即時報價補上
const MONTH_URL = 'https://www.tpex.org.tw/www/zh-tw/indexInfo/inx'

// 走勢彈窗代號：櫃買指數在 Yahoo 沒有代號，用這個自訂的（只在 /index-chart 用）
const CHART_SYMBOL = 'TPEX'
const RANGES = ['1mo', '6mo', 'ytd', '1y']
const DEFAULT_RANGE = '1mo'

const monthUrl = (year, month) => `${MONTH_URL}?date=${year}/${String(month).padStart(2, '0')}/01&response=json`

const num = (value) => {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return value === '' || value === null || value === undefined || !Number.isFinite(n) ? null : n
}

// 2026/11/06, 開, 高, 低, 收, 漲跌 → { date: '2026-11-06', open, high, low, close }
function parseMonth(payload) {
  const rows = payload?.tables?.[0]?.data || []
  return rows
    .map(([date, open, high, low, close]) => ({
      date: /^\d{4}\/\d{2}\/\d{2}$/.test(date || '') ? date.replaceAll('/', '-') : null,
      open: num(open),
      high: num(high),
      low: num(low),
      close: num(close),
    }))
    .filter((bar) => bar.date && bar.close !== null)
}

// 含今天這個月往回共 count 個月：[{ year, month }]，最舊的在前
function recentMonths(today, count) {
  const [year, month] = today.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const offset = month - 1 - (count - 1 - i)
    return { year: year + Math.floor(offset / 12), month: (((offset % 12) + 12) % 12) + 1 }
  })
}

// 範圍起點（含）：1 個月、6 個月、今年以來、1 年
function rangeStart(today, range) {
  const [year, month, day] = today.split('-').map(Number)
  if (range === 'ytd') return `${year}-01-01`
  const back = { '1mo': 1, '6mo': 6, '1y': 12 }[range]
  const date = new Date(Date.UTC(year, month - 1 - back, day))
  return date.toISOString().slice(0, 10)
}

const round = (value) => (value === null || value === undefined ? null : Math.round(value * 100) / 100)

// bars：近 13 個月的日線（舊到新）；realtime：MIS 即時報價，比日線新（盤中、櫃買中心還沒公布）才接在最後。
// 同一天以櫃買中心的正式收盤為準：MIS 的指數停在收盤集合競價前（2026-11-06 MIS 13:19 是 303.78，正式收盤 304.02）
function buildChart(bars, realtime, range, today) {
  const series = bars.slice()
  if (realtime?.date && realtime.price !== null) {
    const last = series[series.length - 1]
    const todayBar = { date: realtime.date, open: realtime.open, high: realtime.high, low: realtime.low, close: realtime.price }
    if (!last || realtime.date > last.date) series.push(todayBar)
  }
  if (series.length === 0) return null

  const latest = series[series.length - 1]
  const previous = series[series.length - 2] ?? null
  const start = rangeStart(today, range)
  const inRange = series.filter((bar) => bar.date >= start)
  // 範圍的基準是起點前一天的收盤（和 Yahoo 的 chartPreviousClose 一樣）
  const before = series.filter((bar) => bar.date < start).pop()
  const baseline = before?.close ?? inRange[0]?.close ?? null
  const yearBars = series.filter((bar) => bar.date >= rangeStart(today, '1y'))
  const price = latest.close
  const prevClose = previous?.close ?? null
  const change = (from, to) => (from !== null && to !== null ? round(to - from) : null)
  const pct = (from, to) => (from ? round(((to - from) / from) * 100) : null)
  return {
    symbol: CHART_SYMBOL,
    name: '櫃買指數',
    range,
    ranges: RANGES,
    source: '櫃買中心（每日收盤）',
    currency: 'TWD',
    timezone: 'Asia/Taipei',
    // 台股 13:30 收盤
    time: realtime?.date === latest.date && latest.close === realtime.price && realtime.time ? realtime.time : `${latest.date}T05:30:00.000Z`,
    price: round(price),
    dayChange: change(prevClose, price),
    dayChangePct: pct(prevClose, price),
    baseline: round(baseline),
    rangeChange: change(baseline, price),
    rangeChangePct: pct(baseline, price),
    stats: {
      open: round(latest.open),
      high: round(latest.high),
      low: round(latest.low),
      prevClose: round(prevClose),
      high52: round(Math.max(...yearBars.map((bar) => bar.high ?? bar.close))),
      low52: round(Math.min(...yearBars.map((bar) => bar.low ?? bar.close))),
    },
    points: inRange.map((bar) => ({ t: `${bar.date}T05:30:00.000Z`, close: round(bar.close) })),
  }
}

module.exports = { CHART_SYMBOL, RANGES, DEFAULT_RANGE, monthUrl, parseMonth, recentMonths, rangeStart, buildChart }
