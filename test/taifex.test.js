const test = require('node:test')
const assert = require('node:assert/strict')

const { chartPoints, nearMonthQuote, requestBody } = require('../src/services/market/taifex')

// 2026-11-06 夜盤的真實回應（節錄）：第一筆是現貨，之後是各月份合約
const NIGHT = {
  RtCode: '0',
  RtData: {
    QuoteList: [
      { SymbolID: 'TXF-P', DispCName: '臺指現貨', CLastPrice: '', CRefPrice: '39701.64', CDate: '20261106', CTime: '' },
      { SymbolID: 'TXFK6-M', DispCName: '臺指期116', CLastPrice: '40298.00', CRefPrice: '39652.00', COpenPrice: '39742.00', CHighPrice: '40845.00', CLowPrice: '39129.00', CTotalVolume: '69874', CDate: '20261107', CTime: '045959' },
      { SymbolID: 'TXFL6-M', DispCName: '臺指期126', CLastPrice: '40373.00', CRefPrice: '39719.00', CDate: '20261107', CTime: '045959' },
    ],
  },
}

test('台指期夜盤：取近月合約，漲跌和日盤結算價比', () => {
  assert.deepEqual(nearMonthQuote(NIGHT, 'night'), {
    session: 'night',
    symbolId: 'TXFK6-M',
    contract: '臺指期116',
    price: 40298,
    refPrice: 39652,
    change: 646,
    changePct: 1.63,
    open: 39742,
    high: 40845,
    low: 39129,
    volume: 69874,
    date: '2026-11-07',
    time: '04:59:59',
  })
})

test('台指期：沒有成交價或沒有合約時回 null；夜盤與日盤的請求參數不同', () => {
  const noTrade = { RtData: { QuoteList: [{ SymbolID: 'TXFK6-M', CLastPrice: '', CRefPrice: '39652' }] } }
  assert.equal(nearMonthQuote(noTrade, 'night'), null)
  assert.equal(nearMonthQuote({}, 'night'), null)
  assert.equal(JSON.parse(requestBody('night')).MarketType, '1')
  assert.equal(JSON.parse(requestBody('day')).MarketType, '0')
})

test('台指期夜盤分鐘走勢：15:00 以後是當天、凌晨屬於隔天（台北時間）', () => {
  const payload = { RtData: { Ticks: [['150100', '39742', '39767', '39610', '39675', '271'], ['235900', '1', '1', '1', '40100', '5'], ['050000', '40204', '40298', '40204', '40298', '97'], ['bad', '', '', '', '', '']] } }
  assert.deepEqual(chartPoints(payload, '2026-11-06'), [
    { t: '2026-11-06T07:01:00.000Z', close: 39675 },
    { t: '2026-11-06T15:59:00.000Z', close: 40100 },
    { t: '2026-11-06T21:00:00.000Z', close: 40298 },
  ])
  assert.deepEqual(chartPoints(payload, null), [])
})
