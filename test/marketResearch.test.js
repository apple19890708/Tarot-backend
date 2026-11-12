const test = require('node:test')
const assert = require('node:assert/strict')

const { computeIndicators } = require('../src/services/market/indicators')
const { computeSeries, pointAt, aggregateSeries } = require('../src/services/market/series')
const { backtestSignals, backtestStrategies, stats, judgeSignal, wilsonInterval, ROUND_TRIP_COST } = require('../src/services/market/backtest')
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
  assert.deepEqual(stats([2, -1, 3, -4]), { count: 4, wins: 2, winRate: 50, avgReturn: 0, medianReturn: 0.5, worst: -4, best: 3 })
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
  // 隨機漫步一律不可靠：就算剛好贏基準幾個百分點，合理範圍也會包含基準
  assert.equal(first.reliable, false)
  assert.equal(first.effectiveSamples, Math.floor(first.testSamples / 5))
})

test('預測：贏基準幾個百分點但獨立樣本少，不算可靠', () => {
  // 換幾個種子，找出「贏基準 3 個百分點以上」的隨機漫步：舊規則會標成可靠，新規則不會
  let lucky = null
  for (let seed = 1; seed < 40 && !lucky; seed += 1) {
    const result = predictDirection(computeSeries(randomWalk(1200, seed)))
    if (result && result.edge >= 3) lucky = result
  }
  assert.ok(lucky, '找不到贏基準 3 個百分點的隨機漫步')
  assert.equal(lucky.reliable, false)
  assert.ok(lucky.accuracyInterval.low <= lucky.baselineAccuracy)
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
const { buildAdvice, RULE_VERSION } = require('../src/services/market/advice')

function adviceItem({ signals, supports = [], resistances = [], research = null, session = 'closed', indicators = {} }) {
  return {
    quote: { price: 100 },
    session,
    indicators: { high20: 110, low20: 90, ...indicators },
    analysis: { signals, supports, resistances },
    research,
  }
}
// 長期趨勢（規則版本 4）：現價 100。UP＝在年線之上、離一年高點 5%（+2 分）；DOWN＝在年線之下、離一年高點 29%（−2 分）
const UP = { ma240: 90, high250: 105 }
const DOWN = { ma240: 120, high250: 140 }
const sig = (key, label, value) => ({ key, label, value, tone: 'neutral' })
const BULL = [sig('trend', '均線排列', '多頭排列'), sig('ma20', '月線（MA20）', '站上'), sig('ma60', '季線（MA60）', '站上')]
const BEAR = [sig('trend', '均線排列', '空頭排列'), sig('ma20', '月線（MA20）', '跌破'), sig('ma60', '季線（MA60）', '跌破')]

test('操作建議：長期趨勢偏多判偏多；出場點用 2 倍 ATR、目標用上方的壓力', () => {
  const advice = buildAdvice(
    adviceItem({
      signals: BULL,
      indicators: { ...UP, atr14: 2 },
      supports: [{ price: 95, label: 'MA20' }],
      resistances: [{ price: 110, label: '近 20 日高點' }],
    }),
  )
  assert.equal(advice.stance, 'bullish')
  // 年線 1＋接近一年高點 1＋均線排列 0.5
  assert.equal(advice.score, 2.5)
  // 只有趨勢類同方向：信心最多到中
  assert.equal(advice.confidence, 'medium')
  assert.equal(advice.levels.stopLoss.price, 96)
  assert.match(advice.levels.stopLoss.label, /一天平均波動的 2 倍（約 −4%），收盤跌破才算/)
  assert.equal(advice.levels.targets[0].price, 110)
  assert.equal(advice.levels.riskReward, 2.5)
  assert.equal(advice.levels.targetsLabel, '目標價')
  assert.match(advice.forNew, /收盤跌破 96 停損/)
})

test('操作建議：長期趨勢偏空判偏空，不給風險報酬比，價位改叫反彈減碼點', () => {
  const advice = buildAdvice(
    adviceItem({ signals: BEAR, indicators: DOWN, supports: [{ price: 95, label: 'MA60' }], resistances: [{ price: 105, label: 'MA20' }] }),
  )
  assert.equal(advice.stance, 'bearish')
  assert.equal(advice.score, -2.5)
  assert.equal(advice.levels.riskReward, null)
  assert.equal(advice.levels.targetsLabel, '反彈減碼點')
  assert.equal(advice.levels.stopLossLabel, '持有者出場點')
  assert.match(advice.positionSize, /持有者|空手/)
})

test('操作建議：沒有 ATR 時停損用固定比例；沒有壓力時用波動估目標', () => {
  const advice = buildAdvice(adviceItem({ signals: BULL }))
  assert.equal(advice.levels.stopLoss.price, 93)
  assert.equal(advice.levels.targets[0].price, 110)
  // 有 ATR：目標用 3 倍 ATR 估
  const withAtr = buildAdvice(adviceItem({ signals: BULL, indicators: { atr14: 2 } }))
  assert.equal(withAtr.levels.targets[0].price, 106)
  assert.match(withAtr.levels.targets[0].label, /3 倍/)
  // 資料不到一年（沒有年線）：風險提醒要說
  assert.ok(advice.risks.some((r) => r.includes('不到一年')))
})

// 回測訊號的假資料：count 次裡 10 日上漲 win10%；結論和真的一樣交給 judgeSignal 算
function fakeSignal(fields, win10, { count = 20, others = 50, baseline }) {
  const horizons = [5, 10, 20].map((days) => {
    const winRate = days === 10 ? win10 : others
    return { days, count, wins: Math.round((winRate / 100) * count), winRate }
  })
  const signal = { occurrences: count, horizons, ...fields }
  return { ...signal, verdict: judgeSignal(signal, baseline) }
}

test('回測判定：信賴區間整段高於基準才算偏漲；次數少時要差更多', () => {
  const baseline = [5, 10, 20].map((days) => ({ days, winRate: 55 }))
  const judge = (win10, count, others = 55) => fakeSignal({ sufficient: true }, win10, { count, others, baseline }).verdict
  assert.equal(judge(70, 20).direction, 1) // 14/20，區間約 56～81%
  assert.equal(judge(57, 20).direction, 0) // 區間包含 55%
  assert.equal(judge(57, 20).reason, 'noEdge')
  assert.equal(judge(64.3, 14).direction, 0) // 9/14：差 9 個百分點，但次數太少
  assert.equal(judge(64, 400).direction, 1) // 同樣的差距，次數多就成立
  assert.equal(judge(35, 20).direction, -1)
  // 10 日偏漲、20 日卻明顯偏跌：方向不一致不算
  assert.equal(judge(70, 20, 45).reason, 'horizonConflict')
  assert.equal(judge(70, 20, 45).direction, 0)
  // 次數不足、前後不一致：不列入
  assert.equal(fakeSignal({ sufficient: false }, 90, { count: 3, baseline }).verdict.counted, false)
  assert.equal(fakeSignal({ sufficient: true, consistent: false }, 70, { baseline }).verdict.reason, 'inconsistent')
})

test('回測判定：Wilson 區間', () => {
  const interval = wilsonInterval(14, 20)
  assert.ok(interval.low > 55 && interval.low < 57, `low ${interval.low}`)
  assert.ok(interval.high > 80 && interval.high < 82, `high ${interval.high}`)
  assert.equal(wilsonInterval(0, 0), null)
})

test('策略回測：台股 ETF 的證交稅比股票低', () => {
  const series = computeSeries(linearBars(300))
  assert.equal(backtestStrategies(series, 'tw').roundTripCost, ROUND_TRIP_COST.tw)
  assert.equal(backtestStrategies(series, 'tw', { etf: true }).roundTripCost, ROUND_TRIP_COST.twEtf)
  assert.ok(ROUND_TRIP_COST.twEtf < ROUND_TRIP_COST.tw)
  // 美股不分
  assert.equal(backtestStrategies(series, 'us', { etf: true }).roundTripCost, ROUND_TRIP_COST.us)
})

test('操作建議：訊號回測只有明顯優於或劣於基準才算數（每項 0.5 分）；機器學習不計分', () => {
  const baseline = [{ days: 10, winRate: 55 }]
  const research = {
    backtest: {
      baseline,
      signals: [
        fakeSignal({ key: 'kd', label: 'KD', value: '黃金交叉', sufficient: true }, 70, { baseline }),
        fakeSignal({ key: 'rsi', label: 'RSI(14)', value: '偏強', sufficient: true }, 57, { baseline }),
        fakeSignal({ key: 'macd', label: 'MACD', value: '紅柱擴大', sufficient: false }, 90, { count: 3, baseline }),
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
  // 只有 KD 一項偏多（回測訊號每項 0.5 分），不足以判偏多
  assert.equal(advice.score, 0.5)
  assert.equal(advice.stance, 'neutral')
})

test('操作建議：年線、離一年高點各 1 分，均線排列 0.5 分；月線、季線只列出不計分', () => {
  // 沒有年線資料：均線多頭排列只有 0.5 分，不會判偏多（規則版本 3 以前光靠均線三項就 2 分）
  const maOnly = buildAdvice(adviceItem({ signals: BULL }))
  assert.equal(maOnly.score, 0.5)
  assert.equal(maOnly.stance, 'neutral')
  for (const label of ['站上月線（MA20）', '站上季線（MA60）']) {
    assert.equal(maOnly.evidence.find((e) => e.label === label).counted, false)
  }

  const byLabel = (advice) => Object.fromEntries(advice.evidence.map((e) => [e.label, e]))
  const up = buildAdvice(adviceItem({ signals: [sig('trend', '均線排列', '均線糾結')], indicators: UP }))
  assert.equal(up.score, 2)
  assert.equal(up.stance, 'bullish')
  assert.equal(byLabel(up)['股價在年線之上'].direction, 1)
  assert.equal(byLabel(up)['接近一年高點'].direction, 1)
  assert.equal(byLabel(up)['均線糾結'].counted, false)

  // 離一年高點 8%～20% 之間：不列入，只剩年線 1 分
  const middle = buildAdvice(adviceItem({ signals: BULL, indicators: { ma240: 90, high250: 115 } }))
  assert.equal(byLabel(middle)['離一年高點有一段距離'].counted, false)
  assert.equal(middle.score, 1.5)
  assert.equal(middle.stance, 'neutral')

  const down = buildAdvice(adviceItem({ signals: BEAR, indicators: DOWN }))
  assert.equal(byLabel(down)['股價在年線之下'].direction, -1)
  assert.equal(byLabel(down)['離一年高點很遠'].direction, -1)

  // 長期趨勢偏多（+2.5），一項回測訊號偏空（−0.5）：還是偏多；信心看有沒有趨勢以外的依據站同一邊
  const baseline = [{ days: 10, winRate: 55 }]
  const withSignal = (value, win10) =>
    buildAdvice(
      adviceItem({
        signals: BULL,
        indicators: UP,
        research: { backtest: { baseline, signals: [fakeSignal({ key: 'kd', label: 'KD', value, sufficient: true }, win10, { baseline })] }, strategies: null, prediction: null },
      }),
    )
  const against = withSignal('死亡交叉', 30)
  assert.equal(against.score, 2)
  assert.equal(against.stance, 'bullish')
  assert.equal(against.confidence, 'medium')
  const agree = withSignal('黃金交叉', 70)
  assert.equal(agree.score, 3)
  assert.equal(agree.confidence, 'high')
})

test('操作建議：出場點是現價 − 2 倍 ATR（最遠 −10%），和支撐在哪裡無關', () => {
  const withAtr = (atr14, supports = [], resistances = []) => buildAdvice(adviceItem({ signals: BEAR, indicators: { ...DOWN, atr14 }, supports, resistances }))
  // 支撐再近（MA20 只差 1%）出場點也不跟著它：實測用最近的支撐當出場點，20 天內 75% 會碰到
  const near = withAtr(2, [{ price: 99, label: 'MA20' }, { price: 97, label: 'MA60' }])
  assert.equal(near.levels.stopLoss.price, 96)
  assert.doesNotMatch(near.levels.stopLoss.label, /太近/)
  assert.equal(withAtr(1.5).levels.stopLoss.price, 97)

  // 波動極大（ATR 8）：2 倍是 −16%，設在上限 −10%，並提醒部位放小
  const noisy = withAtr(8)
  assert.equal(noisy.levels.stopLoss.price, 90)
  assert.match(noisy.levels.stopLoss.label, /最遠設到 −10%/)
  assert.ok(noisy.risks.some((r) => r.includes('容易被洗出場')))
  assert.ok(!near.risks.some((r) => r.includes('容易被洗出場')))

  // 目標／減碼點跳過離現價不到 1 倍 ATR 的壓力
  const targets = withAtr(2, [], [{ price: 100.5, label: 'MA20' }, { price: 104, label: 'MA60' }, { price: 108, label: '前波高點' }])
  assert.deepEqual(targets.levels.targets.map((t) => t.price), [104, 108])

  // 文字裡的參考支撐：跳過貼著現價的、優先用不是「容易跌破」的
  const bull = buildAdvice(
    adviceItem({
      signals: BULL,
      indicators: { ...UP, atr14: 2 },
      supports: [
        { price: 99.5, label: 'MA20', strength: 'normal' },
        { price: 98, label: '近 20 日低點', strength: 'weak' },
        { price: 96.5, label: '成交密集區', strength: 'strong' },
      ],
    }),
  )
  assert.ok(bull.forNew.includes('等拉回 96.5（成交密集區）附近再加'), bull.forNew)
  // 夠遠的支撐都在出場點（96）之下：不提「拉回到哪裡」，免得比出場點還低
  const below = buildAdvice(
    adviceItem({ signals: BULL, indicators: { ...UP, atr14: 2 }, supports: [{ price: 99.5, label: 'MA20' }, { price: 94, label: '成交密集區', strength: 'strong' }] }),
  )
  assert.ok(!below.forNew.includes('拉回'), below.forNew)
})

test('操作建議：最佳技術策略只列出不計分', () => {
  const strategy = (key, totalReturn, extra = {}) => ({ key, label: key, totalReturn, holdingNow: true, robust: false, ...extra })
  const research = (best, extra) => ({
    backtest: null,
    prediction: null,
    strategies: { years: 4.7, strategies: [strategy('buyHold', 100), strategy('maCross', best, extra)] },
  })
  const losing = buildAdvice(adviceItem({ signals: BULL, research: research(80) })).evidence.find((e) => e.group === '策略')
  assert.equal(losing.counted, false)
  assert.match(losing.detail, /輸給買進持有/)
  // 贏過買進持有、前後兩段都穩定也一樣不計分（歷史重算裡照它判斷方向沒有比較準）
  const winning = buildAdvice(adviceItem({ signals: BULL, research: research(120, { robust: true }) }))
  const win = winning.evidence.find((e) => e.group === '策略')
  assert.equal(win.counted, false)
  assert.match(win.detail, /贏過買進持有/)
  assert.equal(winning.score, 0.5)
})

test('操作建議：大盤方向只列出，不計分也不調整信心', () => {
  const index = (above) => {
    const closes = Array.from({ length: 80 }, () => 100)
    closes[79] = above ? 110 : 90
    return { label: '大盤', series: { closes, ma60: closes.map((_, i) => (i >= 59 ? 100 : null)) } }
  }
  const item = adviceItem({ signals: BULL, indicators: UP, supports: [{ price: 95, label: 'MA20' }] })
  const withUp = buildAdvice(item, { context: index(true) })
  const withDown = buildAdvice(item, { context: index(false) })
  assert.equal(withDown.confidence, withUp.confidence)
  assert.equal(withDown.score, withUp.score)
  assert.equal(withDown.evidence.find((e) => e.group === '大盤').counted, false)
  assert.equal(withDown.evidence.find((e) => e.group === '大盤').label, '大盤跌破季線')
  assert.ok(!withDown.risks.some((r) => r.includes('信心降一級')))
  assert.equal(buildAdvice(item).ruleVersion, RULE_VERSION)
  assert.equal(RULE_VERSION, 4)
})

test('操作建議：籌碼淨買賣超太小又沒有連買，不計分', () => {
  const chipsOf = (foreign) => ({ latestOnly: false, summary: { foreign, trust: null, margin: null } })
  const item = (foreign) => ({ ...adviceItem({ signals: BULL }), chips: chipsOf(foreign) })
  const chip = (advice) => advice.evidence.find((e) => e.group === '籌碼')
  // 佔成交量 0.3%、連 1 天：雜訊
  const noise = chip(buildAdvice(item({ name: '外資', total: 300, streak: 1, volumePct: 0.3, text: '外資 5 日買超 300 張' })))
  assert.equal(noise.counted, false)
  assert.match(noise.detail, /量太小不計入/)
  // 佔 0.3% 但連 3 天：算數
  assert.equal(chip(buildAdvice(item({ name: '外資', total: 300, streak: 3, volumePct: 0.3, text: 'x' }))).counted, true)
  // 佔 2%：算數
  assert.equal(chip(buildAdvice(item({ name: '外資', total: -3000, streak: -1, volumePct: -2, text: 'x' }))).direction, -1)
  // 沒有成交量資料：照舊計分
  assert.equal(chip(buildAdvice(item({ name: '外資', total: 10, streak: 1, volumePct: null, text: 'x' }))).counted, true)
})

test('操作建議：沒有指標時回傳 null', () => {
  assert.equal(buildAdvice({ quote: { price: 1 }, analysis: null, indicators: null }), null)
})

test('aggregateSeries：日 K 合成週 K／月 K，收盤取最後一天、成交量加總、均線用合成後重算', () => {
  // 2026-01-05（一）～2026-02-06（五），共 5 週、25 個交易日；收盤 1..25、成交量都是 10
  const dates = []
  const start = Date.UTC(2026, 0, 5)
  for (let w = 0; w < 5; w += 1) {
    for (let d = 0; d < 5; d += 1) dates.push(new Date(start + (w * 7 + d) * 86400000).toISOString().slice(0, 10))
  }
  const series = { dates, closes: dates.map((_, i) => i + 1), volumes: dates.map(() => 10) }

  const weekly = aggregateSeries(series, 'week')
  assert.deepEqual(weekly.dates, ['2026-01-09', '2026-01-16', '2026-01-23', '2026-01-30', '2026-02-06'])
  assert.deepEqual(weekly.closes, [5, 10, 15, 20, 25])
  assert.deepEqual(weekly.volumes, [50, 50, 50, 50, 50])
  assert.deepEqual(weekly.ma5, [null, null, null, null, 15])

  const monthly = aggregateSeries(series, 'month')
  assert.deepEqual(monthly.dates, ['2026-01-30', '2026-02-06'])
  assert.deepEqual(monthly.closes, [20, 25])
  assert.deepEqual(monthly.volumes, [200, 50])
})

test('aggregateSeries：跨年的週仍算同一週（以週一為起點），成交量缺值當 0', () => {
  const series = { dates: ['2025-12-31', '2026-01-02', '2026-01-05'], closes: [1, 2, 3], volumes: [5, null, 7] }
  const weekly = aggregateSeries(series, 'week')
  assert.deepEqual(weekly.dates, ['2026-01-02', '2026-01-05'])
  assert.deepEqual(weekly.volumes, [5, 7])
})

test('aggregateSeries：週 K 的開盤取第一天、最高最低取整週極值', () => {
  const series = {
    dates: ['2026-01-05', '2026-01-06', '2026-01-07'],
    opens: [10, 12, 11],
    highs: [13, 15, 12],
    lows: [9, 11, 8],
    closes: [12, 11, 10],
    volumes: [1, 1, 1],
  }
  const weekly = aggregateSeries(series, 'week')
  assert.deepEqual(weekly.opens, [10])
  assert.deepEqual(weekly.highs, [15])
  assert.deepEqual(weekly.lows, [8])
  assert.deepEqual(weekly.closes, [10])
})
