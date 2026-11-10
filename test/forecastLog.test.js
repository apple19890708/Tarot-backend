// 股利預估的紀錄與驗證（v20）：推估、公告、過去實際各自組出正確的寫入；比較算出誤差
const test = require('node:test')
const assert = require('node:assert/strict')

const { forecastOps, checkOf, createForecastLog } = require('../src/services/market/forecastLog')

const target = { market: 'tw', kind: 'stock', code: '0056', symbol: '0056.TW', name: '元大高股息' }
const at = new Date('2026-11-10T02:00:00Z')

function reportWith(months, pastEvents = []) {
  return {
    months: months.map((m) => m.month),
    items: [{ target, projection: { months }, pastEvents }],
  }
}

test('推估：第一次只在建立時寫（$setOnInsert）、最後一次只更新還沒有實際數字的（公布後凍結）；不用 pipeline', () => {
  const ops = forecastOps(reportWith([{ month: '2027-01', cash: { perShare: 1.234, source: 'estimated', exDate: null, estimatedDate: '2027-01-19' } }]), at)
  assert.equal(ops.length, 2)
  const point = { perShare: 1.234, date: '2027-01-19', at, source: null }
  assert.deepEqual(ops[0].updateOne, {
    filter: { symbol: '0056.TW', month: '2027-01' },
    update: { $set: { code: '0056', market: 'tw' }, $setOnInsert: { firstEstimate: point } },
    upsert: true,
  })
  assert.deepEqual(ops[1].updateOne, { filter: { symbol: '0056.TW', month: '2027-01', actual: null }, update: { $set: { lastEstimate: point } } })
  // Mongoose 9 預設擋 pipeline：update 一律是物件
  assert.ok(ops.every((op) => !Array.isArray(op.updateOne.update)))
})

test('已公告、本月已除息寫 actual；過去的實際只補「有推估、還沒實際」的，不新增', () => {
  const ops = forecastOps(
    reportWith(
      [
        { month: '2026-11', cash: { perShare: 1.72, source: 'exDone', exDate: '2026-11-03' } },
        { month: '2027-01', cash: { perShare: 0.9, source: 'announced', exDate: '2027-01-19' } },
        { month: '2027-02', cash: null },
      ],
      [
        { type: 'cash', date: '2026-07-21', perShare: 1.35 },
        // 本月的交給 projection（exDone），不重複
        { type: 'cash', date: '2026-11-03', perShare: 1.72 },
      ],
    ),
    at,
  )
  assert.equal(ops.length, 3)
  assert.equal(ops[0].updateOne.update.$set.actual.source, 'exDone')
  assert.equal(ops[1].updateOne.update.$set.actual.perShare, 0.9)
  const past = ops[2].updateOne
  assert.deepEqual(past.filter, { symbol: '0056.TW', month: '2026-07', actual: null, firstEstimate: { $ne: null } })
  assert.equal(past.upsert, undefined)
})

test('比較：預估用公布前最後一次，誤差＝（預估−實際）÷ 實際', () => {
  const check = checkOf(
    {
      symbol: '0056.TW',
      code: '0056',
      market: 'tw',
      month: '2027-01',
      firstEstimate: { perShare: 1.1, date: '2027-01-19' },
      lastEstimate: { perShare: 1.2, date: '2027-01-19' },
      actual: { perShare: 1, date: '2027-01-20' },
    },
    '元大高股息',
  )
  assert.deepEqual([check.estimate, check.firstEstimate, check.actual, check.errorPct], [1.2, 1.1, 1, 20])
})

test('過去月份：實際應收依持股紀錄；當時的預估用同一個持股數換算、同樣扣款，可以直接比', () => {
  const income = require('../src/services/market/income')
  const position = { quantity: 20, costBasis: 1, marketValue: null, unrealized: null, realized: 0, dividends: 0, totalReturn: null, trades: [] }
  const item = {
    id: 'a',
    target,
    trades: [{ side: 'buy', quantity: 20, price: 30, date: '2025-01-02' }],
    dividends: [],
    position,
    summary: null,
  }
  const history = { cash: [{ date: '2026-07-21', amount: 1.35 }], splits: [] }
  const report = income.buildIncomeReport({ items: [item], histories: [history], today: '2026-11-10' })
  assert.equal(report.pastMonths.length, 24)
  assert.equal(report.pastMonths[0], '2024-11')
  assert.equal(report.pastMonths[23], '2026-10')
  const july = report.pastMonths.indexOf('2026-07')
  // 20 張 × 1.35 ＝ 27,000，扣 2.11% 健保補充保費 570 → 26,430
  assert.equal(report.totals.tw.pastActual[july], 26430)

  const { attachPastEstimates } = require('../src/services/market/forecastLog')
  attachPastEstimates(report, [{ symbol: '0056.TW', month: '2026-07', estimate: 1.2, actual: 1.35 }])
  // 20,000 股 × 1.2 ＝ 24,000，扣 506 → 23,494
  assert.equal(report.totals.tw.pastEstimate[july], 23494)
  assert.equal(report.totals.twd.pastEstimate[july], 23494)
  assert.equal(report.totals.tw.pastEstimate[0], null)
})

test('寫入失敗不丟錯（不影響頁面回應）', async () => {
  const log = createForecastLog({ DividendForecast: { bulkWrite: async () => Promise.reject(new Error('db down')) }, now: () => at })
  await log.record(reportWith([{ month: '2027-01', cash: { perShare: 1, source: 'estimated', exDate: null } }]))
})
