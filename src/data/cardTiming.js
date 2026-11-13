// 規則 13：時間類問題（多久、什麼時候、何時…）的推算依據。詳見 doc/v23-tarot-yes-no-followup-plan.md 的 2.6
//
// 塔羅的時間推算沒有統一標準，這裡採用最常見的一套（2026-11-13 查網路上的定義，加上使用者提供的參考）：
// - 小牌：花色決定單位，數字決定數量（王牌＝1）。權杖＝天、寶劍＝週、聖杯＝月、錢幣＝年。
//   花色另有季節：權杖春、聖杯夏、寶劍秋、錢幣冬。
// - 宮廷牌：看速度（騎士最快、國王最慢），單位同花色，不給數量。
// - 大牌：有黃道星座的用星座的日期區間（金色黎明對應）；對應行星或元素的，給速度的描述。
// - 逆位：延遲、比正位推算的時間更久，或要等阻礙先解除。
// 這些只是傳統的推算方式，給 AI 當成「大約的時間點」，不是保證。

const SUIT_TIMING = {
  wands: { unit: '天', season: '春天', pace: '很快，行動一動就有結果' },
  swords: { unit: '週', season: '秋天', pace: '快而突然，常是一個決定或消息之後' },
  cups: { unit: '個月', season: '夏天', pace: '中等，跟著心情與關係慢慢變化' },
  pentacles: { unit: '年', season: '冬天', pace: '慢，要累積、按部就班' },
}

const COURT_PACE = {
  page: '剛起步，要先等一個消息或第一步',
  knight: '很快，事情會突然動起來',
  queen: '穩定醞釀，不急但會到',
  king: '成熟、進展慢，要等局面定下來',
}

// 大牌：星座的日期區間（約略，各年差一兩天），或沒有星座時的速度描述
const MAJOR_TIMING = {
  emperor: { sign: '牡羊座', range: '3 月下旬到 4 月中旬', start: 3, end: 4 },
  hierophant: { sign: '金牛座', range: '4 月下旬到 5 月中旬', start: 4, end: 5 },
  lovers: { sign: '雙子座', range: '5 月下旬到 6 月中旬', start: 5, end: 6 },
  chariot: { sign: '巨蟹座', range: '6 月下旬到 7 月中旬', start: 6, end: 7 },
  strength: { sign: '獅子座', range: '7 月下旬到 8 月中旬', start: 7, end: 8 },
  hermit: { sign: '處女座', range: '8 月下旬到 9 月中旬', start: 8, end: 9 },
  justice: { sign: '天秤座', range: '9 月下旬到 10 月中旬', start: 9, end: 10 },
  death: { sign: '天蠍座', range: '10 月下旬到 11 月中旬', start: 10, end: 11 },
  temperance: { sign: '射手座', range: '11 月下旬到 12 月中旬', start: 11, end: 12 },
  devil: { sign: '摩羯座', range: '12 月下旬到 1 月中旬', start: 12, end: 1 },
  star: { sign: '水瓶座', range: '1 月下旬到 2 月中旬', start: 1, end: 2 },
  moon: { sign: '雙魚座', range: '2 月下旬到 3 月中旬', start: 2, end: 3 },
  fool: { pace: '突然、出乎意料，說來就來' },
  magician: { pace: '很快，條件備齊就能啟動' },
  highpriestess: { pace: '還在檯面下，要等時機自己浮現' },
  empress: { pace: '慢慢成熟，像懷胎一樣需要孕育期' },
  wheeloffortune: { pace: '轉折點，局勢一翻就變' },
  wheel: { pace: '轉折點，局勢一翻就變' },
  hangedman: { pace: '暫停、延後，要先等待' },
  tower: { pace: '突然、毫無預警' },
  sun: { pace: '很快、明朗' },
  judgement: { pace: '一個召喚或消息之後就定案' },
  judgment: { pace: '一個召喚或消息之後就定案' },
  world: { pace: '一個完整的循環走完才會到，偏長' },
}

const MAJOR_ZH_TO_KEY = {
  愚者: 'fool',
  愚人: 'fool',
  魔術師: 'magician',
  女祭司: 'highpriestess',
  皇后: 'empress',
  女皇: 'empress',
  皇帝: 'emperor',
  教皇: 'hierophant',
  戀人: 'lovers',
  戰車: 'chariot',
  力量: 'strength',
  隱士: 'hermit',
  命運之輪: 'wheeloffortune',
  正義: 'justice',
  吊人: 'hangedman',
  倒吊人: 'hangedman',
  死神: 'death',
  節制: 'temperance',
  惡魔: 'devil',
  塔: 'tower',
  星星: 'star',
  月亮: 'moon',
  太陽: 'sun',
  審判: 'judgement',
  世界: 'world',
}

const CHINESE_NUMBERS = ['', '一', '兩', '三', '四', '五', '六', '七', '八', '九', '十']

// ---- 從今天往後換算成實際日期（2026-11-14 使用者回報：AI 不知道今天，把已經過去的月份講成未來）----
// today：{ year, month, day }（台灣時間，見 services/clock.js 的 taipeiDate）

// 星座期間離今天最近的一次：還沒到就是今年（跨年的摩羯座算到隔年），正在期間內就是現在，過了就是明年
function nextSignWindow(start, end, today) {
  const { year, month, day } = today
  const crossesYear = end < start
  // 期間：start 月 21 日前後到 end 月 19 日前後
  const inWindow = crossesYear
    ? (month === start && day >= 21) || month > start || month < end || (month === end && day <= 19)
    : (month === start && day >= 21) || (month > start && month < end) || (month === end && day <= 19)
  if (inWindow) {
    const endYear = crossesYear && month >= start ? year + 1 : year
    return `就是現在這段期間（到 ${endYear} 年 ${end} 月中旬）`
  }
  const startYear = month < start || (month === start && day < 21) ? year : year + 1
  const endYear = crossesYear ? startYear + 1 : startYear
  return `離現在最近的一次是 ${startYear} 年 ${start} 月下旬到${endYear === startYear ? '' : ` ${endYear} 年`} ${end} 月中旬`
}

// 小牌：從今天加上 數量 × 單位，給大約落在哪一天（天、週）、哪個月（月）或哪一年（年）
function approximateDate(unit, amount, today) {
  const date = new Date(Date.UTC(today.year, today.month - 1, today.day))
  if (unit === '天') date.setUTCDate(date.getUTCDate() + amount)
  else if (unit === '週') date.setUTCDate(date.getUTCDate() + amount * 7)
  else if (unit === '個月') date.setUTCMonth(date.getUTCMonth() + amount)
  else if (unit === '年') date.setUTCFullYear(date.getUTCFullYear() + amount)
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + 1
  const d = date.getUTCDate()
  if (unit === '年') return `${y} 年前後`
  if (unit === '個月') return `${y} 年 ${m} 月前後`
  return `${y} 年 ${m} 月 ${d} 日前後`
}

function normalizeNameEn(nameEn) {
  return String(nameEn || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z]/g, '')
}

/**
 * 一張牌的時間線索。回傳 { kind, text, unit?, amount?, season? }；查不到回傳 null。
 * text 是給 AI 的一句話，例如「約三天（春天，…），從今天算約在 2026 年 11 月 17 日前後」
 * today：台灣時間的今天（{ year, month, day }）；有給才換算成實際日期
 */
function getCardTiming(card, profile, orientation, today = null) {
  const reversed = orientation === 'reversed'
  const delay = reversed ? '；逆位代表延遲，會比這更久或要等阻礙先解除' : ''

  if (profile.kind === 'major') {
    const timing =
      MAJOR_TIMING[normalizeNameEn(card.nameEn)] || MAJOR_TIMING[MAJOR_ZH_TO_KEY[String(card.nameZh || '').trim()]]
    if (!timing) return null
    if (timing.sign) {
      const when = today ? `，${nextSignWindow(timing.start, timing.end, today)}` : ''
      return { kind: 'major', text: `${timing.sign}的期間，約 ${timing.range}${when}${delay}`, range: timing.range }
    }
    return { kind: 'major', text: `${timing.pace}${delay}` }
  }

  const suit = SUIT_TIMING[profile.suit]
  if (!suit) return null
  if (profile.kind === 'court') {
    return { kind: 'court', text: `${COURT_PACE[profile.courtRank] || '看人怎麼行動'}（以${suit.unit}計，${suit.season}）${delay}`, unit: suit.unit, season: suit.season }
  }
  const amount = profile.pipNumber
  if (!Number.isInteger(amount) || amount < 1 || amount > 10) return null
  return {
    kind: 'pip',
    text: `約${CHINESE_NUMBERS[amount]}${suit.unit}（${suit.season}，${suit.pace}）${today ? `，從今天算約在 ${approximateDate(suit.unit, amount, today)}` : ''}${delay}`,
    unit: suit.unit,
    amount,
    season: suit.season,
  }
}

module.exports = { SUIT_TIMING, COURT_PACE, MAJOR_TIMING, getCardTiming }
