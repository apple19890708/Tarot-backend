const test = require('node:test')
const assert = require('node:assert/strict')

const { snapshotDue, buildSnapshot, timeWeightedReturns, benchmarkReturns } = require('../src/services/market/snapshots')

test('快照時間：平日台北 14:00 之後才記，週末不記', () => {
  assert.equal(snapshotDue(new Date('2026-11-05T05:30:00Z')), null) // 台北 13:30
  assert.equal(snapshotDue(new Date('2026-11-05T06:10:00Z')), '2026-11-05') // 台北 14:10
  assert.equal(snapshotDue(new Date('2026-11-05T17:00:00Z')), null) // 台北隔天（週五）01:00，還沒收盤
  assert.equal(snapshotDue(new Date('2026-11-07T08:00:00Z')), null) // 週六
})

test('快照加總：各市場原幣加總，台幣總額用匯率換算；沒報價的用成本代替', () => {
  const snapshot = buildSnapshot(
    [
      { market: 'tw', position: { costBasis: 1000, marketValue: 1200, realized: 50, dividends: 10 } },
      { market: 'tw', position: { costBasis: 500, marketValue: null, realized: 0, dividends: 0 } },
      { market: 'us', position: { costBasis: 100, marketValue: 110, realized: 5, dividends: 1 } },
      { market: 'us', position: null },
    ],
    32,
  )
  assert.deepEqual(snapshot.tw, { value: 1700, cost: 1500, realized: 50, dividends: 10 })
  assert.deepEqual(snapshot.us, { value: 110, cost: 100, realized: 5, dividends: 1 })
  assert.deepEqual(snapshot.total, { value: 1700 + 3520, cost: 1500 + 3200, realized: 50 + 160, dividends: 10 + 32 })

  // 沒有匯率：美股不併入台幣總額
  assert.equal(buildSnapshot([{ market: 'us', position: { costBasis: 100, marketValue: 110, realized: 0, dividends: 0 } }], null).total.value, 0)
})

test('時間加權報酬：加碼與賣出不算賺賠，股利算報酬', () => {
  const snap = (date, value, cost, realized = 0, dividends = 0) => ({ date, total: { value, cost, realized, dividends } })
  const points = timeWeightedReturns([
    snap('2026-11-02', 1000, 1000),
    snap('2026-11-03', 1100, 1000), // +10%
    snap('2026-11-04', 2100, 2000), // 加碼 1000，市值同步增加 → 0%
    snap('2026-11-05', 1050, 1000, 50), // 賣掉一半：拿回 1050（成本 1000 + 已實現 50），剩下的沒變 → 0%
    snap('2026-11-06', 1050, 1000, 50, 21), // 收到股利 21（以前一天市值 1050 計 2%）
  ])
  assert.deepEqual(
    points.map((p) => p.returnPct),
    [0, 10, 10, 10, 12.2],
  )
})

test('大盤比較：從第一筆快照的日期起算，沒交易的日子沿用前一天', () => {
  const bars = [
    { date: '2026-11-02', close: 100 },
    { date: '2026-11-03', close: 110 },
    { date: '2026-11-05', close: 99 },
  ]
  assert.deepEqual(benchmarkReturns(bars, ['2026-11-02', '2026-11-04', '2026-11-05']), [
    { date: '2026-11-02', returnPct: 0 },
    { date: '2026-11-04', returnPct: 10 },
    { date: '2026-11-05', returnPct: -1 },
  ])
  assert.deepEqual(benchmarkReturns([], ['2026-11-02']), [])
})
