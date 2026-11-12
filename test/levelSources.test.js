const test = require('node:test')
const assert = require('node:assert/strict')

const { volumeNodes, openGaps, swingPoints, computeLevelSources } = require('../src/services/market/levelSources')
const { computeIndicators } = require('../src/services/market/indicators')
const { evaluateCall } = require('../src/services/market/tracking')

const bar = (low, high, volume = 1000, extra = {}) => ({ open: low, high, low, close: high, volume, ...extra })

test('成交密集區：量集中在哪個價位就回報那裡；量平均分布時沒有', () => {
  // 100 根在 50 附近爆量，其餘散在 40～60
  const bars = []
  for (let i = 0; i < 60; i += 1) bars.push(bar(40 + (i % 20), 41 + (i % 20), 100))
  for (let i = 0; i < 40; i += 1) bars.push(bar(49.5, 50.5, 5000))
  const nodes = volumeNodes(bars, 1)
  assert.ok(nodes.length >= 1)
  assert.ok(Math.abs(nodes[0].price - 50) < 0.5, `最密集在 ${nodes[0].price}`)
  assert.ok(nodes[0].weight > 2)
  // 由大到小
  for (let i = 1; i < nodes.length; i += 1) assert.ok(nodes[i - 1].weight >= nodes[i].weight)

  // 每個價位的量都一樣：沒有哪裡特別密集
  const flat = Array.from({ length: 100 }, (_, i) => bar(40 + (i % 20), 41 + (i % 20), 1000))
  assert.equal(volumeNodes(flat, 1).length, 0)
  // ATR 算不出來、K 棒太少：空的
  assert.deepEqual(volumeNodes(bars, null), [])
  assert.deepEqual(volumeNodes(bars.slice(0, 10), 1), [])
})

test('缺口：向上跳空沒回補是支撐、向下跳空沒回補是壓力；補上就不算，太小也不算', () => {
  const flat = (n, low, high) => Array.from({ length: n }, () => bar(low, high))
  // 10～11 之後跳到 13～14：缺口下緣 11 是支撐
  const up = [...flat(5, 10, 11), ...flat(5, 13, 14)]
  assert.deepEqual(openGaps(up, 1).map((g) => [g.side, g.price]), [['support', 11]])
  // 之後跌回 11：補上了
  assert.deepEqual(openGaps([...up, bar(10.5, 13)], 1), [])
  // 向下跳空：前一天的最低 13 是壓力
  const down = [...flat(5, 13, 14), ...flat(5, 10, 11)]
  assert.deepEqual(openGaps(down, 1).map((g) => [g.side, g.price]), [['resistance', 13]])
  // 缺口 0.3 不到 0.5 倍 ATR：不算
  assert.deepEqual(openGaps([...flat(5, 10, 11), ...flat(5, 11.3, 12)], 1), [])
})

test('前波高低點：前後各 5 天裡最高（最低）的那一天；最近 5 天還沒確認不算', () => {
  // 先漲到第 10 天、再跌到第 20 天、再漲
  const bars = Array.from({ length: 31 }, (_, i) => {
    const mid = i <= 10 ? 10 + i : i <= 20 ? 20 - (i - 10) : 10 + (i - 20) * 1.2
    return bar(mid - 0.5, mid + 0.5)
  })
  const { highs, lows } = swingPoints(bars)
  assert.deepEqual(highs, [20.5])
  assert.deepEqual(lows, [9.5])
  // 最後一天是新高，但後面還沒有 5 天：不算
  assert.ok(!highs.includes(bars[30].high))
})

test('computeLevelSources：ATR 算不出來時回傳 null；computeIndicators 帶出 levels、半年線、年線、一年高點', () => {
  assert.equal(computeLevelSources([], null), null)
  const short = Array.from({ length: 10 }, (_, i) => ({ open: 10, high: 11 + i, low: 9, close: 10 + i, volume: 1000 }))
  const few = computeIndicators(short)
  assert.equal(few.levels, null)
  assert.equal(few.ma120, null)
  assert.equal(few.high250, null)

  const bars = Array.from({ length: 300 }, (_, i) => {
    const close = 100 + Math.sin(i / 8) * 10 + i * 0.05
    return { date: `d${i}`, open: close, high: close + 1, low: close - 1, close, volume: 1000 + (i % 7) * 100 }
  })
  const ind = computeIndicators(bars)
  assert.ok(ind.ma120 !== null && ind.ma240 !== null)
  assert.ok(ind.high250 >= ind.high60)
  assert.ok(Array.isArray(ind.levels.volumeNodes) && Array.isArray(ind.levels.gaps))
  assert.ok(ind.levels.swingHighs.length > 0 && ind.levels.swingLows.length > 0)
  // 價位都四捨五入到小數兩位（回應不要帶一長串小數）
  for (const value of [...ind.levels.swingHighs, ...ind.levels.volumeNodes.map((n) => n.price)]) {
    assert.equal(value, Math.round(value * 100) / 100)
  }
})

test('參考命中：規則版本 4 的出場點是收盤跌破才算，之前的版本盤中碰到就算', () => {
  // 第 2 天盤中跌到 94（出場點 95）但收盤 97，第 3 天漲到目標 105
  const bars = [
    { date: '2026-01-01', open: 100, high: 100, low: 100, close: 100 },
    { date: '2026-01-02', open: 99, high: 99, low: 94, close: 97 },
    { date: '2026-01-05', open: 98, high: 106, low: 98, close: 105 },
  ]
  const call = { date: '2026-01-01', price: 100, stance: 'bullish', stopLoss: 95, targets: [105] }
  assert.equal(evaluateCall({ ...call, ruleVersion: 3 }, bars).path, 'stop')
  assert.equal(evaluateCall({ ...call, ruleVersion: 4 }, bars).path, 'target')
  // 收盤真的跌破：版本 4 也算出場
  const closed = [bars[0], { ...bars[1], close: 94.5 }, bars[2]]
  assert.equal(evaluateCall({ ...call, ruleVersion: 4 }, closed).path, 'stop')
})
