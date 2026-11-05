const test = require('node:test')
const assert = require('node:assert/strict')

const { buildUniverse, parseFilters, passes, sortRows, passesTechnical, technicalNeeded } = require('../src/services/market/screener')

const quotes = new Map([
  ['2330', { name: '台積電', exchange: 'tse', close: 1000, changePct: -1, volume: 50000 }],
  ['2412', { name: '中華電', exchange: 'tse', close: 120, changePct: 0.5, volume: 8000 }],
  ['0056', { name: '元大高股息', exchange: 'tse', close: 35, changePct: 0.2, volume: 30000 }],
  ['6488', { name: '環球晶', exchange: 'otc', close: 500, changePct: -3, volume: 900 }],
])
const valuation = new Map([
  ['2330', { pe: 25, dividendYield: 1.5, pb: 6 }],
  ['2412', { pe: 24, dividendYield: 4.2, pb: 2.5 }],
  ['6488', { pe: null, dividendYield: 6, pb: 1.2 }],
])
const revenue = new Map([
  ['2330', { month: '2026-09', yoy: 54, cumYoy: 41 }],
  ['2412', { month: '2026-09', yoy: 2, cumYoy: 1 }],
])
const streaks = new Map([
  ['2330', { foreign: -5, trust: 5 }],
  ['2412', { foreign: 3, trust: 0 }],
])
const rows = buildUniverse({ quotes, valuation, revenue, streaks })
const pick = (filters) =>
  sortRows(
    rows.filter((r) => passes(r, parseFilters(filters).filters)),
    parseFilters(filters).filters.sort,
  ).map((r) => r.code)

test('合併表：沒有資料的欄位是 null；ETF 依代號判斷', () => {
  const tsmc = rows.find((r) => r.code === '2330')
  assert.equal(tsmc.revenueYoy, 54)
  assert.equal(tsmc.foreignStreak, -5)
  assert.equal(rows.find((r) => r.code === '0056').etf, true)
  assert.equal(rows.find((r) => r.code === '6488').revenueYoy, null)
})

test('條件：預設排除 ETF；本益比要大於 0；有設條件但沒資料的不算符合', () => {
  assert.deepEqual(pick({}).sort(), ['2330', '2412', '6488'])
  assert.deepEqual(pick({ includeEtf: true }).length, 4)
  // 環球晶沒有本益比（虧損），不符合本益比條件
  assert.deepEqual(pick({ peMax: 30 }).sort(), ['2330', '2412'])
  assert.deepEqual(pick({ yieldMin: 4 }), ['6488', '2412'])
  assert.deepEqual(pick({ revenueYoyMin: 10 }), ['2330'])
  assert.deepEqual(pick({ foreignStreakMin: 3 }), ['2412'])
  assert.deepEqual(pick({ trustStreakMin: 3 }), ['2330'])
  assert.deepEqual(pick({ priceMin: 100, priceMax: 600, volumeMin: 1000 }), ['2412'])
})

test('排序：殖利率由高到低、本益比由低到高，沒資料的排最後', () => {
  assert.deepEqual(pick({ sort: 'dividendYield' }), ['6488', '2412', '2330'])
  assert.deepEqual(pick({ sort: 'pe' }), ['2412', '2330', '6488'])
  assert.equal(parseFilters({ sort: 'evil' }).filters.sort, 'dividendYield')
})

test('條件驗證：負數、非數字、RSI 超過 100 擋下；空白忽略', () => {
  assert.ok(parseFilters({ peMax: -1 }).error)
  assert.ok(parseFilters({ yieldMin: 'abc' }).error)
  assert.ok(parseFilters({ rsiMax: 120 }).error)
  assert.deepEqual(Object.keys(parseFilters({ peMax: '', yieldMin: null }).filters).sort(), ['aboveMa60', 'bullishMa', 'includeEtf', 'sort'])
})

test('技術面：站上季線、多頭排列、RSI 區間', () => {
  const f = (raw) => parseFilters(raw).filters
  const signals = { price: 110, ma5: 108, ma20: 105, ma60: 100, rsi: 62 }
  assert.equal(technicalNeeded(f({ aboveMa60: true })), true)
  assert.equal(technicalNeeded(f({ peMax: 10 })), false)
  assert.equal(passesTechnical(signals, f({ aboveMa60: true, bullishMa: true, rsiMin: 50, rsiMax: 70 })), true)
  assert.equal(passesTechnical({ ...signals, ma5: 99 }, f({ bullishMa: true })), false)
  assert.equal(passesTechnical({ ...signals, price: 90 }, f({ aboveMa60: true })), false)
  assert.equal(passesTechnical({ ...signals, rsi: 75 }, f({ rsiMax: 70 })), false)
  assert.equal(passesTechnical(null, f({ aboveMa60: true })), false)
})
