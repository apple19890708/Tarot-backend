// 規則文字的批次一致性檢查：隨機抽幾千組牌陣，確認組出來的句子不會互相矛盾。
// 之前「火元素最多」又說「沒有權杖」這類問題都是靠肉眼看截圖才抓到，這支測試讓它自動化。
//
// 抽牌用固定種子的亂數，每次跑的牌陣都一樣；失敗時訊息會附上第幾組、牌陣、牌與正逆位，方便重現。
// 想多跑幾組可以設 CONSISTENCY_ROUNDS，例如 CONSISTENCY_ROUNDS=20000 npm test
const test = require('node:test')
const assert = require('node:assert/strict')

const { buildReading } = require('../src/services/readingService')
const { CONTRADICTIONS } = require('../src/services/analysisFormatter')
const { SUITS, ELEMENT_LABELS } = require('../src/data/cardAttributes')
const { SELECTABLE_DOMAINS } = require('../src/data/ruleConfig')
const spreads = require('../src/data/spreads')

const ROUNDS = Number(process.env.CONSISTENCY_ROUNDS) || 3000

// 用真實的英文牌名，大牌元素才會走 MAJOR_ELEMENTS_BY_NAME_EN，和線上資料庫一致
const MAJOR_NAMES = [
  'The Fool', 'The Magician', 'The High Priestess', 'The Empress', 'The Emperor', 'The Hierophant',
  'The Lovers', 'The Chariot', 'Strength', 'The Hermit', 'Wheel of Fortune', 'Justice', 'The Hanged Man',
  'Death', 'Temperance', 'The Devil', 'The Tower', 'The Star', 'The Moon', 'The Sun', 'Judgement', 'The World',
]
const RANK_NAMES = { 1: 'Ace', 11: 'Page', 12: 'Knight', 13: 'Queen', 14: 'King' }
const RANK_ZH = { 1: '一', 11: '侍者', 12: '騎士', 13: '皇后', 14: '國王' }

const DECK = [
  ...MAJOR_NAMES.map((nameEn, number) => ({
    _id: `major-${number}`,
    slug: `major-${number}`,
    arcanaType: 'major',
    suit: null,
    number,
    nameEn,
    nameZh: `大牌${number}`,
  })),
  ...Object.entries(SUITS).flatMap(([suit, { label }]) =>
    Array.from({ length: 14 }, (_, i) => {
      const number = i + 1
      return {
        _id: `${suit}-${number}`,
        slug: `${suit}-${number}`,
        arcanaType: 'minor',
        suit,
        number,
        nameEn: `${RANK_NAMES[number] || number} of ${suit[0].toUpperCase()}${suit.slice(1)}`,
        nameZh: `${label}${RANK_ZH[number] || number}`,
      }
    }),
  ),
]

// 線性同餘亂數，固定種子
function createRandom(seed) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
}

// 牌陣模式輪流跑每個牌陣；每 6 組插一組手動選牌（沒有位置，1～10 張）
function drawCase(index, random) {
  const manual = index % 6 === 5
  const spread = manual ? null : spreads[index % spreads.length]
  const count = manual ? 1 + Math.floor(random() * 10) : spread.cardCount
  const pool = [...DECK]
  const cards = Array.from({ length: count }, () => pool.splice(Math.floor(random() * pool.length), 1)[0])
  const orientations = cards.map(() => (random() > 0.5 ? 'upright' : 'reversed'))
  const domains = [null, ...SELECTABLE_DOMAINS]
  return { spread, cards, orientations, domain: domains[index % domains.length] }
}

function describeCase(index, { spread, cards, orientations, domain }) {
  const list = cards.map((card, i) => `${card.nameZh}${orientations[i] === 'upright' ? '正' : '逆'}`).join('、')
  return `第 ${index} 組（${spread?.key || 'manual'}／${domain || 'general'}）：${list}`
}

// 收集所有給人看的文字。欄位名稱是 text／summary／elementNumberText 或字串型的 courtSummary
function collectTexts(value, out = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectTexts(item, out))
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (['text', 'summary', 'elementNumberText', 'courtSummary'].includes(key) && typeof child === 'string') {
        out.push(child)
      } else if (typeof child === 'object') {
        collectTexts(child, out)
      }
    }
  }
  return out
}

// 每一組牌都要成立的條件。回傳違反的說明，空陣列代表通過
function checkReading(reading) {
  const problems = []
  const { analysis, guidance } = reading
  const texts = [...collectTexts(analysis), guidance]

  // 1. 樣板沒填好
  for (const text of texts) {
    if (/undefined|null|NaN|\[object/.test(text)) problems.push(`文字裡有未代入的值：${text}`)
    if (/[，。、；：]{2}/.test(text.replace(/：「/g, ''))) problems.push(`標點重複：${text}`)
  }
  if (!guidance) problems.push('結語是空的')
  if (!analysis.theme.text) problems.push('整體在說什麼是空的')
  // 新增位置判定時忘了寫文字，buildPositionText 會落到 default 回傳空字串
  for (const finding of analysis.positions) {
    if (!finding.text) problems.push(`位置判定沒有文字：${finding.type}`)
  }

  // 2. 守門規則套在結論層的文字上（和 assertConsistency 同一批，加上結語）
  const verdictTexts = [
    analysis.theme.text,
    analysis.theme.elementNumberText,
    analysis.weights.text,
    analysis.quant?.text,
    analysis.question?.text,
    analysis.numberStage?.text,
    guidance,
  ].filter(Boolean)
  for (const rule of CONTRADICTIONS) {
    if (rule.hit(verdictTexts)) problems.push(`自相矛盾：${rule.name}`)
  }

  // 3. 大牌張數要和實際抽到的一致，「超過一半」要真的超過
  const majorCount = reading.cards.filter((entry) => entry.card.arcanaType === 'major').length
  for (const text of texts) {
    const match = text.match(/大牌有 (\d+) 張(，超過一半)?/)
    if (!match) continue
    if (Number(match[1]) !== majorCount) problems.push(`大牌張數寫 ${match[1]}，實際 ${majorCount}：${text}`)
    if (match[2] && majorCount * 2 <= reading.cards.length) {
      problems.push(`大牌 ${majorCount}/${reading.cards.length} 張卻說超過一半`)
    }
  }

  // 4. 結語和「整體看起來」講的方向要一致
  if (analysis.quant?.directionLabel && reading.cards.length > 1) {
    const label = analysis.quant.directionLabel
    if (!analysis.quant.text.includes(`整體${label}`)) problems.push(`整體看起來沒有寫出方向「${label}」`)
    if (!guidance.startsWith(`整體來看${label}`)) problems.push(`結語的方向和整體看起來不同：${guidance.slice(0, 20)}`)
  }

  // 5. 被大牌元素補上的花色，任何地方都不能再說它「沒出現」
  const dominantElements = analysis.theme.dominantElements || []
  for (const suit of analysis.theme.missingSuits || []) {
    const { label, element, covers } = SUITS[suit]
    if (!dominantElements.includes(element)) continue
    for (const text of texts) {
      if (new RegExp(`這次沒有[^，。]*${label}`).test(text)) {
        problems.push(`${ELEMENT_LABELS[element]}元素最多，卻說沒有${label}：${text}`)
      }
      const missingClause = text.match(/([^。；]*)這(幾)?塊沒出現/)
      if (missingClause && missingClause[1].includes(covers)) {
        problems.push(`${ELEMENT_LABELS[element]}元素最多，結語卻說「${covers}」沒出現`)
      }
    }
  }

  return problems
}

test(`批次一致性：隨機 ${ROUNDS} 組牌陣，規則文字不互相矛盾`, () => {
  const random = createRandom(20261104)
  const failures = new Map()

  for (let index = 0; index < ROUNDS; index++) {
    const drawn = drawCase(index, random)
    let problems
    try {
      const reading = buildReading({
        question: '這件事接下來會怎麼走？',
        spread: drawn.spread,
        cards: drawn.cards,
        drawOrientation: (i) => drawn.orientations[i],
        domain: drawn.domain,
      })
      problems = checkReading(reading)
    } catch (error) {
      // formatAnalysis 的 assertConsistency 在非正式環境會直接拋錯
      problems = [`拋出錯誤：${error.message}`]
    }
    // 同一種問題只留第一個例子，訊息才不會被幾百筆洗掉
    for (const problem of problems) {
      const kind = problem.split('：')[0]
      if (!failures.has(kind)) failures.set(kind, { count: 0, example: `${describeCase(index, drawn)}\n    ${problem}` })
      failures.get(kind).count++
    }
  }

  const report = [...failures.entries()].map(([kind, { count, example }]) => `${kind}（${count} 次）\n  ${example}`)
  assert.equal(report.length, 0, `\n${report.join('\n')}`)
})

// 守門員本身要有效：餵已知矛盾的句子必須被抓到，否則上面的測試永遠會過
test('元素守門規則抓得到「火元素最多」又「沒有權杖」', () => {
  const rule = CONTRADICTIONS.find((item) => item.name === '元素最多卻說沒有對應的花色')
  assert.ok(rule)
  assert.equal(rule.hit(['把大牌的元素也算進來，火和水元素最多。', '這次沒有權杖和寶劍，做事和衝勁…']), true)
  assert.equal(rule.hit(['火元素最多。', '雖然沒有權杖的小牌，大牌帶來的火元素補上了這塊。']), false)
  assert.equal(rule.hit(['水元素最多。', '這次沒有權杖，做事和衝勁這塊牌面沒有提到。']), false)
})
