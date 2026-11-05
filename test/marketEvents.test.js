const test = require('node:test')
const assert = require('node:assert/strict')

const { rocDate, rocMonth, parseExDividends, parseRevenue, nextRevenueDeadline, eventsFor } = require('../src/services/market/corporateEvents')

test('民國日期與年月轉西元', () => {
  assert.equal(rocDate('1151106'), '2026-11-06')
  assert.equal(rocDate(''), null)
  assert.equal(rocMonth('11509'), '2026-09')
  assert.equal(rocMonth('abc'), null)
})

test('除權息預告：上市與上櫃欄位不同，合併成同一個格式並依日期排序；沒有現金股利是 null', () => {
  const map = parseExDividends(
    [
      { Date: '1151120', Code: '2330', Exdividend: '息', CashDividend: '5.000000', StockDividendRatio: '' },
      { Date: '1151106', Code: '2330', Exdividend: '權', CashDividend: '0', StockDividendRatio: '0.05' },
    ],
    [{ ExRrightsExDividendDate: '1151027', SecuritiesCompanyCode: '00888', ExRrightsExDividend: '除息', CashDividend: '1.50000000', StockDividendRatio: '0.00000000' }],
  )
  assert.deepEqual(map.get('2330'), [
    { date: '2026-11-06', type: '權', cashDividend: null, stockRatio: 0.05 },
    { date: '2026-11-20', type: '息', cashDividend: 5, stockRatio: null },
  ])
  assert.deepEqual(map.get('00888'), [{ date: '2026-10-27', type: '息', cashDividend: 1.5, stockRatio: null }])
})

test('月營收：年增、月增、累計年增取到小數 2 位；備註「-」當成沒有', () => {
  const map = parseRevenue(
    [{ 公司代號: '2330', 資料年月: '11509', '營業收入-當月營收': '511857399', '營業收入-上月比較增減(%)': '-0.5726315925897248', '營業收入-去年同月增減(%)': '54.64861207105231', '累計營業收入-前期比較增減(%)': '41.1066', 備註: '因先進製程產品需求增加所致。' }],
    [{ 公司代號: '1240', 資料年月: '11509', '營業收入-當月營收': '282821', '營業收入-上月比較增減(%)': '12.35', '營業收入-去年同月增減(%)': '13', '累計營業收入-前期比較增減(%)': '8.4', 備註: '-' }],
  )
  assert.deepEqual(map.get('2330'), { month: '2026-09', revenue: 511857399, mom: -0.57, yoy: 54.65, cumYoy: 41.11, note: '因先進製程產品需求增加所致。' })
  assert.equal(map.get('1240').note, '')
})

test('營收公布截止日：每月 10 日前公布上個月；過了 10 日就看下個月', () => {
  assert.deepEqual(nextRevenueDeadline('2026-11-05'), { deadline: '2026-11-10', forMonth: '2026-10' })
  assert.deepEqual(nextRevenueDeadline('2026-11-10'), { deadline: '2026-11-10', forMonth: '2026-10' })
  assert.deepEqual(nextRevenueDeadline('2026-12-11'), { deadline: '2027-01-10', forMonth: '2026-12' })
})

test('單檔事件：只取今天以後最近一次除權息', () => {
  const data = {
    exDividends: new Map([['2330', [{ date: '2026-11-01' }, { date: '2026-11-20' }, { date: '2026-12-01' }]]]),
    revenue: new Map([['2330', { month: '2026-09' }]]),
  }
  assert.deepEqual(eventsFor('2330', data, '2026-11-05'), { exDividend: { date: '2026-11-20' }, revenue: { month: '2026-09' } })
  assert.deepEqual(eventsFor('9999', data, '2026-11-05'), { exDividend: null, revenue: null })
})
