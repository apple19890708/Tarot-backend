const test = require('node:test')
const assert = require('node:assert/strict')

const { computeSeries } = require('../src/services/market/series')
const { buildLongTermAdvice, MIN_BARS } = require('../src/services/market/longTermAdvice')

// 每天收盤照 f(i) 走，日期從 2024-01-01 起連續編（不管週末，測試只看順序）
function seriesOf(count, f) {
  const start = Date.UTC(2024, 0, 1)
  const bars = Array.from({ length: count }, (_, i) => {
    const close = f(i)
    return { date: new Date(start + i * 86400000).toISOString().slice(0, 10), open: close, high: close, low: close, close, volume: 1000 }
  })
  return computeSeries(bars)
}

const rising = seriesOf(300, (i) => 100 + i * 0.5)
const falling = seriesOf(300, (i) => 250 - i * 0.5)
const strategiesWith = (annualReturn) => ({ years: 5, strategies: [{ key: 'buyHold', annualReturn }] })

test('長期建議：歷史不到年線加方向需要的 K 棒數就不給', () => {
  assert.equal(buildLongTermAdvice({ series: seriesOf(MIN_BARS - 1, () => 100), price: 100 }), null)
})

test('長期建議：站上往上的年線、半年線在上、長期報酬好 → 適合長期持有，關鍵價位是年線', () => {
  const price = rising.closes.at(-1)
  const advice = buildLongTermAdvice({ series: rising, price, strategies: strategiesWith(12) })
  assert.equal(advice.stance, 'bullish')
  assert.equal(advice.stanceLabel, '適合長期持有')
  assert.equal(advice.horizon, '半年以上')
  // 年線 = 最後 240 天平均：(100+60*0.5 … 100+299*0.5) 的平均
  assert.equal(advice.keyLevel.price, 189.75)
  assert.deepEqual(
    advice.evidence.filter((e) => e.counted).map((e) => [e.label, e.direction]),
    [
      ['股價站在年線之上', 1],
      ['年線往上', 1],
      ['半年線在年線之上', 1],
      ['過去約 5 年一直抱著，平均每年 +12%', 1],
    ],
  )
  assert.ok(advice.forHolders.includes('189.75（年線）'))
})

test('長期建議：年線三項合計最多 2 分，光靠趨勢剛好到「適合」的門檻，一項反向就不夠', () => {
  const price = rising.closes.at(-1)
  const trendOnly = buildLongTermAdvice({ series: rising, price })
  assert.equal(trendOnly.score, 2)
  assert.equal(trendOnly.stance, 'bullish')
  // 舊版趨勢一共 4 分，估值偏貴（−1）壓不過；現在會變成中性
  const expensive = buildLongTermAdvice({ series: rising, price, valuation: { pe: 60, pePercentile: 95, dividendYield: 1, yieldPercentile: 10 } })
  assert.equal(expensive.stance, 'neutral')
})

test('長期建議：跌破往下的年線、估值偏貴、營收衰退 → 不適合長期持有', () => {
  const price = falling.closes.at(-1)
  const advice = buildLongTermAdvice({
    series: falling,
    price,
    strategies: strategiesWith(-5),
    valuation: { pe: 40, pePercentile: 92, dividendYield: 1, yieldPercentile: 10 },
    revenue: { month: '2026-10', cumYoy: -15 },
  })
  assert.equal(advice.stance, 'bearish')
  const labels = advice.evidence.map((e) => e.label)
  assert.ok(labels.includes('股價跌破年線'))
  assert.ok(labels.includes('年線往下'))
  assert.ok(labels.includes('本益比 40 倍，偏貴'))
  assert.ok(labels.includes('今年營收衰退'))
  assert.ok(advice.forNew.includes('不適合長期持有'))
})

test('長期建議：近一年和大盤比，差 10 個百分點以上才列入', () => {
  const price = rising.closes.at(-1)
  // 個股近 250 天從 125 漲到 249.5（+99.6%）；大盤同期 +20% → 贏大盤
  const flatIndex = { label: '大盤', series: seriesOf(300, (i) => (i < 49 ? 1000 : 1000 + (i - 49) * 0.8)) }
  const advice = buildLongTermAdvice({ series: rising, price, context: flatIndex })
  const relative = advice.evidence.find((e) => e.group === '和大盤比')
  assert.equal(relative.label, '近一年贏過大盤')
  assert.equal(relative.counted, true)

  // 大盤同期漲得一樣多 → 差不多、不列入
  const sameIndex = { label: '大盤', series: rising }
  const same = buildLongTermAdvice({ series: rising, price, context: sameIndex }).evidence.find((e) => e.group === '和大盤比')
  assert.equal(same.label, '近一年和大盤差不多')
  assert.equal(same.counted, false)
})

test('長期建議：高殖利率或本益比偏低算偏多；沒有估值與營收時風險提醒說明', () => {
  const price = rising.closes.at(-1)
  const cheap = buildLongTermAdvice({ series: rising, price, valuation: { pe: 8, pePercentile: 10, dividendYield: 6, yieldPercentile: 90 } })
  assert.equal(cheap.evidence.find((e) => e.group === '估值').label, '本益比 8 倍，偏便宜')
  const yieldOnly = buildLongTermAdvice({ series: rising, price, valuation: { pe: 15, pePercentile: 50, dividendYield: 6, yieldPercentile: 90 } })
  assert.equal(yieldOnly.evidence.find((e) => e.group === '估值').label, '殖利率 6%，屬於高殖利率')
  const etf = buildLongTermAdvice({ series: rising, price })
  assert.ok(etf.risks[0].includes('沒有估值與營收資料'))
})
