// 技術指標的判讀標籤與支撐壓力價位。純函式。
// 標籤文字在這裡產生（前端只負責顯示與上色），AI 也拿同一份判讀，畫面和解讀講的才會一致。
//
// tone：bull 偏多、bear 偏空、warn 需要留意（過熱、超賣、柱體收斂）、neutral 中性

// 價位太接近時併成一區（例如 MA60 和成交密集區幾乎同價）：差距在 0.3% 或 0.25 倍 ATR 內（取大的）視為同一區
const LEVEL_MERGE_RATIO = 0.003
const LEVEL_MERGE_ATR = 0.25
const MAX_LEVELS = 3
// 最近的三個裡沒有「比較守得住」的價位時，往外找到離現價這麼多倍 ATR，有的話換掉最遠的那一個
const STRONG_REACH_ATR = 5
const STRENGTH_RANK = { weak: 0, normal: 1, strong: 2 }
// 強弱的說明（畫面與 AI 共用）。依據是 55 檔、5 年日 K 的實測，見 doc/v22-market-rules-research-plan.md
const STRENGTH_NOTES = {
  strong: '過去比較守得住',
  weak: '跌到近期低點時，常直接跌破',
}

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

// 候選價位（規則版本 4）。kind：ma 均線、extreme 近 N 日高低、volume 成交密集區、gap 未回補缺口、swing 前波高低點。
// 不放 MA5：離現價通常不到一天的波動，實測當支撐和隨機價位沒有差別
function levelCandidates(price, ind) {
  const list = [
    { price: ind.ma20, label: 'MA20', kind: 'ma' },
    { price: ind.ma60, label: 'MA60', kind: 'ma' },
    { price: ind.ma120, label: '半年線（MA120）', kind: 'ma' },
    { price: ind.ma240, label: '年線（MA240）', kind: 'ma' },
    { price: ind.high20, label: '近 20 日高點', kind: 'extreme' },
    { price: ind.low20, label: '近 20 日低點', kind: 'extreme' },
    { price: ind.high60, label: '近 60 日高點', kind: 'extreme' },
    { price: ind.low60, label: '近 60 日低點', kind: 'extreme' },
  ]
  const sources = ind.levels
  if (sources) {
    for (const node of sources.volumeNodes ?? []) list.push({ price: node.price, label: '成交密集區', kind: 'volume' })
    for (const gap of sources.gaps ?? []) list.push({ price: gap.price, label: '未回補的缺口', kind: 'gap' })
    // 前波高低點每一種只留離現價最近的一個，不然清單全是轉折點
    const nearest = (values, below) => {
      const side = values.filter((value) => (below ? value < price : value > price))
      return side.length ? side.reduce((best, value) => (Math.abs(value - price) < Math.abs(best - price) ? value : best)) : null
    }
    list.push(
      { price: nearest(sources.swingLows ?? [], true), label: '前波低點', kind: 'swing' },
      { price: nearest(sources.swingHighs ?? [], true), label: '已突破的前波高點', kind: 'swing' },
      { price: nearest(sources.swingHighs ?? [], false), label: '前波高點', kind: 'swing' },
      { price: nearest(sources.swingLows ?? [], false), label: '已跌破的前波低點', kind: 'swing' },
    )
  }
  return list.filter((level) => level.price !== null && level.price !== undefined && level.price !== price)
}

// 強弱只分支撐：成交密集區、未回補缺口比較守得住；近 N 日低點比隨機還容易跌破。
// 壓力沒有任何一種明顯比隨機好（上漲時碰到壓力比較常直接過去），全部當一般
function strengthOf(kind, side) {
  if (side !== 'support') return 'normal'
  if (kind === 'volume' || kind === 'gap') return 'strong'
  if (kind === 'extreme') return 'weak'
  return 'normal'
}

// 支撐：現價以下最近的幾個參考價；壓力：現價以上最近的幾個。
// 每個價位：{ price, label, strength: 'strong' | 'normal' | 'weak', note }（note 是強弱的白話說明，一般的為 null）
function keyLevels(price, ind) {
  const candidates = levelCandidates(price, ind)
  const atr = ind.atr14 ?? null
  const mergeGap = Math.max(price * LEVEL_MERGE_RATIO, atr ? atr * LEVEL_MERGE_ATR : 0)

  const pick = (levels, side) => {
    const zones = []
    for (const level of levels) {
      const strength = strengthOf(level.kind, side)
      const near = zones.find((zone) => Math.abs(zone.anchor - level.price) <= mergeGap)
      if (near) {
        if (!near.labels.includes(level.label)) near.labels.push(level.label)
        // 一區裡有比較守得住的成員，整區就算比較守得住，價位也用那個成員的
        if (STRENGTH_RANK[strength] > STRENGTH_RANK[near.strength]) {
          near.strength = strength
          near.price = level.price
        }
      } else {
        zones.push({ anchor: level.price, price: level.price, labels: [level.label], strength })
      }
    }
    let chosen = zones.slice(0, MAX_LEVELS)
    if (chosen.length === MAX_LEVELS && !chosen.some((zone) => zone.strength === 'strong') && atr) {
      const strong = zones.slice(MAX_LEVELS).find((zone) => zone.strength === 'strong' && Math.abs(zone.price - price) <= atr * STRONG_REACH_ATR)
      if (strong) chosen = [...chosen.slice(0, MAX_LEVELS - 1), strong]
    }
    return chosen
      .sort((a, b) => Math.abs(a.price - price) - Math.abs(b.price - price))
      .map((zone) => ({ price: zone.price, label: zone.labels.join('、'), strength: zone.strength, note: STRENGTH_NOTES[zone.strength] ?? null }))
  }

  return {
    supports: pick(candidates.filter((level) => level.price < price).sort((a, b) => b.price - a.price), 'support'),
    resistances: pick(candidates.filter((level) => level.price > price).sort((a, b) => a.price - b.price), 'resistance'),
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
