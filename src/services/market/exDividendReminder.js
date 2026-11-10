// 除息前推播（v20 階段 6）：在除息（除權）日前的最後一個交易日開盤時段，提醒「今天收盤前持有才領得到」。
// 只用證交所／櫃買已公告的除權息預告（推估的不提醒）；只對開了這個提醒、而且有設推播的會員，針對他追蹤的台股。
// 純函式在上面，排程呼叫的 createExDividendReminder 在下面；同一位會員、同一檔、同一次除息只送一次（MarketReminder 唯一索引）。
const { computePosition, tradesOf } = require('./portfolio')
const { rocDate } = require('./corporateEvents')

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

// 證交所休市日表 → 不交易的日期 Set。表上也列了「開始交易日」「最後交易日」（那天有開市），要排除
function parseHolidays(rows) {
  const days = new Set()
  for (const row of rows || []) {
    const date = rocDate(row.Date)
    if (!date) continue
    if (/(開始|最後)交易/.test(`${row.Name || ''}`)) continue
    days.add(date)
  }
  return days
}

const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
const weekdayOf = (date) => new Date(`${date}T00:00:00Z`).getUTCDay()

// 週一到週五、而且不在休市日表上（表取不到時 holidays 是 null，只看週末）。
// 休市日表只有今年：12 月底往後算到明年時查不到元旦，所以 1/1 一律當休市（v20 審查：元旦後第一個交易日除息會漏送）
function isTradingDay(date, holidays) {
  const day = weekdayOf(date)
  if (day === 0 || day === 6) return false
  if (date.endsWith('-01-01')) return false
  return !(holidays && holidays.has(date))
}

// 除息日前的最後一個交易日（最多往前找 20 天，避免資料異常時無限迴圈）
function lastTradingDayBefore(exDate, holidays) {
  let date = addDays(exDate, -1)
  for (let i = 0; i < 20; i += 1) {
    if (isTradingDay(date, holidays)) return date
    date = addDays(date, -1)
  }
  return null
}

// 今天要提醒的：watches 是這位會員追蹤的台股（含持股），notices 是 Map<代號, 預告事件[]>
// → [{ watch, event, quantity }]；只挑有現金股利或配股的預告
function dueReminders({ watches, notices, today, holidays }) {
  if (!notices) return []
  const due = []
  for (const watch of watches) {
    const { target } = watch
    if (target.market !== 'tw' || target.kind !== 'stock' || !target.code) continue
    for (const event of notices.get(target.code) ?? []) {
      if (!event.cashDividend && !event.stockRatio) continue
      if (event.date <= today) continue
      if (lastTradingDayBefore(event.date, holidays) !== today) continue
      due.push({ watch, event })
    }
  }
  return due
}

const formatMoney = (value) => Math.round(value).toLocaleString('en-US')
const formatRatio = (value) => Number(value.toFixed(6)).toString()

// 推播內容。quantity 是目前持有的張數（0＝只是追蹤）
function reminderMessage({ name, code, event, quantity, today }) {
  const tomorrow = addDays(today, 1) === event.date
  const when = tomorrow ? '明天' : `${Number(event.date.slice(5, 7))}/${Number(event.date.slice(8))}（${WEEKDAYS[weekdayOf(event.date)]}）`
  const kind = event.cashDividend && event.stockRatio ? '除權息' : event.stockRatio ? '除權' : '除息'
  const parts = []
  if (event.cashDividend) parts.push(`每股現金股利 ${event.cashDividend} 元（每張約 ${formatMoney(event.cashDividend * 1000)} 元）`)
  if (event.stockRatio) parts.push(`每股配 ${formatRatio(event.stockRatio)} 股（每張配 ${formatMoney(event.stockRatio * 1000)} 股）`)
  let held = ''
  // 推播會出現在鎖定畫面（共用裝置、登出後也還會收到），所以不寫持股張數與金額，只說「你有持股」，細節點進去看（v20 審查）
  if (quantity > 0) held = '你有持股，點開看預估可領多少。'
  return {
    title: `${when}${kind}：${name}（${code}）`,
    body: `今天收盤前持有才領得到。${parts.join('；')}。${held}`,
    url: 'market?tab=income',
  }
}

const TAIPEI = 'Asia/Taipei'
function taipeiDate(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TAIPEI, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

// 排程（/api/cron/market，台股盤中每 10 分鐘）呼叫。盤中才跑，第一次跑到（約 9 點）就送出
function createExDividendReminder({ MarketProfile, MarketWatch, MarketReminder, User, notifier, marketService, isMarketOpen, now = () => new Date() }) {
  async function run() {
    const at = now()
    if (!isMarketOpen('tw', at)) return { skipped: '台股沒有開盤' }
    const today = taipeiDate(at)
    const profiles = await MarketProfile.find({ 'reminders.exDividend': true })
    if (!profiles.length) return { users: 0, sent: 0 }
    const [holidays, notices, subscribers] = await Promise.all([
      marketService.getTwHolidays().catch(() => null),
      marketService.getExDividendNotices({ requireComplete: true }).catch(() => null),
      notifier.subscriberIds(),
    ])
    // 休市日表抓不到時不猜：國定假日排程照跑，只看週末會在不開盤的日子送「今天收盤前持有」；寧可這一輪不送（v20 審查）
    if (!holidays) return { skipped: '休市日表抓不到' }
    if (!isTradingDay(today, holidays)) return { skipped: '今天休市' }
    if (!notices) return { skipped: '除權息預告抓不到或不完整' }
    const subscribed = new Set(subscribers.map(String))

    let sent = 0
    let failed = 0
    for (const profile of profiles) {
      const userId = profile.user
      if (!subscribed.has(String(userId))) continue
      // 每位會員各自處理：一個人查詢失敗不影響其他人（下一輪會再試）
      try {
        const user = await User.findById(userId)
        // 停用或被收回股市權限的不送（canUseStock 已含停用判斷）
        if (!user || !user.canUseStock()) continue
        const watches = await MarketWatch.find({ user: userId, 'target.market': 'tw', 'target.kind': 'stock' })
        for (const { watch, event } of dueReminders({ watches, notices, today, holidays })) {
          const key = `exDividend:${watch.target.code}:${event.date}`
          // 先搶下這一筆（唯一索引）：重疊執行的排程只會有一個送出
          try {
            await MarketReminder.create({ user: userId, key })
          } catch (error) {
            if (error?.code === 11000) continue
            throw error
          }
          // 搶下之後任何一步出錯（含全部管道送失敗）都放掉，下一次排程再試；不然會一直卡在「已送過」
          let delivered = false
          try {
            const quantity = computePosition({ target: watch.target, trades: tradesOf(watch) }).quantity
            const message = reminderMessage({ name: watch.target.name, code: watch.target.code, event, quantity, today })
            delivered = await notifier.notifyUser(userId, message)
          } catch (error) {
            console.error('除息前推播失敗：', error.message)
          }
          if (delivered) sent += 1
          else await MarketReminder.deleteOne({ user: userId, key }).catch((error) => console.error('提醒紀錄放不掉：', error.message))
        }
      } catch (error) {
        failed += 1
        console.error('除息前推播（單一會員）失敗：', error.message)
      }
    }
    return { users: profiles.length, sent, failed }
  }
  return { run }
}

module.exports = {
  parseHolidays,
  isTradingDay,
  lastTradingDayBefore,
  dueReminders,
  reminderMessage,
  createExDividendReminder,
  addDays,
}
