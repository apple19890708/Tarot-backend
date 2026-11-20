// AI 解讀寫完後的程式檢查（v25 階段 2）。不擋、不重寫，只把不合格的項目代碼記進紀錄，
// 之後依提示詞版本（PROMPT_VERSION）統計哪些規則常被違反。詳見 doc/v25-tarot-ai-quality-plan.md
const { taipeiDate } = require('./clock')

// 塔羅解讀與追問的提示詞版本。每次改 narrationService 的提示詞（SYSTEM_PROMPT、段落、FOLLOW_UP_PROMPT）就加 1，
// 存進紀錄後才分得出改版前後的檢查結果與回饋。1＝v25 之前（沒有記錄）、2＝v25 分段提示詞、
// 3＝時間線索不採用時不寫數字（2026-11-19）、4＝口語用詞與不寫「不在時間線上」（2026-11-19）、
// 5＝位置先對到問題、先決定牌在講誰、同名位置分組（2026-11-19）、6＝共用提示詞整理（合併重複、精簡，2026-11-19）、
// 7＝資料修正：二擇一的選項對應、該不該做的建議題、語氣校準取代影響力分析、數字階段不寫規則句（2026-11-19）
// 8＝資料判斷修正：時間題、前提子句、擔心題、領域關鍵詞、負面位置的指向說明（2026-11-19，50 題檢查）
// 9＝第四批 50 題的判斷修正：前提子句（沒有逗號、…之後）、擔心的事優先、我該…嗎、家人與身邊的人（2026-11-19）
// 10＝感受牌落在事實位的示範、是非題開場第一句不接保留（2026-11-19，3 次評估後）
// 11＝第五批 100 題的判斷修正：「…後」前提、要等…嗎、會更適合、選誰、各類關鍵詞（2026-11-19）
// 12＝第六批 500 題補的關鍵詞：出狀況、中斷、喊停、一直這樣下去（2026-11-19）
// 13＝第七批 10000 題：開場白＋前提子句的切法、告吹、解散、守得住、長久、應不應該、需不需要、是不是該、要等到…嗎（2026-11-19）
// 14＝第八批 10000 題：否定＋吧、口語尾音（嘛、ㄇ、齁）、還是＝仍然、期限說法（幾號、幾月、哪天）（2026-11-19）
// 15＝畫面與資料用詞口語化（照時間順序、其他位置、障礙說明、範例的推力改衝勁）（2026-11-20）
const PROMPT_VERSION = 15

const CHECK_CODES = [
  'missing-section',
  'yesno-first-line',
  'timing-no-date',
  'timing-past-date',
  'leaked-score',
  'removed-section',
  'foreign-script',
  'jargon',
  'too-short',
  'too-long',
  'truncated',
]

// 一般解讀與股市版必須有的段落（依序）。每個位置一節另外用張數檢查
const REQUIRED_SECTIONS = {
  narration: ['牌面速覽', '事件發展', '牌與牌的互動', '數字與元素', '最後的判斷'],
  market: ['牌面速覽', '事情會怎麼走', '情境與操作', '行情現況', '技術面判斷', '最後的判斷'],
  followUp: ['綜合來看'],
}

const headingsOf = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^##\s/.test(line))
    .map((line) => line.replace(/^##\s*/, '').trim())

function missingSection(text, variant, cardCount) {
  const headings = headingsOf(text)
  const positions = headings.map((title) => REQUIRED_SECTIONS[variant].findIndex((name) => title.startsWith(name)))
  const found = positions.filter((index) => index >= 0)
  // 每一節都要在，而且照順序
  if (new Set(found).size !== REQUIRED_SECTIONS[variant].length) return true
  if (found.some((index, order) => order > 0 && index < found[order - 1])) return true
  if (variant === 'followUp') return !headings.some((title) => /^追問\s*\d/.test(title))
  // 每個位置一節：「位置｜牌名」
  const positionSections = headings.filter((title) => title.includes('｜')).length
  return positionSections < cardCount
}

// 開場段落：跳過第一行的粗體牌面（「**錢幣二逆｜聖杯騎士逆**」），取第一個不是標題、表格的段落
function openingParagraph(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean)
  // 第一行整行粗體＝牌面（只有一張牌時沒有「｜」）
  const body = /^\*\*[^*]+\*\*$/.test(lines[0] || '') ? lines.slice(1) : lines
  const first = body[0] || ''
  return first.startsWith('#') || first.startsWith('|') ? '' : first
}

// 「會」前面是這些字時是名詞（機會、社會、約會…），不算回答
const YES_NO_ANSWER = /不會|不能|沒有|不是|傾向|拉扯|是的|建議|不要|該|(?<![機社約聚體開誤學協理領都])會|(?<![可功才])能(?!量|力)/

const LEAKED_SCORE = /[%％]|百分之|(?:分數|得分)\s*[：:為是]?\s*[-+−]?\d/
const LEAKED_SCORE_MARKET = /百分之|(?:分數|得分)\s*[：:為是]?\s*[-+−]?\d/

const JARGON = /助力|不在時間線|不算進走向/

const CHINESE_MONTHS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 }
const DATE_PATTERN = /\d{4}\s*年|\d{1,2}\s*月|(?:十[一二]?|[一二三四五六七八九])月|[一二三四五六七八九十兩半\d]+\s*(?:天|週|周|個月|個禮拜|年)|(?:春|夏|秋|冬)[天季末初]|年[初中底]|上半年|下半年/
// 季節最晚的月份（「今年夏天」在 9 月以後問就是已經過去）
const SEASON_END = { 春: 5, 夏: 8 }

// 講成「今年」但月份已經過去（11 月問，答「今年夏末秋初」）
function mentionsPastMonth(text, now) {
  const { month } = taipeiDate(now)
  for (const match of text.matchAll(/今年\s*(\d{1,2}|十[一二]?|[一二三四五六七八九])\s*月/g)) {
    const value = /\d/.test(match[1]) ? Number(match[1]) : CHINESE_MONTHS[match[1]]
    if (value && value < month) return true
  }
  for (const match of text.matchAll(/今年\s*(春|夏)/g)) {
    if (SEASON_END[match[1]] < month) return true
  }
  if (/今年\s*(?:年初|上半年)/.test(text) && month > 6) return true
  return false
}

// 字數：不算表格、標題符號與空白
function countChars(text) {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('|'))
    .join('')
    .replace(/[#*\-\s>`→]/g, '').length
}

function lengthRange(variant, cardCount, rounds) {
  if (variant === 'followUp') return [120, Math.max(1, rounds) * 450 + 500]
  const extra = Math.max(0, cardCount - 3) * 250
  return variant === 'market' ? [700, 3200 + extra] : [800, 3000 + extra]
}

/**
 * @param text AI 寫好的全文
 * @param options.kinds 問題類型（analyzeQuestionType 的 kinds）
 * @param options.cardCount 牌陣張數
 * @param options.market 是不是股市版（解讀時有附市場資料）
 * @param options.followUp 是不是追問的延伸回答；rounds 為這篇回答了幾次追問
 * @param options.now 現在時間（測試用）
 * @returns {string[]} 不合格的項目代碼（CHECK_CODES 的順序）；全部合格時為空陣列
 */
function checkNarration(text, { kinds = [], cardCount = 0, market = false, followUp = false, rounds = 0, now = new Date() } = {}) {
  const body = String(text || '').replace(/\r\n/g, '\n').trim()
  const variant = followUp ? 'followUp' : market ? 'market' : 'narration'
  const issues = new Set()

  if (missingSection(body, variant, cardCount)) issues.add('missing-section')
  if (!followUp && kinds.includes('yesNo') && !YES_NO_ANSWER.test(openingParagraph(body))) issues.add('yesno-first-line')
  if (kinds.includes('timing')) {
    if (!DATE_PATTERN.test(body)) issues.add('timing-no-date')
    if (mentionsPastMonth(body, now)) issues.add('timing-past-date')
  }
  // 股市版的表格本來就有漲跌幅百分比，只檢查分數。「分數」後面接數字才算（「考試分數會比預估漂亮」不算，2026-11-19 評估時誤判）
  if ((market ? LEAKED_SCORE_MARKET : LEAKED_SCORE).test(body)) issues.add('leaked-score')
  if (/你可以問自己/.test(body)) issues.add('removed-section')
  // 提示詞要求只用繁體中文：西里爾字母、日文假名
  if (/[Ѐ-ӿ぀-ヿ]/.test(body)) issues.add('foreign-script')
  // 書面或解讀規則的用詞（2026-11-19 使用者回報「助力」「不在時間線上」）
  if (JARGON.test(body)) issues.add('jargon')

  const [min, max] = lengthRange(variant, cardCount, rounds)
  const chars = countChars(body)
  if (chars < min) issues.add('too-short')
  if (chars > max) issues.add('too-long')

  // 結尾停在句子中間：最後一個字不是標點、括號、粗體或表格
  if (body && !/[。！？!?」』）)\].…*|：:~～]$/.test(body)) issues.add('truncated')

  return CHECK_CODES.filter((code) => issues.has(code))
}

module.exports = { checkNarration, CHECK_CODES, countChars, PROMPT_VERSION }
