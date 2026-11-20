// 每日一牌與月曆（v26 計畫 1）：日期、連續天數、牌面內容。純函式，不碰資料庫，方便測試。
// 每日一牌不呼叫 AI：內容只取現有牌義的「核心訊息」與「行動建議」第一句（文字由後端給，前端不組句子）
const { taipeiDate } = require('./clock')
const { parseMeaningGroups, getCoreMessage } = require('./meaningSections')

// 台北時間的日期字串 YYYY-MM-DD
function taipeiDayKey(now = new Date()) {
  const { year, month, day } = taipeiDate(now)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// 前一天（日期字串運算，用 UTC 中午避開換日問題）
function previousDay(key) {
  const date = new Date(`${key}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

// 「2026-11」→ 這個月在台北時間的起訖（台灣沒有夏令時間，固定 +08:00）。格式不對回傳 null
function monthRange(month) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''))
  if (!match) return null
  const year = Number(match[1])
  const index = Number(match[2])
  if (index < 1 || index > 12 || year < 2000 || year > 2100) return null
  const next = index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`
  return {
    month: `${match[1]}-${match[2]}`,
    start: new Date(`${match[1]}-${match[2]}-01T00:00:00+08:00`),
    end: new Date(`${next}-01T00:00:00+08:00`),
    firstDay: `${match[1]}-${match[2]}-01`,
    // 字串比較用的上界（不含）：下個月 1 號
    nextFirstDay: `${next}-01`,
  }
}

// 連續天數：從今天往回數（今天還沒抽就從昨天數，今天沒抽不算斷）
function streakOf(dates, today) {
  const set = new Set(dates)
  let cursor = set.has(today) ? today : previousDay(today)
  let count = 0
  while (set.has(cursor)) {
    count += 1
    cursor = previousDay(cursor)
  }
  return count
}

function sectionOf(card, orientation) {
  const lines = card.sections?.[orientation === 'upright' ? '正位牌義' : '逆位牌義']
  return Array.isArray(lines) ? lines.filter(Boolean) : []
}

// 交給前端的每日一牌：牌面基本資料＋一句核心訊息＋一句今天可以做的事
function dailyCardView(card, orientation, date) {
  const groups = parseMeaningGroups(sectionOf(card, orientation))
  const advice = groups.find((group) => ['行動建議', '調整建議'].includes(group.heading))?.lines[0] || ''
  return {
    date,
    orientation,
    card: {
      id: String(card._id),
      nameZh: card.nameZh,
      nameEn: card.nameEn || '',
      image: card.image || '',
      suit: card.suit || null,
      arcanaType: card.arcanaType || null,
      keywords: (card.keywords || []).slice(0, 5),
    },
    message: getCoreMessage(groups),
    advice,
  }
}

module.exports = { taipeiDayKey, previousDay, monthRange, streakOf, dailyCardView }
