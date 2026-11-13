// 台灣時間的「今天」。交給 AI 的資料要寫明現在的日期（含星期），時間推算也從今天往後算。
// 2026-11-14 使用者回報：11 月問「還要多久」，AI 回答「今年夏末秋初」——它不知道今天是哪一天，把已經過去的月份當成未來。
const TIMEZONE = 'Asia/Taipei'
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

// 回傳 { year, month, day, weekday }（month 1～12、weekday 0＝星期日），以台灣時間為準
function taipeiDate(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
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

module.exports = { taipeiDate, formatTaipeiDate }
