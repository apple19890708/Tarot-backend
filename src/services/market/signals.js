// 技術指標的判讀標籤與支撐壓力價位。純函式。
// 標籤文字在這裡產生（前端只負責顯示與上色），AI 也拿同一份判讀，畫面和解讀講的才會一致。
//
// tone：bull 偏多、bear 偏空、warn 需要留意（過熱、超賣、柱體收斂）、neutral 中性

// 價位太接近時只留一個（例如 MA60 和近 60 日低點幾乎同價），差距在 0.3% 內視為同一價位
const LEVEL_MERGE_RATIO = 0.003
const MAX_LEVELS = 3

function trendSignal(ind) {
  const { ma5, ma20, ma60 } = ind
  if ([ma5, ma20, ma60].some((value) => value === null)) {
    return null
  }
  if (ma5 > ma20 && ma20 > ma60) return { key: 'trend', label: '均線排列', value: '多頭排列', tone: 'bull' }
  if (ma5 < ma20 && ma20 < ma60) return { key: 'trend', label: '均線排列', value: '空頭排列', tone: 'bear' }
  return { key: 'trend', label: '均線排列', value: '均線糾結', tone: 'neutral' }
}

function maSignal(key, label, price, ma) {
  if (ma === null) {
    return null
  }
  return price >= ma
    ? { key, label, value: '站上', tone: 'bull' }
    : { key, label, value: '跌破', tone: 'bear' }
}

function rsiSignal(rsi) {
  if (rsi === null) return null
  if (rsi >= 70) return { key: 'rsi', label: 'RSI(14)', value: '過熱', tone: 'warn' }
  if (rsi <= 30) return { key: 'rsi', label: 'RSI(14)', value: '超賣', tone: 'warn' }
  if (rsi >= 50) return { key: 'rsi', label: 'RSI(14)', value: '偏強', tone: 'bull' }
  return { key: 'rsi', label: 'RSI(14)', value: '偏弱', tone: 'bear' }
}

function kdSignal({ k, d, prevK, prevD }) {
  if (k === null || d === null) {
    return null
  }
  const zone = k >= 80 ? '（高檔）' : k <= 20 ? '（低檔）' : ''
  if (prevK !== null && prevD !== null && prevK <= prevD && k > d) {
    return { key: 'kd', label: 'KD', value: `黃金交叉${zone}`, tone: 'bull' }
  }
  if (prevK !== null && prevD !== null && prevK >= prevD && k < d) {
    return { key: 'kd', label: 'KD', value: `死亡交叉${zone}`, tone: 'bear' }
  }
  return k > d
    ? { key: 'kd', label: 'KD', value: `K 在 D 之上${zone}`, tone: 'bull' }
    : { key: 'kd', label: 'KD', value: `K 在 D 之下${zone}`, tone: 'bear' }
}

// 台灣習慣把 MACD 柱體正值叫紅柱、負值叫綠柱
function macdSignal({ macdHist: hist, macdPrevHist: prev }) {
  if (hist === null || prev === null) {
    return null
  }
  if (hist >= 0) {
    return hist >= prev
      ? { key: 'macd', label: 'MACD', value: '紅柱擴大', tone: 'bull' }
      : { key: 'macd', label: 'MACD', value: '紅柱收斂', tone: 'warn' }
  }
  return hist <= prev
    ? { key: 'macd', label: 'MACD', value: '綠柱擴大', tone: 'bear' }
    : { key: 'macd', label: 'MACD', value: '綠柱收斂', tone: 'warn' }
}

function volumeSignal(ratio, intraday) {
  if (ratio === null) {
    return null
  }
  const suffix = intraday ? '（盤中）' : ''
  if (ratio >= 1.5) return { key: 'volume', label: '量能', value: `放量${suffix}`, tone: 'warn' }
  if (ratio <= 0.7) return { key: 'volume', label: '量能', value: `量縮${suffix}`, tone: 'neutral' }
  return { key: 'volume', label: '量能', value: `量能持平${suffix}`, tone: 'neutral' }
}

// 支撐：現價以下最近的幾個參考價；壓力：現價以上最近的幾個
function keyLevels(price, ind) {
  const candidates = [
    { price: ind.ma5, label: 'MA5' },
    { price: ind.ma20, label: 'MA20' },
    { price: ind.ma60, label: 'MA60' },
    { price: ind.high20, label: '近 20 日高點' },
    { price: ind.low20, label: '近 20 日低點' },
    { price: ind.high60, label: '近 60 日高點' },
    { price: ind.low60, label: '近 60 日低點' },
  ].filter((level) => level.price !== null && level.price !== price)

  const pick = (levels) => {
    const result = []
    for (const level of levels) {
      const near = result.find((kept) => Math.abs(kept.price - level.price) / level.price <= LEVEL_MERGE_RATIO)
      if (near) {
        near.label = `${near.label}、${level.label}`
      } else if (result.length < MAX_LEVELS) {
        result.push({ ...level })
      }
    }
    return result
  }

  return {
    supports: pick(candidates.filter((level) => level.price < price).sort((a, b) => b.price - a.price)),
    resistances: pick(candidates.filter((level) => level.price > price).sort((a, b) => a.price - b.price)),
  }
}

// 回傳 null：沒有技術指標（歷史資料不足）
function buildSignals({ price, indicators, intraday = false }) {
  if (!indicators) {
    return null
  }
  const signals = [
    trendSignal(indicators),
    maSignal('ma20', '月線（MA20）', price, indicators.ma20),
    maSignal('ma60', '季線（MA60）', price, indicators.ma60),
    rsiSignal(indicators.rsi14),
    kdSignal(indicators),
    macdSignal(indicators),
    volumeSignal(indicators.volumeRatio, intraday),
  ].filter(Boolean)

  return { signals, ...keyLevels(price, indicators) }
}

module.exports = { buildSignals, keyLevels }
