// 獲利與股利（v20）：Yahoo 股利解析、應收股利、未來 12 個月預估、整份報告、配股的損益、API
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const income = require('../src/services/market/income')
const { computePosition, validateSequence } = require('../src/services/market/portfolio')
const { createMarketRouter } = require('../src/routes/market')

const TW = { market: 'tw', kind: 'stock', code: '2884', symbol: '2884.TW', exchange: 'tse', name: '玉山金' }
const US = { market: 'us', kind: 'stock', symbol: 'AAPL', name: 'Apple' }
const ts = (date) => Date.parse(`${date}T01:00:00Z`) / 1000
const dateOf = (sec) => new Date(sec * 1000).toISOString().slice(0, 10)

test('Yahoo 事件：台股小比例的 split 是配股，2:1、4:1 與美股都是真正的分割', () => {
  const events = {
    dividends: { a: { amount: 1.188, date: ts('2024-07-25') }, b: { amount: 1.2, date: ts('2025-07-22') }, bad: { amount: 0, date: ts('2025-01-01') } },
    splits: {
      x: { numerator: 1020.0332, denominator: 1000, date: ts('2024-07-25') },
      y: { numerator: 4, denominator: 1, date: ts('2025-06-18') },
    },
  }
  const tw = income.parseYahooEvents(events, { market: 'tw', dateOf })
  assert.deepEqual(
    tw.cash.map((c) => c.date),
    ['2024-07-25', '2025-07-22'],
  )
  assert.deepEqual(
    tw.splits.map((s) => s.kind),
    ['stockDividend', 'split'],
  )
  const us = income.parseYahooEvents(events, { market: 'us', dateOf })
  assert.ok(us.splits.every((s) => s.kind === 'split'))
})

test('當年實際的每股股利：乘回之後的配股比例（玉山金 2024：Yahoo 1.188 → 實際約 1.2）', () => {
  const splits = [
    { date: '2024-07-25', ratio: 1.0200332, kind: 'stockDividend' },
    { date: '2025-07-22', ratio: 1.0101514, kind: 'stockDividend' },
  ]
  // 同一天的配股不算「之後」
  assert.equal(Math.round(income.actualPerShare({ date: '2024-07-25', amount: 1.188 }, splits) * 1000) / 1000, 1.2)
  assert.equal(income.actualPerShare({ date: '2025-07-22', amount: 1.2 }, splits), 1.2)
})

test('應收股利：依除息前一天的持股算；健保補充保費達門檻才扣；配股取整股；已記錄的對得上', () => {
  const history = {
    cash: [
      { date: '2025-01-10', amount: 1 }, // 買進前，不算
      { date: '2025-07-22', amount: 1.2 },
      { date: '2026-07-20', amount: 1.4 },
    ],
    splits: [{ date: '2025-07-22', ratio: 1.0101514, kind: 'stockDividend' }],
  }
  const trades = [
    { side: 'buy', quantity: 10, price: 30, date: '2025-03-01' },
    // 除息當天賣：除息前一天還持有，照樣領
    { side: 'sell', quantity: 2, price: 33, date: '2025-07-22' },
    { side: 'stockDividend', quantity: 0.101, price: 0, date: '2025-07-22' },
    { side: 'buy', quantity: 30, price: 32, date: '2026-01-05' },
  ]
  const dividends = [
    { amount: 11760, date: '2025-08-20', exDate: '2025-07-22' },
    // 手動記的、沒有 exDate，入帳日在除息後 75 天內 → 可能已記錄
    { amount: 50000, date: '2026-08-25', exDate: null },
  ]
  const result = income.computeEntitlements({ target: TW, trades, dividends, history, today: '2026-11-10', unit: 1000 })
  assert.equal(result.available, true)
  const [cash2025, stock2025, cash2026] = result.events
  // 10 張 × 1.2 = 12,000，未達 2 萬不扣
  assert.equal(cash2025.type, 'cash')
  assert.equal(cash2025.gross, 12000)
  assert.equal(cash2025.deduction, 0)
  assert.equal(cash2025.recorded, 'yes')
  // 配股：10,000 股 × 0.0101514 = 101.5 → 101 股；已有同日的配股紀錄
  assert.equal(stock2025.type, 'stock')
  assert.equal(stock2025.addShares, 101)
  assert.equal(stock2025.recorded, 'yes')
  // 2026：8 張 + 101 股 + 30 張 = 38,101 股 × 1.4 = 53,341.4，扣 2.11% = 1,126
  assert.equal(cash2026.shares, 38101)
  assert.equal(cash2026.gross, 53341.4)
  assert.equal(cash2026.deduction, 1126)
  assert.equal(cash2026.recorded, 'maybe')
  // 可能已記錄的是哪一筆（畫面「是同一筆」用）
  assert.equal(cash2026.matchIndex, 1)
  assert.equal(cash2025.matchIndex, null)
  assert.equal(result.unrecordedCash, 0)

  // 使用者刪掉的那一次：照樣算（標 dismissed），但不算進還沒記錄的合計
  const noRecords = income.computeEntitlements({ target: TW, trades, dividends: [], history, today: '2026-11-10', unit: 1000 })
  const dismissedOne = income.computeEntitlements({
    target: TW,
    trades,
    dividends: [],
    dismissed: [{ type: 'cash', exDate: noRecords.events[2].exDate }],
    history,
    today: '2026-11-10',
    unit: 1000,
  })
  assert.deepEqual(dismissedOne.events.map((e) => e.dismissed), [false, false, true])
  assert.equal(dismissedOne.events[2].net, noRecords.events[2].net)
  assert.equal(dismissedOne.unrecordedCash, Math.round((noRecords.unrecordedCash - noRecords.events[2].net) * 100) / 100)

  // 有一筆沒有日期：整檔不算
  const missing = income.computeEntitlements({
    target: TW,
    trades: [...trades, { side: 'buy', quantity: 1, price: 30, date: null }],
    dividends,
    history,
    today: '2026-11-10',
    unit: 1000,
  })
  assert.deepEqual([missing.available, missing.reason], [false, 'missingDates'])
})

test('應收股利：持有期間做過真正的分割要提醒；美股扣預扣稅', () => {
  const history = { cash: [{ date: '2026-02-09', amount: 0.26 }], splits: [{ date: '2025-06-18', ratio: 4, kind: 'split' }] }
  const result = income.computeEntitlements({
    target: US,
    trades: [{ side: 'buy', quantity: 100, price: 200, date: '2025-01-02' }],
    dividends: [],
    history,
    today: '2026-11-10',
    unit: 1,
  })
  assert.deepEqual(result.splitWarning, { date: '2025-06-18', ratio: 4 })
  assert.equal(result.events[0].gross, 26)
  assert.equal(result.events[0].net, 18.2)
  assert.equal(result.unrecordedCash, 18.2)
})

test('股利預估：已公告優先、本月已除息用實際、去年同月有配才推估（金額用近 12 個月平均）', () => {
  // 季配：近 12 個月 4 次，平均 (1 + 1.35 + 1.72 + 0.866)/4
  const history = {
    cash: [
      { date: '2025-10-21', amount: 0.866 },
      { date: '2026-01-19', amount: 0.866 },
      { date: '2026-04-20', amount: 1 },
      { date: '2026-07-20', amount: 1.35 },
      { date: '2026-10-21', amount: 1.72 },
    ],
    splits: [],
  }
  const announced = [{ date: '2027-01-19', cashDividend: 0.9, stockRatio: null }]
  const projection = income.projectDividends({
    target: { ...TW, code: '0056' },
    history,
    announced,
    shares: 20000,
    today: '2026-10-25',
    unit: 1000,
  })
  assert.equal(projection.months.length, 12)
  assert.equal(projection.months[0].month, '2026-10')
  // 本月已除息
  assert.equal(projection.months[0].cash.source, 'exDone')
  assert.equal(projection.months[0].cash.perShare, 1.72)
  // 2027-01 已公告 0.9：20,000 × 0.9 = 18,000（未達門檻）
  const jan = projection.months.find((m) => m.month === '2027-01')
  assert.deepEqual([jan.cash.source, jan.cash.net], ['announced', 18000])
  // 2027-04：推估，近 12 個月（2025-10-25 之後）4 次的平均
  const apr = projection.months.find((m) => m.month === '2027-04')
  assert.equal(apr.cash.source, 'estimated')
  assert.equal(apr.cash.perShare, Math.round(((0.866 + 1 + 1.35 + 1.72) / 4) * 1e6) / 1e6)
  // 去年沒配息的月份不推估
  assert.equal(projection.months.find((m) => m.month === '2026-11').cash, null)
  assert.equal(projection.frequency, 'quarterly')
  assert.equal(projection.hasEstimate, true)
})

test('股利預估：預告只有日期沒有金額 → 日期用預告、金額推估；Yahoo 先列出的未來配息當成已公告；配股只列已公告的', () => {
  const history = {
    cash: [
      { date: '2025-12-10', amount: 0.5 },
      { date: '2026-12-10', amount: 0.6 }, // 未來（Yahoo 先列出）
    ],
    splits: [],
  }
  const announced = [
    { date: '2027-03-15', cashDividend: null, stockRatio: null },
    { date: '2027-07-01', cashDividend: 1, stockRatio: 0.05 },
  ]
  const projection = income.projectDividends({ target: TW, history, announced, shares: 1500, today: '2026-11-10', unit: 1000 })
  const dec = projection.months.find((m) => m.month === '2026-12')
  assert.deepEqual([dec.cash.source, dec.cash.perShare], ['announced', 0.6])
  const mar = projection.months.find((m) => m.month === '2027-03')
  assert.deepEqual([mar.cash.source, mar.cash.exDate, mar.cash.perShare], ['estimated', '2027-03-15', 0.5])
  const jul = projection.months.find((m) => m.month === '2027-07')
  // 1,500 股 × 0.05 = 75 股
  assert.deepEqual([jul.stock.addShares, jul.stock.addQuantity], [75, 0.075])
})

test('股利預估（2026-11-10 實測回歸）：月配每月都推估、去年剛好今天除息不漏、本月已除息不重複算去年同月', () => {
  // 00929：Yahoo 上 3 月兩筆、2 月沒有 → 月配仍然 12 個月都有
  const monthly = {
    cash: ['2025-11-18', '2025-12-17', '2026-01-19', '2026-03-02', '2026-03-17', '2026-04-20', '2026-05-18', '2026-06-16', '2026-07-16', '2026-08-18', '2026-09-16', '2026-10-20'].map(
      (date) => ({ date, amount: 0.1 }),
    ),
    splits: [],
  }
  const m = income.projectDividends({ target: { ...TW, code: '00929' }, history: monthly, shares: 1000, today: '2026-11-10', unit: 1000 })
  assert.equal(m.frequency, 'monthly')
  assert.equal(m.months.filter((x) => x.cash).length, 12)

  // AAPL：去年 11 月的除息日剛好是一年前的今天 → 今年 11 月仍要推估
  const aapl = {
    cash: [
      { date: '2025-11-10', amount: 0.26 },
      { date: '2026-02-09', amount: 0.26 },
      { date: '2026-05-11', amount: 0.27 },
      { date: '2026-08-11', amount: 0.27 },
    ],
    splits: [],
  }
  const a = income.projectDividends({ target: US, history: aapl, shares: 10, today: '2026-11-10', unit: 1 })
  assert.equal(a.months[0].cash.source, 'estimated')
  assert.equal(a.frequency, 'quarterly')

  // 年配、本月已除息：平均只看今年這一次，不把去年同月算進來
  const annual = { cash: [{ date: '2025-07-22', amount: 1.2 }, { date: '2026-07-20', amount: 1.4 }], splits: [] }
  const y = income.projectDividends({ target: TW, history: annual, shares: 1000, today: '2026-07-25', unit: 1000 })
  assert.deepEqual([y.months[0].cash.source, y.months[0].cash.perShare, y.frequency], ['exDone', 1.4, 'annual'])
  // 年配、本月還沒除息（今年的還沒出現在 Yahoo）：去年同月有配 → 推估
  const lastYearOnly = { cash: [annual.cash[0]], splits: [] }
  const before = income.projectDividends({ target: TW, history: lastYearOnly, shares: 1000, today: '2026-07-05', unit: 1000 })
  assert.deepEqual([before.months[0].cash.source, before.months[0].cash.perShare], ['estimated', 1.2])
  // Yahoo 已經先列出今年的（在今天之後）→ 當成已公告
  const listed = income.projectDividends({ target: TW, history: annual, shares: 1000, today: '2026-07-05', unit: 1000 })
  assert.deepEqual([listed.months[0].cash.source, listed.months[0].cash.perShare], ['announced', 1.4])
})

test('月曆的推估日期：去年同月那天加一年，遇週末移到平日（月底移不出去就往前）', () => {
  const history = {
    cash: [
      { date: '2025-11-29', amount: 1 }, // 2026-11-29 是週日 → 11/30（一）
      { date: '2026-01-31', amount: 1 }, // 2027-01-31 是週日，往後會到 2 月 → 往前到 1/29（五）
    ],
    splits: [],
  }
  const p = income.projectDividends({ target: TW, history, shares: 1000, today: '2026-11-10', unit: 1000 })
  assert.equal(p.months.find((m) => m.month === '2026-11').cash.estimatedDate, '2026-11-30')
  assert.equal(p.months.find((m) => m.month === '2027-01').cash.estimatedDate, '2027-01-29')
})

test('月曆往前看：近 2 年的實際除息（當年金額）與配股，不含未來的', () => {
  const history = {
    cash: [
      { date: '2024-10-01', amount: 1 }, // 超過 2 年
      { date: '2024-11-20', amount: 1.188 }, // Yahoo 已依 2025 配股調整 → 還原約 1.2
      { date: '2026-12-01', amount: 2 }, // 未來
    ],
    splits: [{ date: '2025-07-22', ratio: 1.0101514, kind: 'stockDividend' }],
  }
  const report = income.buildIncomeReport({ items: [{ id: 'a', target: TW, trades: [], dividends: [], position: null, summary: null }], histories: [history], today: '2026-11-10' })
  const past = report.items[0].pastEvents
  assert.deepEqual(
    past.map((e) => [e.type, e.date]),
    [
      ['cash', '2024-11-20'],
      ['stock', '2025-07-22'],
    ],
  )
  assert.equal(Math.round(past[0].perShare * 100) / 100, 1.2)
})

test('填息：除息後收盤回到除息前收盤就算填息（天數含除息當天）；Yahoo 依配股調整過的價格要還原', () => {
  // 玉山金 2025-07-22 除權息（實測）：實際前收 34.20，Yahoo 日 K 是 33.861（÷ 1.0101514）
  const history = { cash: [{ date: '2025-07-22', amount: 1.2 }], splits: [{ date: '2025-07-22', ratio: 1.0101514, kind: 'stockDividend' }] }
  const bars = [
    { date: '2025-07-21', close: 33.861 },
    { date: '2025-07-22', close: 33.2 },
    { date: '2025-07-23', close: 34.1 },
    { date: '2025-07-24', close: 34.2 },
  ]
  const fills = income.computeFills({ history, bars, today: '2026-11-10' })
  assert.equal(fills.events[0].preClose, 34.2)
  // 34.1 還不夠（沒還原的話 33.861 會被誤判成 7/23 就填了），7/24 回到 34.2 → 第 3 個交易日
  assert.deepEqual([fills.events[0].filledOn, fills.events[0].days], ['2025-07-24', 3])

  // 還沒填：差多少、過了幾天
  const open = income.computeFills({ history: { cash: [{ date: '2026-10-22', amount: 1.72 }], splits: [] }, bars: [
    { date: '2026-10-21', close: 58.75 },
    { date: '2026-10-22', close: 56 },
    { date: '2026-10-23', close: 52.3 },
  ], today: '2026-11-10' })
  assert.deepEqual([open.events[0].filledOn, open.events[0].gap, open.events[0].daysSince], [null, 6.45, 2])
  assert.equal(open.avgDays, null)
})

test('除權息分頁：同一天的現金與配股合併成一列、配股換算成元、殖利率用除息前實際收盤、新到舊', () => {
  // 玉山金 2025-07-22 除權息（實測）：現金 1.2 元（Yahoo 已調整成 1.188）、配股 0.1 元（Yahoo 的比例 1.0101514 有雜訊，取 2 位小數）
  const history = {
    cash: [
      { date: '2024-11-20', amount: 1.188 },
      { date: '2025-07-22', amount: 1.2 },
    ],
    splits: [{ date: '2025-07-22', ratio: 1.0101514, kind: 'stockDividend' }],
  }
  const bars = [
    { date: '2024-11-19', close: 27.723 },
    { date: '2024-11-20', close: 27 },
    { date: '2025-07-21', close: 33.861 },
    { date: '2025-07-22', close: 33.2 },
    { date: '2025-07-23', close: 34.2 },
  ]
  const rows = income.buildDividendRecords({ history, bars, market: 'tw', today: '2026-11-10' })
  assert.deepEqual(rows.map((r) => [r.year, r.exDate]), [[2025, '2025-07-22'], [2024, '2024-11-20']])
  assert.equal(rows[0].cash, 1.2)
  assert.equal(rows[0].stock, 0.1)
  assert.equal(rows[0].preClose, 34.2)
  assert.equal(rows[0].yieldPct, 3.51)
  assert.deepEqual([rows[0].fill.filledOn, rows[0].fill.days], ['2025-07-23', 2])
  // 2024 年的現金股利乘回之後的配股：1.188 × 1.0101514 ≒ 1.2；前收也還原（27.723 × 1.0101514 ≒ 28.0）
  assert.equal(Math.round(rows[1].cash * 100) / 100, 1.2)
  assert.equal(rows[1].preClose, 28)
  assert.deepEqual([rows[1].fill.filledOn, rows[1].fill.days], ['2025-07-21', 2])

  // 美股沒有配股欄；抓不到股利歷史是 null、沒配過息是空陣列
  const us = income.buildDividendRecords({ history: { cash: [{ date: '2026-08-01', amount: 0.25 }], splits: [{ date: '2024-06-10', ratio: 10, kind: 'split' }] }, bars: [], market: 'us', today: '2026-11-10' })
  assert.deepEqual([us.length, us[0].stock, us[0].yieldPct, us[0].fill], [1, null, null, null])
  assert.equal(income.buildDividendRecords({ history: null, bars, market: 'tw', today: '2026-11-10' }), null)
  assert.deepEqual(income.buildDividendRecords({ history: { cash: [], splits: [] }, bars, market: 'tw', today: '2026-11-10' }), [])
})

test('報酬拆解：價差＋股利−手續費−稅−預估賣出成本＝總報酬（用真的 computePosition 算）', () => {
  const position = computePosition({
    target: TW,
    trades: [
      { side: 'buy', quantity: 2, price: 100, date: '2025-01-02' },
      { side: 'sell', quantity: 1, price: 120, date: '2025-06-02' },
    ],
    dividends: [{ amount: 3000, date: '2025-08-01' }],
    fees: { twDiscount: 1, twMinFee: 20, usFee: 0 },
    quote: { price: 130, change: 0, date: '2026-11-10' },
  })
  const report = income.buildIncomeReport({
    items: [{ id: 'a', target: TW, trades: [], dividends: [], position, summary: { quote: { price: 130 } } }],
    histories: [null],
    today: '2026-11-10',
  })
  const b = report.items[0].breakdown
  // 價差（未扣費用）：賣 1 張賺 20,000 ＋ 剩 1 張漲 30,000
  assert.equal(b.price, 50000)
  assert.equal(b.dividends, 3000)
  assert.ok(b.fees > 0 && b.tax > 0 && b.sellCost > 0)
  const sum = Math.round((b.price + b.dividends - b.fees - b.tax - b.sellCost) * 100) / 100
  assert.equal(sum, position.totalReturn)
  assert.deepEqual(report.totals.tw.breakdown, b)
  assert.deepEqual(report.totals.twd.breakdown, b)
})

test('Yahoo 金額的浮點雜訊四捨五入到小數 4 位（2330 的 5.000011 → 5）', () => {
  const parsed = income.parseYahooEvents({ dividends: { a: { amount: 5.000011, date: ts('2025-12-11') } } }, { market: 'tw', dateOf })
  assert.equal(parsed.cash[0].amount, 5)
})

test('整份報告：台股、美股分開合計，有匯率才併入台幣；沒有持股的也有每張一年股利', () => {
  const position = (fields) => ({ quantity: 1, costBasis: 1000, marketValue: 1200, unrealized: 200, realized: 0, dividends: 10, totalReturn: 210, ...fields })
  const items = [
    { id: 'a', target: TW, trades: [{ side: 'buy', quantity: 1, price: 1, date: '2026-01-02' }], dividends: [], position: position({}), summary: { quote: { price: 30 } } },
    { id: 'b', target: US, trades: [{ side: 'buy', quantity: 1, price: 1, date: '2026-01-02' }], dividends: [], position: position({ quantity: 10 }), summary: { quote: { price: 120 } } },
    { id: 'c', target: { ...TW, code: '2330', symbol: '2330.TW' }, trades: [], dividends: [], position: null, summary: { quote: { price: 1000 } } },
    { id: 'd', target: { market: 'us', kind: 'index', symbol: '^GSPC' }, trades: [], dividends: [], position: null, summary: null },
  ]
  const history = { cash: [{ date: '2026-03-10', amount: 2 }], splits: [] }
  const report = income.buildIncomeReport({ items, histories: [history, history, history, null], settings: null, usdTwd: 32, today: '2026-11-10' })
  assert.equal(report.totals.tw.count, 1)
  assert.equal(report.totals.us.count, 1)
  assert.equal(report.totals.twd.cost, 1000 + 1000 * 32)
  assert.equal(report.totals.twd.usIncluded, true)
  // 2330 沒持股：每張一年 2,000 元
  const tsmc = report.items.find((i) => i.id === 'c')
  assert.equal(tsmc.projection.annualPerUnit, 2000)
  assert.equal(tsmc.currentYield, 0.2)
  assert.equal(report.items.find((i) => i.id === 'd').dividendStatus, 'notStock')
  // 2027-03 的預估：台股 1,000 股 × 2 = 2,000；美股 10 股 × 2 × 0.7 = 14 美元 → 448 台幣
  const marIndex = report.months.indexOf('2027-03')
  assert.equal(report.totals.tw.monthly[marIndex], 2000)
  assert.equal(report.totals.twd.monthly[marIndex], 2000 + 14 * 32)
  // 這個月的都是推估
  assert.equal(report.totals.twd.monthlyEstimated[marIndex], 2000 + 14 * 32)

  const noFx = income.buildIncomeReport({ items, histories: [history, history, history, null], usdTwd: null, today: '2026-11-10' })
  assert.equal(noFx.totals.twd.usIncluded, false)
  assert.equal(noFx.totals.twd.cost, 1000)
})

test('年化報酬（XIRR）：一年漲 10% → 10%；中間配息也算進去；解不出來是 null', () => {
  const close = (value, expected) => assert.ok(Math.abs(value - expected) < 1e-6, `${value} ≠ ${expected}`)
  close(income.xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 110 }]), 0.1)
  // 每年配 5%、本金拿回：5%（一年用 365 天算，和 Excel 的 XIRR 一樣；跨閏年會略低）
  close(
    income.xirr([
      { date: '2025-01-01', amount: -1000 },
      { date: '2026-01-01', amount: 50 },
      { date: '2027-01-01', amount: 1050 },
    ]),
    0.05,
  )
  // 賠一半：-50%（左邊界附近也要解得出來）
  close(income.xirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: 50 }]), -0.5)
  assert.equal(income.xirr([{ date: '2025-01-01', amount: -100 }]), null)
})

test('整份報告的年化報酬：沒填日期、不到 90 天寫原因；合計有一檔算不出來就不算', () => {
  const base = { target: TW, summary: { quote: { price: 110 } }, dividends: [] }
  const position = { quantity: 1, costBasis: 100000, marketValue: 110000, sellCost: 0, unrealized: 10000, realized: 0, dividends: 0, totalReturn: 10000, trades: [{ fee: 0, tax: 0 }] }
  const ok = { ...base, id: 'ok', trades: [{ side: 'buy', quantity: 1, price: 100, date: '2025-11-10' }], position }
  const report = income.buildIncomeReport({ items: [ok], histories: [null], today: '2026-11-10' })
  assert.equal(report.items[0].annualized.pct, 10)
  assert.equal(report.totals.tw.annualized.pct, 10)

  const short = { ...base, id: 'short', trades: [{ side: 'buy', quantity: 1, price: 100, date: '2026-10-01' }], position }
  assert.equal(income.buildIncomeReport({ items: [short], histories: [null], today: '2026-11-10' }).items[0].annualized.reason, 'tooShort')

  const undated = { ...base, id: 'undated', trades: [{ side: 'buy', quantity: 1, price: 100, date: null }], position }
  const mixed = income.buildIncomeReport({ items: [ok, undated], histories: [null, null], today: '2026-11-10' })
  assert.equal(mixed.items[1].annualized.reason, 'missingDates')
  assert.deepEqual(mixed.totals.tw.annualized, { pct: null, reason: 'partial', blocked: 1 })
})

test('配股：成本 0、不收手續費，平均成本降低；當天配的不當成今天買進；之後可以賣掉', () => {
  const trades = [
    { side: 'buy', quantity: 1, price: 100, date: '2026-01-02' },
    { side: 'stockDividend', quantity: 0.1, price: 0, date: '2026-11-10' },
  ]
  const fees = { twDiscount: 1, twMinFee: 0, usFee: 0 }
  const position = computePosition({ target: TW, trades, fees, quote: { price: 110, change: 1, date: '2026-11-10' } })
  assert.equal(position.quantity, 1.1)
  // 成本 100,000 + 手續費 142 → 1,100 股
  assert.equal(position.costBasis, 100142)
  assert.equal(position.avgCost, Math.round((100142 / 1100) * 100) / 100)
  // 今日損益：1,100 股 × 漲 1 元（配股那筆不算成「今天 0 元買進」）
  assert.equal(position.today, 1100)
  assert.equal(position.openLots[1].stockDividend, true)
  assert.equal(validateSequence([...trades, { side: 'sell', quantity: 1.1, price: 120 }]), null)
  // 配股之前沒有持股：擋下（審查：會憑空多出成本 0 的股票）
  assert.match(validateSequence([{ side: 'stockDividend', quantity: 0.1, price: 0, date: '2026-01-01' }]), /配股之前沒有持股/)
})

// ---- API ----

function fakeWatches(docs) {
  return {
    find: (where) => ({ sort: async () => docs.filter((d) => d.user === where.user) }),
  }
}

function makeApp({ watches = [], groups = [], profile = null, summariesFail = false, service = {} } = {}) {
  let saved = profile
  const app = express()
  app.use(express.json())
  app.use(
    '/api/market',
    createMarketRouter({
      requireStockAccess: (req, _res, next) => {
        req.auth = { userId: 'u1' }
        next()
      },
      ensureDatabase: () => true,
      marketService: {
        getWatchSummaries: async (targets) => {
          if (summariesFail) throw new Error('報價來源掛了')
          return targets.map(() => ({ quote: { price: 40 } }))
        },
        getDividendHistories: async (targets) => targets.map(() => ({ cash: [], splits: [] })),
        getExDividendNotices: async () => new Map(),
        getQuote: async () => ({ price: 32 }),
        ...service,
      },
      MarketCall: {},
      MarketAlert: {},
      MarketWatch: fakeWatches(watches),
      MarketWatchGroup: { find: () => ({ sort: async () => groups }) },
      MarketProfile: {
        findOne: async () => saved,
        findOneAndUpdate: async (_filter, update) => {
          saved = { ...(saved || {}), ...update.$set }
          return saved
        },
      },
    }),
  )
  return app
}

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('API：獲利與股利依清單篩選，別人的清單回 404；扣款設定可以單獨存', async () => {
  const groupId = '507f1f77bcf86cd799439021'
  const watches = [
    {
      _id: 'w1',
      user: 'u1',
      target: TW,
      trades: [{ side: 'buy', quantity: 1, price: 30, date: '2026-01-02' }],
      dividends: [],
      dismissedEntitlements: [{ type: 'cash', exDate: '2026-07-01' }],
      groups: [groupId],
    },
    { _id: 'w2', user: 'u1', target: US, trades: [], dividends: [], groups: [] },
  ]
  const app = makeApp({ watches, groups: [{ _id: groupId, name: '存股', order: 0 }] })
  await withServer(app, async (base) => {
    const all = await (await fetch(`${base}/api/market/income`)).json()
    assert.equal(all.items.length, 2)
    // 刪掉的應收股利要帶回去：前端再刪一筆時以它為基底，少了會把之前刪的蓋掉（審查抓到）
    assert.deepEqual(all.items[0].dismissedEntitlements, [{ type: 'cash', exDate: '2026-07-01' }])
    assert.deepEqual(all.items[1].dismissedEntitlements, [])
    assert.ok(all.concentration)
    assert.equal(all.usdTwd, 32)
    assert.equal(all.months.length, 12)
    const one = await (await fetch(`${base}/api/market/income?group=${groupId}`)).json()
    assert.deepEqual(
      one.items.map((i) => i.id),
      ['w1'],
    )
    assert.equal((await fetch(`${base}/api/market/income?group=507f1f77bcf86cd799439099`)).status, 404)
    // 帶兩個 group：不默默當成全部
    assert.equal((await fetch(`${base}/api/market/income?group=a&group=b`)).status, 400)

    const put = (body) => fetch(`${base}/api/market/settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal((await put({})).status, 400)
    assert.equal((await put({ income: { nhi: true, nhiRate: 0.5, nhiThreshold: 20000, usWithholding: 0.3 } })).status, 400)
    const ok = await put({ income: { nhi: false, nhiRate: 0.0211, nhiThreshold: 20000, usWithholding: 0.1 } })
    assert.equal(ok.status, 200)
    const body = await ok.json()
    assert.equal(body.income.usWithholding, 0.1)
    assert.equal(body.fees.twMinFee, 20)
    const settings = await (await fetch(`${base}/api/market/settings`)).json()
    assert.equal(settings.income.nhi, false)
    // 除息前推播的開關（v20 階段 6）：預設關、可以單獨存
    assert.equal(settings.reminders.exDividend, false)
    assert.equal((await put({ reminders: { exDividend: 'yes' } })).status, 400)
    assert.equal((await put({ reminders: { exDividend: true } })).status, 200)
    assert.equal((await (await fetch(`${base}/api/market/settings`)).json()).reminders.exDividend, true)
    // 集中度門檻（v20 2.9.8）：預設 30／50，5～100 之外與字串回 400
    assert.deepEqual(settings.concentration, { holding: 30, industry: 50 })
    assert.equal((await put({ concentration: { holding: 4, industry: 50 } })).status, 400)
    assert.equal((await put({ concentration: { holding: 30, industry: 101 } })).status, 400)
    assert.equal((await put({ concentration: { holding: '30', industry: 50 } })).status, 400)
    assert.equal((await put({ concentration: { holding: 20, industry: 60 } })).status, 200)
    assert.deepEqual((await (await fetch(`${base}/api/market/settings`)).json()).concentration, { holding: 20, industry: 60 })
  })
})

test('API：報價來源失敗時獲利與股利照樣回應（市值相關是空的）', async () => {
  const watches = [{ _id: 'w1', user: 'u1', target: TW, trades: [{ side: 'buy', quantity: 1, price: 30, date: '2026-01-02' }], dividends: [], groups: [] }]
  await withServer(makeApp({ watches, summariesFail: true }), async (base) => {
    const response = await fetch(`${base}/api/market/income`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.items[0].price, null)
    assert.equal(body.totals.tw.missingQuote, 1)
  })
})

test('API：編輯持股時前端沒送 exDate，金額與入帳日相同的股利沿用原本的 exDate（審查：避免重複帶入）', async () => {
  const doc = {
    _id: 'w1',
    user: 'u1',
    target: TW,
    trades: [],
    dividends: [
      { amount: 12000, date: '2025-08-20', exDate: '2025-07-22' },
      { amount: 500, date: '2025-09-01', exDate: null },
    ],
    groups: [],
  }
  let saved = null
  const MarketWatch = {
    findOne: async () => doc,
    findOneAndUpdate: async (_q, update) => {
      saved = update.$set
      return { ...doc, ...update.$set }
    },
  }
  const app = express()
  app.use(express.json())
  app.use(
    '/api/market',
    createMarketRouter({
      requireStockAccess: (req, _res, next) => {
        req.auth = { userId: 'u1' }
        next()
      },
      ensureDatabase: () => true,
      marketService: { getWatchSummaries: async (targets) => targets.map(() => null) },
      MarketCall: {},
      MarketAlert: {},
      MarketWatch,
    }),
  )
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/market/watchlist/507f1f77bcf86cd799439031`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dividends: [{ amount: 12000, date: '2025-08-20' }, { amount: 500, date: '2025-09-01' }, { amount: 7, date: null }] }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(
      saved.dividends.map((d) => d.exDate),
      ['2025-07-22', null, null],
    )
  })
})

test('集中度：單一持股、單一產業超過門檻才提醒；ETF 不算產業；美股沒匯率不算；只有一檔不提醒', () => {
  const row = (id, market, code, value, name = code) => ({ id, target: { market, code, symbol: code, name }, quantity: 1, position: { marketValue: value } })
  const rows = [
    row('a', 'tw', '2330', 400, '台積電'),
    row('b', 'tw', '2454', 200, '聯發科'),
    row('c', 'tw', '0056', 400, '元大高股息'),
    row('d', 'us', 'KO', 10, 'Coca-Cola'),
    { id: 'e', target: { market: 'tw', code: '2884', name: '玉山金' }, quantity: 0, position: { marketValue: 0 } },
  ]
  const industries = new Map([
    ['2330', { code: '24', label: '半導體業' }],
    ['2454', { code: '24', label: '半導體業' }],
  ])
  const result = income.concentrationOf({ rows, usdTwd: null, industries, thresholds: { holding: 30, industry: 50 } })
  assert.equal(result.excludedUs, 1)
  assert.equal(result.total, 1000)
  assert.deepEqual(result.holdings.map((h) => [h.code, h.pct]), [['2330', 40], ['0056', 40], ['2454', 20]])
  assert.deepEqual(result.industries.map((g) => [g.label, g.pct]), [['半導體業', 60]])
  assert.equal(result.unclassifiedPct, 40)
  assert.deepEqual(result.warnings.map((w) => [w.type, w.key]), [['holding', 'a'], ['holding', 'c'], ['industry', '24']])

  // 有匯率：美股換成台幣算進去；門檻用預設（30／50）
  const withFx = income.concentrationOf({ rows, usdTwd: 30, industries })
  assert.equal(withFx.total, 1300)
  assert.deepEqual(withFx.thresholds, { holding: 30, industry: 50 })

  // 只有一檔：100% 但不提醒
  const single = income.concentrationOf({ rows: [rows[0]], industries })
  assert.equal(single.holdings[0].pct, 100)
  assert.deepEqual(single.warnings, [])
})

test('多年平均股利：依配息頻率取最近 N 次（年配 3、季配 12）÷ 年數；年配除息日前後漂移不會多算或少算；次數不夠退成 2 年、1 年；配股乘回實際金額', () => {
  const today = '2026-11-10'
  // 季配、每次 1 元，紀錄很長 → 最近 12 次 ÷ 3 ＝ 年平均 4 元
  const quarterly = { cash: [], splits: [] }
  for (let y = 2021; y <= 2026; y += 1) for (const m of ['01', '04', '07', '10']) quarterly.cash.push({ date: `${y}-${m}-15`, amount: 1 })
  assert.deepEqual(income.dividendAverageOf(quarterly, 50, today), { months: 36, perShare: 4, yieldPct: 8 })

  // 年配、今年還沒除息（11-15）、三年前在切點前幾天（2023-11-08）：最近 3 次 ＝ 2023、2024、2025，不會只抓到 2 次
  const lateThisYear = { cash: [{ date: '2022-11-09', amount: 9 }, { date: '2023-11-08', amount: 3 }, { date: '2024-11-12', amount: 3 }, { date: '2025-11-12', amount: 3 }], splits: [] }
  assert.equal(income.dividendAverageOf(lateThisYear, 100, today).perShare, 3)
  // 年配、今年提早到 11-01：期間內有 2023-11-12、2024、2025、2026 四次，只取最近 3 次，不會多算
  const earlyThisYear = { cash: [{ date: '2023-11-12', amount: 9 }, { date: '2024-11-12', amount: 3 }, { date: '2025-11-12', amount: 3 }, { date: '2026-11-01', amount: 3 }], splits: [] }
  assert.equal(income.dividendAverageOf(earlyThisYear, 100, today).perShare, 3)

  // 半年配、2025-01 才開始配：3 年要 6 次不夠 → 2 年：最近 4 次 (2+2+3+3) ÷ 2 ＝ 5
  const young = { cash: [{ date: '2025-01-15', amount: 2 }, { date: '2025-07-15', amount: 2 }, { date: '2026-01-15', amount: 3 }, { date: '2026-07-15', amount: 3 }], splits: [] }
  assert.deepEqual(income.dividendAverageOf(young, 100, today), { months: 24, perShare: 5, yieldPct: 5 })
  // 半年配、只有最近 2 次 → 1 年：3 ＋ 3；沒給價格就沒有殖利率
  const one = { cash: young.cash.slice(2), splits: [] }
  assert.deepEqual(income.dividendAverageOf(one, null, today), { months: 12, perShare: 6, yieldPct: null })
  // 中途從年配改季配（0056 這類）：近 1 年是季配，3 年要 12 次不夠、2 年要 8 次也不夠 → 只用 1 年，不會混進以前的大額年配
  const switched = { cash: [{ date: '2022-10-19', amount: 2.1 }, { date: '2023-07-18', amount: 1 }, { date: '2023-10-19', amount: 1.2 }, { date: '2024-01-16', amount: 0.7 }, { date: '2024-04-16', amount: 0.8 }, { date: '2024-07-16', amount: 1.07 }, { date: '2025-01-16', amount: 1.07 }, { date: '2026-01-15', amount: 0.866 }, { date: '2026-04-23', amount: 1 }, { date: '2026-07-21', amount: 1.35 }, { date: '2026-10-22', amount: 1.72 }], splits: [] }
  assert.equal(income.dividendAverageOf(switched, 50, today).months, 12)

  // 不滿 1 年、沒有紀錄
  assert.equal(income.dividendAverageOf({ cash: [{ date: '2024-03-01', amount: 1 }], splits: [] }, 10, today), null)
  assert.equal(income.dividendAverageOf(null, 10, today), null)
  // 年配、之後一拆四：之前的 1 元（Yahoo 已調整）還原成當時實際的 4 元
  const split = { cash: [{ date: '2023-06-15', amount: 1 }, { date: '2024-06-15', amount: 1 }, { date: '2025-06-15', amount: 1 }, { date: '2026-06-15', amount: 4 }], splits: [{ date: '2025-12-18', ratio: 4, kind: 'split' }] }
  // 最近 3 次：2024（4）、2025（4）、2026（4）→ 年平均 4
  assert.equal(income.dividendAverageOf(split, 100, today).perShare, 4)
})
test('API：存股試算自選一檔（不用先追蹤）：台股回殖利率與配息頻率；美股帶匯率；找不到 404、不是個股 400、缺參數 400', async () => {
  const quarterly = { cash: [], splits: [] }
  for (let y = 2022; y <= 2026; y += 1) for (const m of ['01', '04', '07', '10']) quarterly.cash.push({ date: `${y}-${m}-15`, amount: 0.5 })
  const AAPL = { market: 'us', kind: 'stock', symbol: 'AAPL', name: 'Apple' }
  const INDEX = { market: 'tw', kind: 'index', symbol: '^TWII', name: '加權指數' }
  const app = makeApp({
    service: {
      resolveTarget: async (q) => ({ '2884': TW, AAPL, TWII: INDEX })[q] ?? null,
      getDividendHistories: async () => [quarterly],
      getQuote: async (target) => ({ price: target.symbol === 'TWD=X' ? 32 : 40 }),
    },
  })
  await withServer(app, async (base) => {
    const tw = await (await fetch(`${base}/api/market/dividend-profile?market=tw&q=2884`)).json()
    assert.equal(tw.profile.target.code, '2884')
    assert.equal(tw.profile.price, 40)
    assert.equal(tw.profile.frequency, 'quarterly')
    assert.equal(tw.profile.usdTwd, null)
    // 近 36 個月每年 4 次 × 0.5 ＝ 2 元 ÷ 40 ＝ 5%
    assert.deepEqual(tw.profile.dividendAverage, { months: 36, perShare: 2, yieldPct: 5 })
    assert.ok(tw.profile.currentYield > 0)
    const us = await (await fetch(`${base}/api/market/dividend-profile?market=us&q=AAPL`)).json()
    assert.equal(us.profile.usdTwd, 32)
    assert.equal((await fetch(`${base}/api/market/dividend-profile?market=tw&q=9999`)).status, 404)
    assert.equal((await fetch(`${base}/api/market/dividend-profile?market=tw&q=TWII`)).status, 400)
    assert.equal((await fetch(`${base}/api/market/dividend-profile?market=jp&q=2884`)).status, 400)
    assert.equal((await fetch(`${base}/api/market/dividend-profile?market=tw`)).status, 400)
  })
})

test('API：存股試算自選一檔，股利紀錄或報價抓不到時照樣回應（dividendStatus failed、price null），不回 500', async () => {
  const app = makeApp({
    service: {
      resolveTarget: async () => TW,
      getDividendHistories: async () => [null],
      getQuote: async () => {
        throw new Error('報價來源掛了')
      },
    },
  })
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/market/dividend-profile?market=tw&q=2884`)
    assert.equal(response.status, 200)
    const { profile } = await response.json()
    assert.equal(profile.price, null)
    assert.equal(profile.dividendStatus, 'failed')
    assert.equal(profile.dividendAverage, null)
    assert.equal(profile.currentYield, null)
  })
})
