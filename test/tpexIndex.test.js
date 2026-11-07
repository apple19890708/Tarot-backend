const test = require('node:test')
const assert = require('node:assert/strict')

const { parseMonth, recentMonths, rangeStart, buildChart } = require('../src/services/market/tpexIndex')

// 櫃買中心「櫃買指數(月查詢)」的格式（2026-11 真實資料節錄）
const payload = {
  tables: [
    {
      fields: ['日期', '開市', '最高', '最低', '收市', '漲/跌'],
      data: [
        ['2026/11/05', '341.88', '341.88', '321.23', '321.47', '-22.03'],
        ['2026/11/06', '313.77', '313.77', '294.18', '304.02', '-17.45'],
      ],
    },
  ],
}

test('櫃買指數：月查詢解析成日線', () => {
  assert.deepEqual(parseMonth(payload)[1], { date: '2026-11-06', open: 313.77, high: 313.77, low: 294.18, close: 304.02 })
  assert.deepEqual(parseMonth(null), [])
})

test('櫃買指數：往回 13 個月跨年、範圍起點', () => {
  const months = recentMonths('2026-11-07', 13)
  assert.deepEqual(months[0], { year: 2025, month: 11 })
  assert.deepEqual(months.at(-1), { year: 2026, month: 11 })
  assert.equal(rangeStart('2026-11-07', '1mo'), '2026-10-07')
  assert.equal(rangeStart('2026-11-07', 'ytd'), '2026-01-01')
  assert.equal(rangeStart('2026-03-31', '1mo'), '2026-03-03')
})

test('櫃買指數：同一天以正式收盤為準，盤中才接上即時報價', () => {
  const bars = parseMonth(payload)
  // MIS 停在收盤集合競價前的數字（2026-11-06 13:19 是 303.78）
  const stale = { date: '2026-11-06', price: 303.78, open: 313.77, high: 313.77, low: 294.18, time: '2026-11-06T05:19:50.000Z' }
  const closed = buildChart(bars, stale, '1mo', '2026-11-07')
  assert.equal(closed.price, 304.02)
  assert.equal(closed.dayChange, -17.45)
  assert.equal(closed.points.length, 2)

  const intraday = { date: '2026-11-09', price: 310, open: 305, high: 312, low: 303, time: '2026-11-09T02:00:00.000Z' }
  const live = buildChart(bars, intraday, '1mo', '2026-11-09')
  assert.equal(live.price, 310)
  assert.equal(live.stats.prevClose, 304.02)
  assert.equal(live.points.at(-1).close, 310)
  assert.equal(live.time, intraday.time)
  assert.deepEqual(live.ranges, ['1mo', '6mo', 'ytd', '1y'])
})
