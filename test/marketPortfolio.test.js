const test = require('node:test')
const assert = require('node:assert/strict')

const { computePosition, tradeCosts, validateSequence, normalizeFees } = require('../src/services/market/portfolio')

const tsmc = { market: 'tw', kind: 'stock', code: '2330', symbol: '2330.TW' }
const etf = { market: 'tw', kind: 'stock', code: '0050', symbol: '0050.TW' }
const nvda = { market: 'us', kind: 'stock', symbol: 'NVDA' }
const fees = normalizeFees()

test('台股成本：手續費 0.1425% × 折扣、最低 20 元、無條件捨去；證交稅只在賣出收，ETF 0.1%', () => {
  assert.deepEqual(tradeCosts(tsmc, 'buy', 1_000_000, fees), { fee: 1425, tax: 0 })
  assert.deepEqual(tradeCosts(tsmc, 'sell', 1_000_000, fees), { fee: 1425, tax: 3000 })
  assert.deepEqual(tradeCosts(etf, 'sell', 1_000_000, fees), { fee: 1425, tax: 1000 })
  // 2.8 折：1425 × 0.28 = 399
  assert.deepEqual(tradeCosts(tsmc, 'buy', 1_000_000, { ...fees, twDiscount: 0.28 }), { fee: 399, tax: 0 })
  // 零股小金額：最低 20 元
  assert.deepEqual(tradeCosts(tsmc, 'buy', 5000, fees), { fee: 20, tax: 0 })
  assert.deepEqual(tradeCosts(nvda, 'sell', 10_000, { ...fees, usFee: 1.5 }), { fee: 1.5, tax: 0 })
})

test('賣出檢查：依順序不能賣超過當時持有', () => {
  assert.equal(validateSequence([{ side: 'buy', quantity: 1 }, { side: 'sell', quantity: 1 }]), null)
  assert.match(validateSequence([{ side: 'sell', quantity: 1 }, { side: 'buy', quantity: 1 }]), /第 1 筆/)
  assert.equal(validateSequence([{ side: 'buy', quantity: 0.3 }, { side: 'sell', quantity: 0.1 }, { side: 'sell', quantity: 0.2 }]), null)
})

test('先進先出：部分賣出沖銷最早的買進，已實現扣掉手續費與稅，剩下的算未實現', () => {
  const position = computePosition({
    target: tsmc,
    trades: [
      { side: 'buy', quantity: 1, price: 1000, date: '2026-01-02' }, // 1,000,000 + 1,425
      { side: 'buy', quantity: 1, price: 1200, date: '2026-03-02' }, // 1,200,000 + 1,710
      { side: 'sell', quantity: 1, price: 1500, date: '2026-06-01' }, // 1,500,000 − 2,137 − 4,500
    ],
    dividends: [{ amount: 5000, date: '2026-07-10' }],
    fees,
    quote: { price: 1300, change: 10, date: '2026-11-05' },
  })
  // 已實現：1,500,000 − 2,137 − 4,500 − 1,001,425 = 491,938
  assert.equal(position.realized, 491938)
  assert.equal(position.quantity, 1)
  assert.equal(position.costBasis, 1201710)
  // 未實現：1,300,000 − (1,852 + 3,900) − 1,201,710 = 92,538
  assert.equal(position.marketValue, 1300000)
  assert.equal(position.sellCost, 5752)
  assert.equal(position.unrealized, 92538)
  assert.equal(position.dividends, 5000)
  assert.equal(position.totalReturn, 92538 + 491938 + 5000)
  assert.equal(position.today, 10 * 1000)
  assert.equal(position.feesPaid, 1425 + 1710 + 2137)
  assert.equal(position.taxPaid, 4500)
  assert.equal(position.openLots.length, 1)
  assert.equal(position.openLots[0].price, 1200)
  assert.equal(position.trades[2].realized, 491938)
})

test('今日損益：今天才買的那筆用「現價 − 買進價」', () => {
  const position = computePosition({
    target: etf,
    trades: [
      { side: 'buy', quantity: 10, price: 94, date: '2026-09-01' },
      { side: 'buy', quantity: 0.05, price: 97.3, date: '2026-11-05' },
    ],
    fees,
    quote: { price: 97.15, change: -2.7, date: '2026-11-05' },
  })
  // −2.7 × 10,000 + (97.15 − 97.3) × 50
  assert.equal(position.today, -27007.5)
})

test('全部賣光：持有 0、只剩已實現；沒有報價時市值相關欄位為 null', () => {
  const trades = [
    { side: 'buy', quantity: 10, price: 100 },
    { side: 'sell', quantity: 10, price: 110 },
  ]
  const closed = computePosition({ target: nvda, trades, fees, quote: { price: 120, change: 1, date: '2026-11-05' } })
  assert.equal(closed.quantity, 0)
  assert.equal(closed.realized, 100)
  assert.equal(closed.unrealized, 0)
  assert.equal(closed.openLots.length, 0)

  const noQuote = computePosition({ target: nvda, trades: [trades[0]], fees, quote: null })
  assert.equal(noQuote.marketValue, null)
  assert.equal(noQuote.unrealized, null)
  assert.equal(noQuote.totalReturn, null)
  assert.equal(noQuote.today, null)
  assert.equal(noQuote.costBasis, 1000)
})
