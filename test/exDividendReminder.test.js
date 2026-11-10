// 除息前推播（v20 階段 6）：休市日、前一個交易日、該送哪些、訊息內容、排程去重與重試
const test = require('node:test')
const assert = require('node:assert/strict')

const reminder = require('../src/services/market/exDividendReminder')

// 2026-11-10 實際抓到的證交所休市日表（節錄）：「開始交易日」「最後交易日」那天有開市，不能當成休市
const HOLIDAY_ROWS = [
  { Name: '中華民國開國紀念日', Date: '1150101', Weekday: '四', Description: '依規定放假1日。' },
  { Name: '國曆新年開始交易日', Date: '1150102', Weekday: '五', Description: '國曆新年開始交易。' },
  { Name: '農曆春節前最後交易日', Date: '1150211', Weekday: '三', Description: '農曆春節前最後交易。<br>' },
  { Name: '臺灣光復暨金門古寧頭大捷紀念日', Date: '1151026', Weekday: '一', Description: '補假。' },
  { Name: '行憲紀念日', Date: '1151225', Weekday: '五', Description: '依規定放假1日。' },
]

test('休市日表：放假的才算休市，開始／最後交易日照常開市', () => {
  const days = reminder.parseHolidays(HOLIDAY_ROWS)
  assert.ok(days.has('2026-01-01'))
  assert.ok(days.has('2026-10-26'))
  assert.ok(!days.has('2026-01-02'))
  assert.ok(!days.has('2026-02-11'))
})

test('除息前最後一個交易日：跳過週末與休市日；休市日表取不到時只跳週末', () => {
  const days = reminder.parseHolidays(HOLIDAY_ROWS)
  // 週二除息 → 週一
  assert.equal(reminder.lastTradingDayBefore('2026-11-17', days), '2026-11-16')
  // 週一除息 → 上週五
  assert.equal(reminder.lastTradingDayBefore('2026-11-16', days), '2026-11-13')
  // 2026-10-27（二）除息，前一天 10/26（一）補假 → 10/23（五）
  assert.equal(reminder.lastTradingDayBefore('2026-10-27', days), '2026-10-23')
  assert.equal(reminder.lastTradingDayBefore('2026-10-27', null), '2026-10-26')
})

const watch = (code, trades = []) => ({ target: { market: 'tw', kind: 'stock', code, name: `股票${code}`, symbol: `${code}.TW` }, trades })

test('該送哪些：只看已公告、有金額或配股、而且今天是前一個交易日的', () => {
  const notices = new Map([
    ['2330', [{ date: '2026-11-17', cashDividend: 5, stockRatio: null }]],
    // 只有日期沒有金額（主動式 ETF 的預告）：不送
    ['00929', [{ date: '2026-11-17', cashDividend: null, stockRatio: null }]],
    // 還早
    ['2884', [{ date: '2026-11-20', cashDividend: 1.2, stockRatio: 0.01 }]],
  ])
  const due = reminder.dueReminders({ watches: [watch('2330'), watch('00929'), watch('2884')], notices, today: '2026-11-16', holidays: null })
  assert.deepEqual(
    due.map((d) => d.watch.target.code),
    ['2330'],
  )
})

test('訊息：明天除息寫「明天」，隔週末寫日期；有持股寫預估金額', () => {
  const event = { date: '2026-11-17', cashDividend: 5, stockRatio: null }
  const tomorrow = reminder.reminderMessage({ name: '台積電', code: '2330', event, quantity: 2, today: '2026-11-16' })
  assert.equal(tomorrow.title, '明天除息：台積電（2330）')
  assert.match(tomorrow.body, /今天收盤前持有才領得到/)
  // 推播會出現在鎖定畫面：不寫張數與金額（審查）
  assert.match(tomorrow.body, /你有持股/)
  assert.doesNotMatch(tomorrow.body, /2 張|10,000/)
  const afterWeekend = reminder.reminderMessage({ name: '玉山金', code: '2884', event: { date: '2026-11-16', cashDividend: 1.2, stockRatio: 0.01 }, quantity: 0, today: '2026-11-13' })
  assert.equal(afterWeekend.title, '11/16（一）除權息：玉山金（2884）')
  assert.match(afterWeekend.body, /每張配 10 股/)
  assert.doesNotMatch(afterWeekend.body, /你有持股/)
})

test('跨年：休市日表只有今年，元旦一律當休市；元旦後第一個交易日除息 → 12/31 提醒', () => {
  const thisYear = reminder.parseHolidays(HOLIDAY_ROWS)
  // 2027-01-04（一）除息：往前跳過週末與 2027-01-01（五）
  assert.equal(reminder.lastTradingDayBefore('2027-01-04', thisYear), '2026-12-31')
})

function makeRun({ open = true, sendOk = true, subscribed = ['u1'], holidays = new Set(), throwOnSend = false } = {}) {
  const claimed = new Set()
  const sent = []
  const deleted = []
  const run = reminder.createExDividendReminder({
    MarketProfile: { find: async () => [{ user: 'u1' }, { user: 'u2' }] },
    MarketWatch: { find: async () => [watch('2330', [{ side: 'buy', quantity: 2, price: 900, date: '2026-01-02' }])] },
    MarketReminder: {
      create: async ({ user, key }) => {
        const id = `${user}:${key}`
        if (claimed.has(id)) throw Object.assign(new Error('dup'), { code: 11000 })
        claimed.add(id)
      },
      deleteOne: async ({ user, key }) => {
        claimed.delete(`${user}:${key}`)
        deleted.push(key)
      },
    },
    User: { findById: async (id) => ({ _id: id, canUseStock: () => true }) },
    notifier: {
      subscriberIds: async () => subscribed,
      notifyUser: async (userId, message) => {
        sent.push([userId, message.title])
        if (throwOnSend) throw new Error('推播服務掛了')
        return sendOk
      },
    },
    marketService: {
      getTwHolidays: async () => holidays,
      getExDividendNotices: async () => new Map([['2330', [{ date: '2026-11-17', cashDividend: 5, stockRatio: null }]]]),
    },
    isMarketOpen: () => open,
    // 2026-11-16（一）09:10 台北
    now: () => new Date('2026-11-16T01:10:00Z'),
  })
  return { run, sent, deleted }
}

test('排程：只送有訂閱推播的人；同一次除息只送一次', async () => {
  const { run, sent } = makeRun()
  assert.deepEqual(await run.run(), { users: 2, sent: 1, failed: 0 })
  assert.deepEqual(sent, [['u1', '明天除息：股票2330（2330）']])
  // 下一次排程（10 分鐘後）：已經送過，不再送
  assert.deepEqual(await run.run(), { users: 2, sent: 0, failed: 0 })
  assert.equal(sent.length, 1)
})

test('排程：全部管道都送失敗就放掉，下一次再試；沒開盤不跑', async () => {
  const failing = makeRun({ sendOk: false })
  await failing.run.run()
  assert.deepEqual(failing.deleted, ['exDividend:2330:2026-11-17'])
  await failing.run.run()
  assert.equal(failing.sent.length, 2)

  const closed = makeRun({ open: false })
  assert.deepEqual(await closed.run.run(), { skipped: '台股沒有開盤' })

  // 休市日表抓不到：不猜，這一輪不送（審查）
  const noHolidays = makeRun({ holidays: null })
  assert.deepEqual(await noHolidays.run.run(), { skipped: '休市日表抓不到' })
  assert.equal(noHolidays.sent.length, 0)

  // 送的時候丟錯：放掉佔位，下一輪再試（不會卡在「已送過」）
  const throwing = makeRun({ throwOnSend: true })
  await throwing.run.run()
  assert.deepEqual(throwing.deleted, ['exDividend:2330:2026-11-17'])
})
