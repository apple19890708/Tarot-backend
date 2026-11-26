// 台灣時間的「今天」。交給 AI 的資料要寫明現在的日期（含星期），時間推算也從今天往後算。
// 2026-11-14 使用者回報：11 月問「還要多久」，AI 回答「今年夏末秋初」——它不知道今天是哪一天，把已經過去的月份當成未來。
const { dateTimeFormat } = require('../lib/intlFormat')

const TIMEZONE = 'Asia/Taipei'
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

// 回傳 { year, month, day, weekday }（month 1～12、weekday 0＝星期日），以台灣時間為準
function taipeiDate(now = new Date()) {
  // 用共用的 dateTimeFormat（快取同一組設定），不要每次 new Intl.DateTimeFormat（CLAUDE.md 記憶體）
  const parts = Object.fromEntries(
    dateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  )
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday)
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday }
}

// 「2026 年 11 月 14 日（星期六）」
function formatTaipeiDate(now = new Date()) {
  const { year, month, day, weekday } = taipeiDate(now)
  return `${year} 年 ${month} 月 ${day} 日（星期${WEEKDAYS[weekday]}）`
}

// 台灣時間今天 00:00（每日次數、冷卻用）。v29 從 routes/marketAnalysis 搬來：service 不要反過來依賴 route
function startOfTaipeiDay(nowMs) {
  const ymd = dateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs))
  return new Date(`${ymd}T00:00:00+08:00`)
}

module.exports = { taipeiDate, formatTaipeiDate, startOfTaipeiDay }
