// 技術指標。全部是純函式，輸入依時間由舊到新排列的數列，回傳最後一天的值；資料不足時回傳 null。

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null
  }
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function sma(values, period) {
  if (values.length < period) {
    return null
  }
  const slice = values.slice(-period)
  return slice.reduce((sum, value) => sum + value, 0) / period
}

// 整條 EMA 序列，前 period-1 天為 null，第 period 天用 SMA 起算
function emaSeries(values, period) {
  const result = new Array(values.length).fill(null)
  if (values.length < period) {
    return result
  }
  const k = 2 / (period + 1)
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period
  result[period - 1] = ema
  for (let i = period; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k)
    result[i] = ema
  }
  return result
}

// RSI（Wilder 平滑）
function rsi(closes, period = 14) {
  if (closes.length <= period) {
    return null
  }
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gain += diff
    else loss -= diff
  }
  gain /= period
  loss /= period
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1]
    gain = (gain * (period - 1) + Math.max(diff, 0)) / period
    loss = (loss * (period - 1) + Math.max(-diff, 0)) / period
  }
  if (loss === 0) {
    return 100
  }
  return 100 - 100 / (1 + gain / loss)
}

// KD（台灣常用的 9,3,3）：K、D 由 50 起算
function kd(highs, lows, closes, period = 9) {
  if (closes.length < period) {
    return null
  }
  let k = 50
  let d = 50
  let prevK = null
  let prevD = null
  for (let i = period - 1; i < closes.length; i += 1) {
    const high = Math.max(...highs.slice(i - period + 1, i + 1))
    const low = Math.min(...lows.slice(i - period + 1, i + 1))
    const rsv = high === low ? 50 : ((closes[i] - low) / (high - low)) * 100
    prevK = k
    prevD = d
    k = (2 / 3) * k + rsv / 3
    d = (2 / 3) * d + k / 3
  }
  return { k, d, prevK, prevD }
}

// MACD（12, 26, 9）。hist 是 DIF − 訊號線，附上前一天的值方便判斷柱體擴大或收斂
function macd(closes) {
  const fast = emaSeries(closes, 12)
  const slow = emaSeries(closes, 26)
  const dif = closes.map((_, i) => (fast[i] !== null && slow[i] !== null ? fast[i] - slow[i] : null))
  const validDif = dif.filter((value) => value !== null)
  if (validDif.length < 9 + 1) {
    return null
  }
  const signal = emaSeries(validDif, 9)
  const last = validDif.length - 1
  const hist = validDif[last] - signal[last]
  const prevHist = validDif[last - 1] - signal[last - 1]
  return { dif: validDif[last], signal: signal[last], hist, prevHist }
}

// 近 n 日漲跌幅（%）：最後一天相對 n 個交易日前的收盤
function changeOver(closes, days) {
  if (closes.length <= days) {
    return null
  }
  const base = closes[closes.length - 1 - days]
  return base ? (closes[closes.length - 1] / base - 1) * 100 : null
}

function highLow(highs, lows, days) {
  if (highs.length < days) {
    return null
  }
  return { high: Math.max(...highs.slice(-days)), low: Math.min(...lows.slice(-days)) }
}

// 最後一天的成交量相對前 20 日均量的倍數
function volumeRatio(volumes, period = 20) {
  const valid = volumes.filter((value) => Number.isFinite(value) && value > 0)
  if (valid.length < period + 1) {
    return null
  }
  const last = valid[valid.length - 1]
  const avg = valid.slice(-period - 1, -1).reduce((sum, value) => sum + value, 0) / period
  return avg ? last / avg : null
}

// bars：[{ open, high, low, close, volume }]，由舊到新
function computeIndicators(bars) {
  const closes = bars.map((bar) => bar.close)
  const highs = bars.map((bar) => bar.high)
  const lows = bars.map((bar) => bar.low)
  const volumes = bars.map((bar) => bar.volume)

  const kdValue = kd(highs, lows, closes)
  const macdValue = macd(closes)
  const range20 = highLow(highs, lows, 20)
  const range60 = highLow(highs, lows, 60)

  return {
    ma5: round(sma(closes, 5)),
    ma20: round(sma(closes, 20)),
    ma60: round(sma(closes, 60)),
    rsi14: round(rsi(closes, 14), 1),
    k: kdValue ? round(kdValue.k, 1) : null,
    d: kdValue ? round(kdValue.d, 1) : null,
    prevK: kdValue ? round(kdValue.prevK, 1) : null,
    prevD: kdValue ? round(kdValue.prevD, 1) : null,
    macdDif: macdValue ? round(macdValue.dif) : null,
    macdSignal: macdValue ? round(macdValue.signal) : null,
    macdHist: macdValue ? round(macdValue.hist) : null,
    macdPrevHist: macdValue ? round(macdValue.prevHist) : null,
    change5d: round(changeOver(closes, 5)),
    change20d: round(changeOver(closes, 20)),
    change60d: round(changeOver(closes, 60)),
    high20: range20 ? round(range20.high) : null,
    low20: range20 ? round(range20.low) : null,
    high60: range60 ? round(range60.high) : null,
    low60: range60 ? round(range60.low) : null,
    volumeRatio: round(volumeRatio(volumes), 2),
  }
}

module.exports = {
  round,
  sma,
  emaSeries,
  rsi,
  kd,
  macd,
  changeOver,
  highLow,
  volumeRatio,
  computeIndicators,
}
