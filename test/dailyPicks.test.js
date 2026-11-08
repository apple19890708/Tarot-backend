const test = require('node:test')
const assert = require('node:assert/strict')

const { baseCandidates, reasonsOf, selectPicks, PICK_LIMIT } = require('../src/services/market/dailyPicks')

const row = (code, extra = {}) => ({
  code,
  name: `股票${code}`,
  exchange: 'tse',
  etf: /^00/.test(code),
  close: 100,
  changePct: 1,
  volume: 5000,
  revenueMonth: '2026-10',
  revenueYoy: 10,
  foreignStreak: 3,
  trustStreak: 0,
  ...extra,
})

test('當日推薦：只收一般股票、量夠、外資或投信連買 ≥ 3 天、營收年增 > 0；外資連買多的在前', () => {
  const rows = [
    row('2330', { foreignStreak: 5 }),
    row('2317', { foreignStreak: 0, trustStreak: 4 }),
    row('0050', { foreignStreak: 9 }), // ETF
    row('030001', { foreignStreak: 9 }), // 權證格式
    row('2454', { volume: 999 }), // 量不夠
    row('2303', { foreignStreak: 2, trustStreak: 2 }), // 連買不夠
    row('2412', { revenueYoy: -1 }), // 營收衰退
    row('2882', { revenueYoy: null }), // 沒有營收資料
    row('2603', { foreignStreak: 8 }),
  ]
  assert.deepEqual(baseCandidates(rows).map((r) => r.code), ['2603', '2330', '2317'])
})

test('當日推薦：站上 20 日均線的才留、抓不到 K 線的跳過，最多 8 檔，照原本順序', () => {
  const candidates = Array.from({ length: 12 }, (_, i) => row(String(1101 + i), { foreignStreak: 20 - i }))
  const signals = candidates.map((_, i) => (i === 0 ? null : i === 1 ? { price: 90, ma20: 95 } : { price: 100, ma20: 95 }))
  const picks = selectPicks(candidates, signals)
  assert.equal(picks.length, PICK_LIMIT)
  assert.deepEqual(picks.map((p) => p.code).slice(0, 2), ['1103', '1104'])
  assert.ok(picks.every((p) => Array.isArray(p.reasons) && p.reasons.length >= 3))
})

test('當日推薦的理由：白話、有天數與營收月份', () => {
  assert.deepEqual(reasonsOf(row('2330', { foreignStreak: 5, trustStreak: 3, revenueYoy: 18.26 })), [
    '外資連續買超 5 天',
    '投信連續買超 3 天',
    '10 月營收比去年同月多 18.3%',
    '收盤價在 20 日均線之上',
  ])
  // 籌碼資料只有 5 天：連買到頂時說「最近 5 天都買超」（實際可能更久）
  assert.equal(reasonsOf(row('2330', { foreignStreak: 5 }), 5)[0], '外資最近 5 天都買超')
  assert.equal(reasonsOf(row('2330', { foreignStreak: 3 }), 5)[0], '外資連續買超 3 天')
})

test('推薦類型：高殖利率、營收爆發、低本益比、熱門股的條件與排序', () => {
  const rows = [
    row('1101', { dividendYield: 7, pe: 15, pb: 1.2, volume: 800, revenueYoy: 5, revenueCumYoy: 2, changePct: 2 }),
    row('1102', { dividendYield: 5.5, pe: 10, pb: 1.0, volume: 600, revenueYoy: 45, revenueCumYoy: 20, changePct: 6 }),
    row('1103', { dividendYield: 9, pe: -3, pb: 0.8, volume: 900, revenueYoy: 35, revenueCumYoy: 5, changePct: 9.5 }), // 虧損：不算高殖利率、價值股
    row('1104', { dividendYield: 3.5, pe: 8, pb: 1.4, volume: 300, revenueYoy: 60, revenueCumYoy: 30, changePct: 9.9 }), // 量不夠 500
    row('1105', { dividendYield: 4, pe: 11, pb: 1.3, volume: 5000, revenueYoy: 31, revenueCumYoy: 12, changePct: 3 }),
    row('0056', { dividendYield: 10, pe: 9, pb: 1, volume: 9000, changePct: 1 }), // ETF 都不算
  ]
  assert.deepEqual(baseCandidates(rows, 'dividend').map((r) => r.code), ['1101', '1102'])
  assert.deepEqual(baseCandidates(rows, 'revenue').map((r) => r.code), ['1102', '1105'])
  assert.deepEqual(baseCandidates(rows, 'value').map((r) => r.code), ['1102', '1105'])
  // 熱門：量 ≥ 1000 張、漲幅大的在前
  // 只有 1105 量夠 1000 張（1101～1104 都不到）；ETF 不算
  assert.deepEqual(baseCandidates(rows, 'hot').map((r) => r.code), ['1105'])
})

test('推薦類型：不看均線的類型直接取前 8 檔；理由各自不同', () => {
  const candidates = Array.from({ length: 10 }, (_, i) => row(String(1201 + i), { dividendYield: 10 - i * 0.1, pe: 10 }))
  assert.equal(selectPicks(candidates, [], 5, 'dividend').length, PICK_LIMIT)
  assert.deepEqual(reasonsOf(row('1101', { dividendYield: 6.25, pe: 12.34 }), 0, 'dividend'), ['殖利率 6.3%', '本益比 12.3 倍'])
  assert.deepEqual(reasonsOf(row('1101', { changePct: 9.87, volume: 12345 }), 0, 'hot'), ['今天漲 9.9%', '成交 12,345 張'])
})

test('推薦類型：殖利率陷阱與特殊狀態排除（2026-11-08 真實資料）', () => {
  const rows = [
    row('5314', { name: '世紀*', dividendYield: 8, pe: 10, pb: 1, volume: 900 }), // 名稱帶 *
    row('4303', { dividendYield: 18.9, pe: 8, pb: 1, volume: 900 }), // 殖利率超過 15%
    row('2442', { dividendYield: 9, pe: 2.3, pb: 0.6, volume: 900 }), // 本益比太低
    row('2002', { dividendYield: 6, pe: 9, pb: 1.1, volume: 900 }),
  ]
  assert.deepEqual(baseCandidates(rows, 'dividend').map((r) => r.code), ['2002'])
  assert.deepEqual(baseCandidates(rows, 'value').map((r) => r.code), ['2002'])
})
