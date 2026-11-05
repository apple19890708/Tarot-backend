const test = require('node:test')
const assert = require('node:assert/strict')

const { computeIndicators } = require('../src/services/market/indicators')
const { computeSeries, pointAt } = require('../src/services/market/series')
const { backtestSignals, backtestStrategies, stats } = require('../src/services/market/backtest')
const { predictDirection } = require('../src/services/market/prediction')

// 固定種子的亂數，測試每次結果一樣
function seeded(seed) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

function randomWalk(length, seed = 7) {
  const rand = seeded(seed)
  let price = 100
  return Array.from({ length }, (_, i) => {
    price *= 1 + (rand() - 0.5) * 0.04
    const date = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10)
    return { date, open: price, high: price * 1.01, low: price * 0.99, close: price, volume: 1000 + rand() * 1000 }
  })
}

function linearBars(length, from = 100, to = 200) {
  return Array.from({ length }, (_, i) => {
    const close = from + ((to - from) * i) / (length - 1)
    return { date: `d${i}`, open: close, high: close, low: close, close, volume: 1000 }
  })
}

test('序列：最後一天的值和 computeIndicators 一致', () => {
  const bars = randomWalk(300)
  const fromSeries = pointAt(computeSeries(bars), bars.length - 1)
  const direct = computeIndicators(bars)
  // computeIndicators 的 RSI／KD 四捨五入到小數一位，容差 0.06
  for (const key of ['ma5', 'ma20', 'ma60', 'rsi14', 'k', 'd', 'macdHist', 'high20', 'low60']) {
    assert.ok(Math.abs(fromSeries[key] - direct[key]) < 0.06, `${key}: ${fromSeries[key]} vs ${direct[key]}`)
  }
})

test('回測：統計值（勝率、平均、中位數、最差、最好）', () => {
  assert.deepEqual(stats([2, -1, 3, -4]), { count: 4, winRate: 50, avgReturn: 0, medianReturn: 0.5, worst: -4, best: 3 })
  assert.equal(stats([]).winRate, null)
})

test('回測：一路上漲時基準勝率 100%，訊號只算首次出現', () => {
  const series = computeSeries(linearBars(300))
  const result = backtestSignals(series, [{ key: 'trend', label: '均線排列', value: '多頭排列', tone: 'bull' }])
  assert.ok(result.baseline.every((b) => b.winRate === 100))
  // 多頭排列從頭到尾都成立，只在一開始「首次出現」一次（而且在暖機期之前），不會每天都算
  assert.ok(result.signals[0].occurrences <= 1)
})

test('回測：買進持有的報酬等於區間漲幅扣掉買進成本', () => {
  const series = computeSeries(linearBars(300))
  const { strategies, roundTripCost } = backtestStrategies(series, 'tw')
  const buyHold = strategies.find((s) => s.key === 'buyHold')
  const expected = (series.closes[299] / series.closes[60]) * (1 - roundTripCost / 200) * 100 - 100
  assert.ok(Math.abs(buyHold.totalReturn - expected) < 0.01)
  // 一路上漲，唯一的回落是買進成本（隔天就被漲幅抵掉一部分）
  assert.ok(buyHold.maxDrawdown <= 0 && buyHold.maxDrawdown > -0.3)
  assert.ok(buyHold.curve.length > 10 && buyHold.curve.at(-1).date === 'd299')
})

test('回測：資料太短時不做策略回測', () => {
  assert.equal(backtestStrategies(computeSeries(linearBars(150)), 'tw'), null)
})

test('預測：資料不足 300 筆樣本時回傳 null', () => {
  assert.equal(predictDirection(computeSeries(randomWalk(200))), null)
})

test('預測：隨機漫步沒有可預測性，模型不能被標成可靠；結果可重現', () => {
  const series = computeSeries(randomWalk(1200, 11))
  const first = predictDirection(series)
  const second = predictDirection(series)
  assert.deepEqual(first, second)
  assert.ok(first.probabilityUp >= 0 && first.probabilityUp <= 100)
  assert.equal(first.factors.length, 11)
  assert.ok(first.testSamples >= 100)
  // 隨機漫步理論上猜不準；就算偶爾贏一點，也不該贏到 10 個百分點
  assert.ok(first.edge < 10)
})

test('預測：有規律的資料（漲多會回檔）模型要能贏過基準', () => {
  // 價格繞著 100 上下擺動，偏離越多越容易被拉回：與月線的距離有預測力
  const rand = seeded(3)
  let price = 100
  const bars = Array.from({ length: 1200 }, (_, i) => {
    price += (100 - price) * 0.2 + (rand() - 0.5) * 6
    return { date: `d${i}`, open: price, high: price + 1, low: price - 1, close: price, volume: 1000 }
  })
  const result = predictDirection(computeSeries(bars))
  assert.ok(result.edge > 5, `edge ${result.edge}`)
  assert.equal(result.reliable, true)
})

// ---- 操作建議 ----
const { buildAdvice } = require('../src/services/market/advice')

function adviceItem({ signals, supports = [], resistances = [], research = null, session = 'closed' }) {
  return {
    quote: { price: 100 },
    session,
    indicators: { high20: 110, low20: 90 },
    analysis: { signals, supports, resistances },
    research,
  }
}
const sig = (key, label, value) => ({ key, label, value, tone: 'neutral' })
const BULL = [sig('trend', '均線排列', '多頭排列'), sig('ma20', '月線（MA20）', '站上'), sig('ma60', '季線（MA60）', '站上')]
const BEAR = [sig('trend', '均線排列', '空頭排列'), sig('ma20', '月線（MA20）', '跌破'), sig('ma60', '季線（MA60）', '跌破')]

test('操作建議：多頭結構判偏多，停損用最近支撐、目標用最近壓力', () => {
  const advice = buildAdvice(
    adviceItem({
      signals: BULL,
      supports: [{ price: 95, label: 'MA20' }],
      resistances: [{ price: 110, label: '近 20 日高點' }],
    }),
  )
  assert.equal(advice.stance, 'bullish')
  assert.equal(advice.confidence, 'high')
  assert.equal(advice.levels.stopLoss.price, 95)
  assert.equal(advice.levels.targets[0].price, 110)
  assert.equal(advice.levels.riskReward, 2)
  assert.equal(advice.levels.targetsLabel, '目標價')
})

test('操作建議：空頭結構判偏空，不給風險報酬比，價位改叫反彈減碼點', () => {
  const advice = buildAdvice(adviceItem({ signals: BEAR, supports: [{ price: 95, label: 'MA60' }], resistances: [{ price: 105, label: 'MA5' }] }))
  assert.equal(advice.stance, 'bearish')
  assert.equal(advice.levels.riskReward, null)
  assert.equal(advice.levels.targetsLabel, '反彈減碼點')
  assert.match(advice.positionSize, /持有者|空手/)
})

test('操作建議：沒有支撐時停損用固定比例；沒有壓力時用波動估目標', () => {
  const advice = buildAdvice(adviceItem({ signals: BULL }))
  assert.equal(advice.levels.stopLoss.price, 93)
  assert.equal(advice.levels.targets[0].price, 110)
})

test('操作建議：訊號回測只有明顯優於或劣於基準才算數，不可靠的模型不計入', () => {
  const horizons = (win10) => [5, 10, 20].map((days) => ({ days, count: 20, winRate: days === 10 ? win10 : 50 }))
  const research = {
    backtest: {
      baseline: [{ days: 10, winRate: 55 }],
      signals: [
        { key: 'kd', label: 'KD', value: '黃金交叉', occurrences: 20, sufficient: true, horizons: horizons(70) },
        { key: 'rsi', label: 'RSI(14)', value: '偏強', occurrences: 20, sufficient: true, horizons: horizons(57) },
        { key: 'macd', label: 'MACD', value: '紅柱擴大', occurrences: 3, sufficient: false, horizons: horizons(90) },
      ],
    },
    strategies: null,
    prediction: { probabilityUp: 80, reliable: false, testAccuracy: 50, baselineAccuracy: 55, edge: -5 },
  }
  const advice = buildAdvice(adviceItem({ signals: [sig('trend', '均線排列', '均線糾結')], research }))
  const byLabel = Object.fromEntries(advice.evidence.map((e) => [e.label, e]))
  assert.equal(byLabel['KD 黃金交叉'].direction, 1)
  assert.equal(byLabel['RSI(14) 偏強'].direction, 0)
  assert.equal(byLabel['MACD 紅柱擴大'].counted, false)
  assert.equal(byLabel['模型預測上漲機率 80%'].counted, false)
  // 只有 KD 一項偏多（+1），不足以判偏多
  assert.equal(advice.stance, 'neutral')
})

test('操作建議：沒有指標時回傳 null', () => {
  assert.equal(buildAdvice({ quote: { price: 1 }, analysis: null, indicators: null }), null)
})
