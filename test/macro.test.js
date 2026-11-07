const test = require('node:test')
const assert = require('node:assert/strict')

const { SERIES, parseFredCsv, summarize } = require('../src/services/market/macro')

const series = (key) => SERIES.find((s) => s.key === key)
// 14 個月的假資料：每月漲 0.25，最後一個月多漲一點
function csv(id, values) {
  const lines = values.map((v, i) => {
    const d = new Date(Date.UTC(2025, 7 + i, 1)).toISOString().slice(0, 10)
    return `${d},${v}`
  })
  return [`observation_date,${id}`, ...lines].join('\n')
}

test('FRED CSV：讀出年月與數值，缺值（.）跳過', () => {
  const rows = parseFredCsv('observation_date,CPIAUCSL\n2026-08-01,334.131\n2026-09-01,.\n2026-10-01,336.298\n')
  assert.deepEqual(rows, [
    { date: '2026-08', value: 334.131 },
    { date: '2026-10', value: 336.298 },
  ])
})

test('通膨：年增率和 12 個月前比，附前一個月的年增率與月增率', () => {
  const values = Array.from({ length: 14 }, (_, i) => 100 + i * 0.25)
  values[13] = 104
  const result = summarize(series('cpi'), parseFredCsv(csv('CPIAUCSL', values)))
  assert.equal(result.month, '2026-09')
  // (104 / 100.25 - 1) = 3.74%
  assert.equal(result.yoy, 3.7)
  // (103 / 100 - 1) = 3%
  assert.equal(result.prevYoy, 3)
  // (104 / 103 - 1) = 0.97%
  assert.equal(result.mom, 1)
})

test('非農：當月新增人數（千人）與前一個月；資料不夠回 null', () => {
  const rows = parseFredCsv(csv('PAYEMS', [159068, 159128, 159293]))
  assert.deepEqual(summarize(series('nfp'), rows), { key: 'nfp', name: '非農就業', kind: 'jobs', month: '2025-10', change: 165, prevChange: 60 })
  assert.equal(summarize(series('nfp'), rows.slice(0, 2)), null)
  assert.equal(summarize(series('cpi'), rows), null)
})
