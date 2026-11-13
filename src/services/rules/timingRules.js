// 規則 13：時間類問題（多久、什麼時候、何時…）。詳見 doc/v23-tarot-yes-no-followup-plan.md 的 2.6
// 2026-11-13 使用者回報：追問「還要多久才能回到買進的價位」，AI 只說「牌面不給你時間」。
// 這裡依傳統的時間推算（cardTiming.js）挑出「主要的時間牌」並列出每張牌的時間線索，交給 AI 給出大約的時間點。
const { getCardTiming } = require('../../data/cardTiming')
const { taipeiDate } = require('../clock')

const TIMING_PATTERN = /多久|什麼時候|甚麼時候|何時|幾時|哪時|多快|幾天|幾週|幾周|幾個月|幾年|要等|時間點|哪一天|哪個月|還要多|多長|多少時間|來得及|何日/

function isTimingQuestion(question) {
  return TIMING_PATTERN.test(String(question || ''))
}

// 主要的時間牌：有結果、未來的位置就看那張；沒有就看最後一張（事情往後走的方向）
const TIMING_POSITION_KEYS = ['outcome', 'future']

/**
 * @param question 問題
 * @param items 規則引擎的牌（index / card / orientation / profile）
 * @param positionKeys 各張牌的位置 key（選填）
 * @param labels 各張牌給 AI 看的名稱（選填，例如「結果的死神正位」）；沒給就用牌名
 * @param now 現在時間（測試用）；時間線索會換算成從今天（台灣時間）往後的實際日期
 * @returns null（不是時間類問題）或 { mainIndex, text, cards: [{ index, text }] }
 */
function analyzeTiming({ question, items, positionKeys = null, labels = null, now = new Date() }) {
  if (!isTimingQuestion(question) || items.length === 0) return null
  const today = taipeiDate(now)

  const cards = items
    .map((item, i) => {
      const timing = getCardTiming(item.card, item.profile, item.orientation, today)
      if (!timing) return null
      const name = labels?.[i] || `${item.card.nameZh}${item.orientation === 'reversed' ? '逆位' : '正位'}`
      return { index: item.index, kind: timing.kind, text: `${name}：${timing.text}` }
    })
    .filter(Boolean)
  if (cards.length === 0) return null

  const positioned = positionKeys ? positionKeys.findIndex((key) => TIMING_POSITION_KEYS.includes(key)) : -1
  const mainItem = items[positioned >= 0 ? positioned : items.length - 1]
  const main = cards.find((card) => card.index === mainItem.index) || cards[cards.length - 1]

  const majors = items.filter((item) => item.profile.kind === 'major').length
  const lines = [`主要的時間牌：${main.text}。`]
  const others = cards.filter((card) => card !== main)
  if (others.length > 0) lines.push(`其他牌的時間線索：${others.map((card) => card.text).join('；')}。`)
  if (majors * 2 > items.length) lines.push('大牌超過一半：牽涉的是大局，時間通常以月或年計，不是幾天內的事。')

  return { mainIndex: main.index, text: lines.join(''), cards }
}

module.exports = { isTimingQuestion, analyzeTiming }
