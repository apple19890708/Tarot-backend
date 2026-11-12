// 支撐壓力的價位來源（規則版本 4）：成交密集區、未回補的跳空缺口、前波高低點。純函式，輸入由舊到新的日 K。
// 為什麼是這幾種：見 doc/v22-market-rules-research-plan.md。用 55 檔、5 年日 K 實測「價格第一次碰到價位之後守不守得住」，
// 只有成交密集區和未回補缺口穩定比「同樣距離的隨機價位」好；均線、前波高低點和隨機差不多；近 N 日低點比隨機還差。
// 成交密集區：看近 120 個交易日，格子寬 0.25 倍 ATR
const PROFILE_DAYS = 120
const PROFILE_BIN_ATR = 0.25
const PROFILE_MAX_BINS = 400
// 平滑後的量要比平均高這麼多倍才算密集
const PROFILE_PEAK_RATIO = 1.3
const PROFILE_MAX_NODES = 6
// 缺口：近 120 天、缺口至少 0.5 倍 ATR、之後沒有被補上
const GAP_DAYS = 120
const GAP_MIN_ATR = 0.5
// 前波高低點：前後各 5 天裡最高（最低）的那一天，看近 250 天
const SWING_SPAN = 5
const SWING_DAYS = 250

// 每根 K 棒的成交量平均分到它的高低範圍；回傳量的局部高峰 [{ price, weight }]（weight 是相對平均的倍數，由大到小）
function volumeNodes(bars, atrValue) {
  const recent = bars.slice(-PROFILE_DAYS)
  const step = atrValue * PROFILE_BIN_ATR
  if (!(step > 0) || recent.length < 20) return []
  let lo = Infinity
  let hi = -Infinity
  for (const bar of recent) {
    lo = Math.min(lo, bar.low)
    hi = Math.max(hi, bar.high)
  }
  if (!(hi > lo)) return []
  const bins = Math.min(PROFILE_MAX_BINS, Math.max(3, Math.ceil((hi - lo) / step)))
  const width = (hi - lo) / bins
  const hist = new Array(bins).fill(0)
  for (const bar of recent) {
    const volume = Number.isFinite(bar.volume) ? bar.volume : 0
    if (volume <= 0) continue
    const from = Math.min(bins - 1, Math.floor((bar.low - lo) / width))
    // 最高價剛好落在格線上時算在下面那一格（範圍是 [最低, 最高)），否則整數價位的格子會被相鄰兩根 K 棒重複計入
    const to = Math.max(from, Math.min(bins - 1, Math.ceil((bar.high - lo) / width) - 1))
    for (let j = from; j <= to; j += 1) hist[j] += volume / (to - from + 1)
  }
  const smooth = hist.map((value, j) => (hist[j - 1] ?? value) * 0.25 + value * 0.5 + (hist[j + 1] ?? value) * 0.25)
  const mean = smooth.reduce((sum, value) => sum + value, 0) / bins
  if (!(mean > 0)) return []
  const nodes = []
  for (let j = 1; j < bins - 1; j += 1) {
    if (smooth[j] > smooth[j - 1] && smooth[j] >= smooth[j + 1] && smooth[j] > mean * PROFILE_PEAK_RATIO) {
      nodes.push({ price: lo + (j + 0.5) * width, weight: smooth[j] / mean })
    }
  }
  return nodes.sort((a, b) => b.weight - a.weight).slice(0, PROFILE_MAX_NODES)
}

// 還沒回補的跳空缺口：向上跳空留下的缺口，下緣（跳空前一天的最高）是支撐；向下跳空的上緣（前一天的最低）是壓力
function openGaps(bars, atrValue) {
  const result = []
  const start = Math.max(1, bars.length - GAP_DAYS)
  for (let i = start; i < bars.length; i += 1) {
    const prev = bars[i - 1]
    const bar = bars[i]
    if (bar.low - prev.high >= atrValue * GAP_MIN_ATR) {
      let filled = false
      for (let j = i + 1; j < bars.length && !filled; j += 1) filled = bars[j].low <= prev.high
      if (!filled) result.push({ side: 'support', price: prev.high, date: bar.date ?? null })
    } else if (prev.low - bar.high >= atrValue * GAP_MIN_ATR) {
      let filled = false
      for (let j = i + 1; j < bars.length && !filled; j += 1) filled = bars[j].high >= prev.low
      if (!filled) result.push({ side: 'resistance', price: prev.low, date: bar.date ?? null })
    }
  }
  return result
}

// 前波高低點：要等 SWING_SPAN 天後才確認，所以最近幾天的高低不會被當成轉折
function swingPoints(bars) {
  const highs = []
  const lows = []
  const start = Math.max(SWING_SPAN, bars.length - SWING_DAYS)
  for (let p = start; p < bars.length - SWING_SPAN; p += 1) {
    let isHigh = true
    let isLow = true
    for (let j = p - SWING_SPAN; j <= p + SWING_SPAN && (isHigh || isLow); j += 1) {
      if (j === p) continue
      if (bars[j].high >= bars[p].high) isHigh = false
      if (bars[j].low <= bars[p].low) isLow = false
    }
    if (isHigh) highs.push(bars[p].high)
    if (isLow) lows.push(bars[p].low)
  }
  return { highs, lows }
}

// atrValue：ATR(14)，由呼叫端（indicators.js）算好傳進來。回傳 null：ATR 算不出來（K 棒太少）
function computeLevelSources(bars, atrValue) {
  if (atrValue === null || atrValue === undefined || !(atrValue > 0)) return null
  const swings = swingPoints(bars)
  return {
    volumeNodes: volumeNodes(bars, atrValue),
    gaps: openGaps(bars, atrValue),
    swingHighs: swings.highs,
    swingLows: swings.lows,
  }
}

module.exports = { computeLevelSources, volumeNodes, openGaps, swingPoints }
