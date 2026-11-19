// 問題類型（v25 階段 1）：決定系統提示要放哪幾段規則，也記在 analysis.questionType 交給 AI。
// 只用程式判斷，不呼叫 AI。詳見 doc/v25-tarot-ai-quality-plan.md
const { detectYesNo } = require('./yesNoRules')
const { isTimingQuestion } = require('./timingRules')
const { YES_NO } = require('../../data/ruleConfig')

// 選擇題：在兩個以上的選項之間選（「A 還是 B」「選哪一個」）。
// 「還是」也有「仍然」的意思（「他還是會回來嗎」「我還是放不下」），前面是人稱或副詞時不算選擇
const CHOICE_PATTERN = /或是|哪一個|哪一間|哪一份|哪個(?!月|時候)|哪間|哪份|哪邊|選哪|選誰|哪一位|哪位|二選一|三選一/
const STILL_BEFORE = /(?:我|你|妳|他|她|它|們|也|都|卻|但|就|而|仍)$/
// 「還是」後面接這些字也是「仍然」（「事情還是沒進展」「公司還是會裁員嗎」）。「不」不算：「去還是不去」是選擇
const STILL_AFTER = /^(?:沒|會|很|在|一樣|那麼|這樣|放不下|愛(?!情)|喜歡|單身|覺得)/

function isChoiceQuestion(question) {
  const text = String(question || '')
  if (CHOICE_PATTERN.test(text)) return true
  let from = 0
  for (;;) {
    const at = text.indexOf('還是', from)
    if (at < 0) return false
    // 「還是」前後都要有內容（「A 還是 B」），而且前面不是人稱或副詞
    if (at > 0 && at + 2 < text.length && !STILL_BEFORE.test(text.slice(0, at)) && !STILL_AFTER.test(text.slice(at + 2))) return true
    from = at + 2
  }
}

// 從「A 還是 B」切出兩個選項，交給 AI 對應到二擇一牌陣的甲、乙（2026-11-19：資料只寫甲乙，AI 只能猜哪個是哪個）。
// 切不出來（「選哪一個」「三選一」、選項太長）就回傳 null，由 AI 在開場講清楚它的假設。
const CHOICE_SPLIT = /還是|或是|或者/
const OPTION_PREFIX = /^(?:請問|我|你|妳)?(?:到底)?(?:是)?(?:應該|該|要|想|會)?(?:選擇|選)?/
const OPTION_SUFFIX = /(?:比較好|好呢|好|呢|嗎|吗)?$/
const OPTION_MAX = 20

function cleanOption(text) {
  return text
    .replace(/[\s，,。？?！!、：:]+$/u, '')
    .replace(/^[\s，,。？?！!、：:]+/u, '')
    .replace(OPTION_PREFIX, '')
    .replace(OPTION_SUFFIX, '')
    .replace(/[\s，,。？?！!、：:]+$/u, '')
    .trim()
}

function extractChoiceOptions(question) {
  const text = String(question || '').trim()
  const match = text.match(CHOICE_SPLIT)
  if (!match) return null
  const before = text.slice(0, match.index)
  if (STILL_BEFORE.test(before) || STILL_AFTER.test(text.slice(match.index + match[0].length))) return null
  // 只取最後一個逗號後面（「這次轉職，該留在…」的「這次轉職」不是選項）；前面的背景保留在問題裡
  const a = cleanOption(cleanOption(before).split(/[，,。]/).pop())
  const b = cleanOption(text.slice(match.index + match[0].length).split(/[，,。？?]/)[0])
  if (!a || !b || a.length > OPTION_MAX || b.length > OPTION_MAX) return null
  return [a, b]
}

/**
 * @param question 問題文字
 * @param domain 已決定的領域（quant.domain：work／money／love／social／stock／study／general）
 * @param othersInvolved 問題有沒有提到別人
 * @returns {{ kinds: string[], topic: string, othersInvolved: boolean }}
 *   kinds：yesNo（是非題）、timing（問時間）、choice（選擇題），可以同時有好幾個；都不是時為 ['open']
 */
function analyzeQuestionType({ question = '', domain = 'general', othersInvolved = false } = {}) {
  const kinds = []
  if (detectYesNo(question)) kinds.push('yesNo')
  if (isTimingQuestion(question)) kinds.push('timing')
  if (isChoiceQuestion(question)) kinds.push('choice')
  return { kinds: kinds.length > 0 ? kinds : ['open'], topic: domain || 'general', othersInvolved: Boolean(othersInvolved) }
}

/**
 * 這次最關鍵的牌（最多兩張）：結果或未來位置的牌，加上焦點牌。沒有結果位置時用最後一張。
 * @param positionKeys 各張的位置 key（手動選牌為 null）
 * @param focusIndex 焦點牌（theme.focusIndex）
 * @returns {number[]} 牌的 index，依牌陣順序
 */
function pickKeyCards({ positionKeys = null, focusIndex = null, count }) {
  const picked = new Set()
  const keys = Array.isArray(positionKeys) ? positionKeys : []
  const outcome = YES_NO.outcomeKeys.map((key) => keys.indexOf(key)).find((index) => index >= 0)
  if (outcome !== undefined) picked.add(outcome)
  else if (count > 0) picked.add(count - 1)
  if (Number.isInteger(focusIndex) && focusIndex >= 0 && focusIndex < count) picked.add(focusIndex)
  return [...picked].sort((a, b) => a - b)
}

module.exports = { analyzeQuestionType, isChoiceQuestion, extractChoiceOptions, pickKeyCards }
