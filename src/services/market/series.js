// 每一天的技術指標序列（回測、機器學習、圖表用）。
// 演算法和 indicators.js 的「最後一天」版本相同，只是保留每一天的值；資料不足的天數為 null。
const { emaSeries } = require('./indicators')

function smaSeries(values, period) {
  const result = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) result[i] = sum / period
  }
  return result
}

// ATR（平均真實波幅，Wilder 平滑）：每天的「真實波幅」取 高−低、|高−昨收|、|低−昨收| 三者最大，
// 跳空也算進去。用來依每檔股票自己的波動決定停損寬度。高低缺值時用收盤代替
function atrSeries(highs, lows, closes, period = 14) {
  const result = new Array(closes.length).fill(null)
  if (closes.length <= period) return result
  const trueRange = (i) => {
    const high = highs[i] ?? closes[i]
    const low = lows[i] ?? closes[i]
    const prev = closes[i - 1]
    return Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev))
  }
  let atr = 0
  for (let i = 1; i <= period; i += 1) atr += trueRange(i)
  atr /= period
  result[period] = atr
  for (let i = period + 1; i < closes.length; i += 1) {
    atr = (atr * (period - 1) + trueRange(i)) / period
    result[i] = atr
  }
  return result
}

function rsiSeries(closes, period = 14) {
  const result = new Array(closes.length).fill(null)
  if (closes.length <= period) return result
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gain += diff
    else loss -= diff
  }
  gain /= period
  loss /= period
  result[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1]
    gain = (gain * (period - 1) + Math.max(diff, 0)) / period
    loss = (loss * (period - 1) + Math.max(-diff, 0)) / period
    result[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  }
  return result
}

function kdSeries(highs, lows, closes, period = 9) {
  const k = new Array(closes.length).fill(null)
  const d = new Array(closes.length).fill(null)
  let kv = 50
  let dv = 50
  for (let i = period - 1; i < closes.length; i += 1) {
    let high = -Infinity
    let low = Infinity
    for (let j = i - period + 1; j <= i; j += 1) {
      if (highs[j] > high) high = highs[j]
      if (lows[j] < low) low = lows[j]
    }
    const rsv = high === low ? 50 : ((closes[i] - low) / (high - low)) * 100
    kv = (2 / 3) * kv + rsv / 3
    dv = (2 / 3) * dv + kv / 3
    k[i] = kv
    d[i] = dv
  }
  return { k, d }
}

function macdHistSeries(closes) {
  const fast = emaSeries(closes, 12)
  const slow = emaSeries(closes, 26)
  const start = 25
  const dif = closes.map((_, i) => (i >= start ? fast[i] - slow[i] : null))
  const validDif = dif.slice(start)
  const signal = emaSeries(validDif, 9)
  return closes.map((_, i) => {
    const j = i - start
    return j >= 0 && signal[j] !== null ? dif[i] - signal[j] : null
  })
}

function rollingExtreme(values, period, pick) {
  return values.map((_, i) => (i >= period - 1 ? pick(...values.slice(i - period + 1, i + 1)) : null))
}

function volumeRatioSeries(volumes, period = 20) {
  return volumes.map((volume, i) => {
    if (i < period || !Number.isFinite(volume) || volume <= 0) return null
    let sum = 0
    for (let j = i - period; j < i; j += 1) {
      if (!Number.isFinite(volumes[j]) || volumes[j] <= 0) return null
      sum += volumes[j]
    }
    return volume / (sum / period)
  })
}

// bars：[{ date, open, high, low, close, volume }]，由舊到新
function computeSeries(bars) {
  const closes = bars.map((bar) => bar.close)
  const highs = bars.map((bar) => bar.high)
  const lows = bars.map((bar) => bar.low)
  const { k, d } = kdSeries(highs, lows, closes)
  return {
    dates: bars.map((bar) => bar.date),
    // 開高低給圖表畫 K 棒
    opens: bars.map((bar) => bar.open),
    highs,
    lows,
    closes,
    volumes: bars.map((bar) => bar.volume),
    ma5: smaSeries(closes, 5),
    ma20: smaSeries(closes, 20),
    ma60: smaSeries(closes, 60),
    rsi14: rsiSeries(closes),
    atr14: atrSeries(highs, lows, closes),
    k,
    d,
    macdHist: macdHistSeries(closes),
    volumeRatio: volumeRatioSeries(bars.map((bar) => bar.volume)),
    high20: rollingExtreme(highs, 20, Math.max),
    low20: rollingExtreme(lows, 20, Math.min),
    high60: rollingExtreme(highs, 60, Math.max),
    low60: rollingExtreme(lows, 60, Math.min),
  }
}

// 某一天的指標，格式和 computeIndicators 相同，可以直接交給 buildSignals
function pointAt(series, i) {
  const at = (name, index = i) => (index >= 0 ? series[name][index] : null)
  return {
    ma5: at('ma5'),
    ma20: at('ma20'),
    ma60: at('ma60'),
    rsi14: at('rsi14'),
    k: at('k'),
    d: at('d'),
    prevK: at('k', i - 1),
    prevD: at('d', i - 1),
    macdHist: at('macdHist'),
    macdPrevHist: at('macdHist', i - 1),
    volumeRatio: at('volumeRatio'),
    high20: at('high20'),
    low20: at('low20'),
    high60: at('high60'),
    low60: at('low60'),
  }
}

// 把日 K 合成週 K／月 K（圖表用）：開盤取第一天、收盤取最後一天、最高最低取區間極值、成交量加總，日期標最後一個交易日。
// 均線用合成後的收盤重算，所以週 K 的 ma5 是 5 週均線
function weekKey(date) {
  const [y, m, d] = date.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d)
  // 以週一為一週的開始
  const monday = new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * 86400000)
  return monday.toISOString().slice(0, 10)
}
const monthKey = (date) => date.slice(0, 7)

function aggregateSeries(series, period) {
  const keyOf = period === 'week' ? weekKey : monthKey
  const dates = []
  const opens = []
  const highs = []
  const lows = []
  const closes = []
  const volumes = []
  let lastKey = null
  for (let i = 0; i < series.dates.length; i += 1) {
    const key = keyOf(series.dates[i])
    const volume = Number.isFinite(series.volumes[i]) ? series.volumes[i] : 0
    // 舊的呼叫端（或測試）只給收盤時，開高低都用收盤
    const open = series.opens?.[i] ?? series.closes[i]
    const high = series.highs?.[i] ?? series.closes[i]
    const low = series.lows?.[i] ?? series.closes[i]
    if (key !== lastKey) {
      dates.push(series.dates[i])
      opens.push(open)
      highs.push(high)
      lows.push(low)
      closes.push(series.closes[i])
      volumes.push(volume)
      lastKey = key
    } else {
      const last = dates.length - 1
      dates[last] = series.dates[i]
      highs[last] = Math.max(highs[last], high)
      lows[last] = Math.min(lows[last], low)
      closes[last] = series.closes[i]
      volumes[last] += volume
    }
  }
  return {
    dates,
    opens,
    highs,
    lows,
    closes,
    volumes,
    ma5: smaSeries(closes, 5),
    ma20: smaSeries(closes, 20),
    ma60: smaSeries(closes, 60),
  }
}

module.exports = { smaSeries, rsiSeries, atrSeries, kdSeries, macdHistSeries, computeSeries, pointAt, aggregateSeries }
