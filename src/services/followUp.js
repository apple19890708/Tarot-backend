// 抽牌追問（v23）：占卜完之後，針對同一件事再問、再抽 1～3 張補充牌，最多三次。
// 補充牌不屬於原本的牌陣：原牌陣的分析不重算，補充牌只在「追問的延伸解讀」裡和原牌陣一起看。
const { getCardProfile } = require('../data/cardAttributes')
const { buildYesNoText } = require('./analysisFormatter')
const { buildReading } = require('./readingService')
const { analyzeYesNo } = require('./rules/yesNoRules')
const { analyzeTiming } = require('./rules/timingRules')

const FOLLOW_UP_MAX_ROUNDS = 3
const FOLLOW_UP_MAX_CARDS = 3
const FOLLOW_UP_QUESTION_MAX = 200
const ORIENTATIONS = ['upright', 'reversed']
// 牌 id 只收 24 位十六進位字串。mongoose.isValidObjectId 連物件、12 字元字串都放行，
// 大寫的 id 也會繞過「不可重複」的比對（api-reviewer 2026-11-13）
const CARD_ID = /^[0-9a-f]{24}$/i
const normalizeId = (id) => (typeof id === 'string' && CARD_ID.test(id) ? id.toLowerCase() : null)

// 追問的問題：必填（沒有問題就不知道補充牌在回答什麼）
function validateFollowUpQuestion(raw) {
  const question = typeof raw === 'string' ? raw.trim() : ''
  if (!question) return { error: '請先寫下想追問的內容。' }
  if (question.length > FOLLOW_UP_QUESTION_MAX) return { error: `追問內容不可超過 ${FOLLOW_UP_QUESTION_MAX} 字。` }
  return { question }
}

/**
 * 檢查前端帶來的追問清單。
 * @param raw [{ question, cards: [{ id, orientation }] }]
 * @param baseDrawn 原牌陣的牌（[{ id, orientation }]）；補充牌不能和它或彼此重複（同一副牌）
 * @returns { followUps: [{ question, drawn }] } 或 { error }
 */
function validateFollowUps(raw, baseDrawn) {
  const list = raw === undefined || raw === null ? [] : raw
  if (!Array.isArray(list)) {
    return { error: '追問的資料格式不正確。' }
  }
  if (list.length > FOLLOW_UP_MAX_ROUNDS) {
    return { error: `追問最多 ${FOLLOW_UP_MAX_ROUNDS} 次。` }
  }
  const used = new Set(baseDrawn.map((item) => String(item.id).toLowerCase()))
  const followUps = []
  for (const item of list) {
    const { question, error } = validateFollowUpQuestion(item?.question)
    if (error) return { error }
    const cards = Array.isArray(item?.cards) ? item.cards : []
    if (cards.length < 1 || cards.length > FOLLOW_UP_MAX_CARDS) {
      return { error: `每次追問抽 1 到 ${FOLLOW_UP_MAX_CARDS} 張牌。` }
    }
    const drawn = []
    for (const card of cards) {
      const id = normalizeId(card?.id)
      if (!id || !ORIENTATIONS.includes(card?.orientation)) {
        return { error: '補充牌的資料格式不正確。' }
      }
      if (used.has(id)) return { error: '補充牌不可以和已經抽出的牌重複。' }
      used.add(id)
      drawn.push({ id, orientation: card.orientation })
    }
    followUps.push({ question, drawn })
  }
  return { followUps }
}

// 檢查追問清單並把每次的牌從牌庫載入。回傳 { followUps: [{ question, drawn, cards }] } 或 { error }
async function loadFollowUps(raw, baseDrawn, loadCardsInOrder) {
  const { followUps, error } = validateFollowUps(raw, baseDrawn)
  if (error) return { error }
  const loaded = []
  for (const followUp of followUps) {
    const { cards, error: loadError } = await loadCardsInOrder(followUp.drawn)
    if (loadError) return { error: loadError }
    loaded.push({ ...followUp, cards })
  }
  return { followUps: loaded }
}

// 補充牌給畫面用的資料（牌、正逆位、牌義），格式同占卜結果的 cards，但沒有牌陣位置
function buildFollowUpEntries(cards, drawn) {
  const reading = buildReading({ question: '', spread: null, cards, drawOrientation: (index) => drawn[index].orientation })
  return reading.cards.map((entry) => ({
    orientation: entry.orientation,
    interpretation: entry.interpretation,
    meaning: entry.meaning,
    highlights: entry.highlights,
    card: entry.card,
  }))
}

function toItems(cards, drawn, offset = 0) {
  return cards.map((card, index) => ({
    index: offset + index,
    card,
    orientation: drawn[index].orientation,
    profile: getCardProfile(card),
  }))
}

// 是非判斷的文字；不是是非題時回傳 null
function yesNoTextOf(question, items, positionKeys = null) {
  const result = analyzeYesNo({ question, items, positionKeys })
  if (!result) return null
  const entries = []
  items.forEach((item) => {
    entries[item.index] = { card: item.card, orientation: item.orientation }
  })
  return buildYesNoText(result, entries)
}

/**
 * 交給 AI 的追問資料：每次追問各自的是非判斷（只看那次的補充牌），
 * 以及把原牌陣和所有補充牌放在一起、對「原本的問題」重新算一次的是非判斷。
 * @param baseCards 原牌陣的牌（資料庫文件）；baseDrawn 對應的正逆位
 * @param rounds [{ question, cards（資料庫文件）, drawn }]
 */
function buildFollowUpContext({ question, baseCards, baseDrawn, positionKeys = null, rounds }) {
  const baseItems = toItems(baseCards, baseDrawn)
  let offset = baseItems.length
  const allItems = [...baseItems]
  const roundContexts = rounds.map((round) => {
    const items = toItems(round.cards, round.drawn)
    allItems.push(...toItems(round.cards, round.drawn, offset))
    offset += items.length
    return {
      question: round.question,
      cards: round.cards,
      drawn: round.drawn,
      yesNoText: yesNoTextOf(round.question, items),
      // 規則 13：這次追問問的是時間（多久、什麼時候）時，補充牌的時間線索；主要的時間牌是這次的最後一張
      timingText: analyzeTiming({ question: round.question, items })?.text || null,
    }
  })
  // 補充牌沒有牌陣位置：位置 key 只給原牌陣那幾張（結果、未來的位置加重）
  const keys = positionKeys ? [...positionKeys, ...allItems.slice(baseItems.length).map(() => null)] : null
  return { rounds: roundContexts, combinedYesNoText: yesNoTextOf(question, allItems, keys) }
}

// ---- 只回答新的追問（2026-11-13 使用者要求：按 AI 追問時不要把之前的追問全部重寫）----
// 延伸回答的格式是「## 追問 N｜…」一節一節，最後「## 綜合來看」。
// 回傳前 count 次追問已經寫好的段落（含標題）；要從追問 1 起連續都有才算，中間缺一節就從那裡重寫
const ROUND_HEADING = /^##\s*追問\s*(\d+)/
const SUMMARY_HEADING = /^##\s*綜合來看/

function keepAnsweredSections(text, count) {
  const sections = new Map()
  let current = null
  for (const line of String(text || '').split(/\r?\n/)) {
    const round = ROUND_HEADING.exec(line)
    if (round) {
      current = Number(round[1])
      if (!sections.has(current)) sections.set(current, [])
    } else if (SUMMARY_HEADING.test(line) || /^#\s/.test(line)) {
      current = null
    }
    if (current !== null) sections.get(current).push(line)
  }
  const kept = []
  for (let number = 1; number <= count; number += 1) {
    const lines = sections.get(number)
    // 只有標題沒有內容（寫到一半）不算
    if (!lines || lines.slice(1).join('').trim() === '') break
    kept.push(lines.join('\n').trim())
  }
  return { kept: kept.length, text: kept.join('\n\n') }
}

// 保留的段落接上這次新寫的（新的追問與綜合來看）
function mergeFollowUpAnswer(keptText, newText) {
  return [keptText, newText].map((part) => String(part || '').trim()).filter(Boolean).join('\n\n')
}

module.exports = {
  FOLLOW_UP_MAX_ROUNDS,
  FOLLOW_UP_MAX_CARDS,
  FOLLOW_UP_QUESTION_MAX,
  validateFollowUpQuestion,
  validateFollowUps,
  loadFollowUps,
  buildFollowUpEntries,
  buildFollowUpContext,
  keepAnsweredSections,
  mergeFollowUpAnswer,
}
