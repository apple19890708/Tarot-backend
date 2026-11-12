// 研究腳本共用：讀 fetchBars.js 存的日 K、算序列、各種候選價位。全部只用「當天收盤前已經知道的資料」。
const fs = require('node:fs')
const path = require('node:path')
const { computeSeries, smaSeries } = require('../../src/services/market/series')

function loadAll(dir, { includeIndex = false } = {}) {
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json') && (includeIndex || !file.startsWith('_')))
    .map((file) => {
      const symbol = file.replace('.json', '').replace('_', '^')
      const bars = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      const series = computeSeries(bars)
      series.ma10 = smaSeries(series.closes, 10)
      series.ma120 = smaSeries(series.closes, 120)
      series.ma240 = smaSeries(series.closes, 240)
      return { symbol, market: /\.TWO?$/.test(symbol) || symbol === '^TWII' ? 'tw' : 'us', bars, series }
    })
}

// 轉折點（fractal）：第 p 天的高（低）是前後各 k 天裡最高（最低）的。要等 k 天後才確認，所以第 t 天只能用 p <= t - k 的
function pivots(series, k) {
  const highs = []
  const lows = []
  const { highs: H, lows: L } = series
  for (let p = k; p < H.length - k; p += 1) {
    let isHigh = true
    let isLow = true
    for (let j = p - k; j <= p + k; j += 1) {
      if (j === p) continue
      if (H[j] >= H[p]) isHigh = false
      if (L[j] <= L[p]) isLow = false
    }
    if (isHigh) highs.push({ index: p, price: H[p] })
    if (isLow) lows.push({ index: p, price: L[p] })
  }
  return { highs, lows }
}

function rolling(values, t, n, pick) {
  if (t - n + 1 < 0) return null
  let v = values[t - n + 1]
  for (let i = t - n + 2; i <= t; i += 1) v = pick(v, values[i])
  return v
}

// 成交密集區：近 n 天每根 K 棒的量平均分到它的高低範圍，格子寬 binAtr 倍 ATR；回傳局部高峰（量由大到小）
function volumeNodes(series, t, n, atr, binAtr = 0.25) {
  const from = Math.max(0, t - n + 1)
  const step = atr * binAtr
  if (!(step > 0)) return []
  let lo = Infinity
  let hi = -Infinity
  for (let i = from; i <= t; i += 1) {
    lo = Math.min(lo, series.lows[i])
    hi = Math.max(hi, series.highs[i])
  }
  const bins = Math.min(400, Math.max(1, Math.ceil((hi - lo) / step)))
  const width = (hi - lo) / bins || step
  const hist = new Array(bins).fill(0)
  for (let i = from; i <= t; i += 1) {
    const volume = Number.isFinite(series.volumes[i]) ? series.volumes[i] : 0
    if (!volume) continue
    const a = Math.min(bins - 1, Math.floor((series.lows[i] - lo) / width))
    const b = Math.min(bins - 1, Math.floor((series.highs[i] - lo) / width))
    for (let j = a; j <= b; j += 1) hist[j] += volume / (b - a + 1)
  }
  // 平滑後找局部高峰
  const smooth = hist.map((_, j) => (hist[j - 1] ?? hist[j]) * 0.25 + hist[j] * 0.5 + (hist[j + 1] ?? hist[j]) * 0.25)
  const mean = smooth.reduce((s, v) => s + v, 0) / bins
  const nodes = []
  for (let j = 1; j < bins - 1; j += 1) {
    if (smooth[j] > smooth[j - 1] && smooth[j] >= smooth[j + 1] && smooth[j] > mean * 1.3) {
      nodes.push({ price: lo + (j + 0.5) * width, volume: smooth[j] / mean })
    }
  }
  return nodes.sort((x, y) => y.volume - x.volume)
}

// 還沒回補的跳空缺口（近 n 天）：向上跳空留下的缺口上緣是支撐、向下跳空的下緣是壓力
function gaps(series, t, n, atr) {
  const result = []
  for (let i = Math.max(1, t - n + 1); i <= t; i += 1) {
    if (series.lows[i] - series.highs[i - 1] >= atr * 0.5) {
      let filled = false
      for (let j = i + 1; j <= t; j += 1) if (series.lows[j] <= series.highs[i - 1]) filled = true
      if (!filled) result.push({ side: 'support', price: series.highs[i - 1], index: i })
    }
    if (series.lows[i - 1] - series.highs[i] >= atr * 0.5) {
      let filled = false
      for (let j = i + 1; j <= t; j += 1) if (series.highs[j] >= series.lows[i - 1]) filled = true
      if (!filled) result.push({ side: 'resistance', price: series.lows[i - 1], index: i })
    }
  }
  return result
}

function roundStep(price) {
  const mag = 10 ** Math.floor(Math.log10(price))
  return price / mag >= 5 ? mag / 2 : mag / 10 * 2.5 >= price * 0.02 ? mag / 4 : mag / 2
}

function table(rows, columns) {
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)))
  const line = (cells) => cells.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ')
  console.log(line(columns))
  for (const row of rows) console.log(line(columns.map((c) => row[c])))
}

module.exports = { loadAll, pivots, rolling, volumeNodes, gaps, roundStep, table }
