const { SUITS, NUMBER_THEMES, OTHERS_KEYWORDS, getCardProfile } = require('../data/cardAttributes')
const {
  MAJOR_COUNT_FATE_THRESHOLD,
  MAJOR_RATIO_NATURAL,
  MAJOR_RATIO_FATE,
  HIGH_INTENSITY_POLARITY,
} = require('../data/ruleConfig')
const { getCardVector } = require('../data/cardDimensions')
const { getElementRelation } = require('./rules/elementRelation')
const { analyzeQuestion } = require('./rules/questionRules')
const { analyzePositions } = require('./rules/positionRules')
const { analyzeNumberStage } = require('./rules/numberStageRules')
const { analyzeWeights } = require('./rules/weightRules')
const { analyzeQuant } = require('./rules/quantRules')
const { resolveRelationPairs } = require('./rules/relationPairs')

const DOMINANT_SUIT_MIN = 3
const EMPHASIZED_NUMBER_MIN = 2
const EMPHASIZED_COURT_RANK_MIN = 2

function countBy(items, getKey) {
  return items.reduce((counts, item) => {
    const key = getKey(item)
    if (key !== null && key !== undefined) {
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }, {})
}

function isNumberProgression(from, to) {
  if (from.profile.kind === 'pip' && to.profile.kind === 'pip') {
    return to.profile.pipNumber === from.profile.pipNumber + 1
  }

  if (from.profile.kind === 'major' && to.profile.kind === 'major') {
    return to.profile.majorNumber === from.profile.majorNumber + 1
  }

  return false
}

// 判定優先序：元素關係 → 數字進程（牌義極性暫不使用）
function analyzePair(from, to) {
  const elementRelation = getElementRelation(from.profile.element, to.profile.element)
  const progression = isNumberProgression(from, to)
  const tags = []

  if (elementRelation === 'same') {
    tags.push('sameElement')
  }
  if (progression) {
    tags.push('numberProgression')
  }
  if (from.orientation !== to.orientation) {
    tags.push('orientationChange')
    tags.push(to.orientation === 'reversed' ? 'blocked' : 'unblocked')
  }

  // 規則 4 補充：大小牌轉換與化簡後的數字方向，讓中性配對也有可說明的內容
  const fromMajor = from.profile.kind === 'major'
  const toMajor = to.profile.kind === 'major'
  if (fromMajor && !toMajor) {
    tags.push('majorToMinor')
  } else if (!fromMajor && toMajor) {
    tags.push('minorToMajor')
  }

  const fromNumber = from.profile.numerology
  const toNumber = to.profile.numerology
  if (fromNumber !== null && toNumber !== null) {
    tags.push(toNumber > fromNumber ? 'numberUp' : toNumber < fromNumber ? 'numberDown' : 'numberRepeat')
  }

  let relation = 'neutral'
  if (elementRelation === 'friendly' || elementRelation === 'same') {
    relation = 'enhance'
  } else if (elementRelation === 'opposed') {
    relation = 'weaken'
  } else if (progression) {
    relation = 'cause'
  }

  return {
    from: from.index,
    to: to.index,
    relation,
    elementRelation,
    tags,
  }
}

function hasOthersInQuestion(question) {
  const text = String(question || '').replace(/其他/g, '')
  return OTHERS_KEYWORDS.some((keyword) => text.includes(keyword))
}

function pickFocus(items) {
  return items.reduce((best, item) => (item.profile.weight > best.profile.weight ? item : best), items[0])
}

// positionKeys：各張牌的牌陣位置 key（選填），提供時才套用規則 8 與影響力走向
// domain：使用者指定的問題類型（選填）；positionWeights：各位置權重（選填，總和 1）
function analyzeCombination({
  entries,
  question = '',
  positionKeys = null,
  domain = null,
  positionWeights = null,
  relations = null,
}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('analyzeCombination 需要至少一張牌')
  }

  const items = entries.map((entry, index) => ({
    index,
    card: entry.card,
    orientation: entry.orientation,
    profile: getCardProfile(entry.card),
  }))

  const total = items.length
  const majorCount = items.filter((item) => item.profile.kind === 'major').length
  const courtCount = items.filter((item) => item.profile.kind === 'court').length
  const pipCount = items.filter((item) => item.profile.kind === 'pip').length
  const reversedCount = items.filter((item) => item.orientation === 'reversed').length

  const suitCounts = countBy(items, (item) => item.profile.suit)
  const numberCounts = countBy(items, (item) => item.profile.pipNumber)
  const courtRankCounts = countBy(items, (item) => item.profile.courtRank)
  const elementCounts = countBy(items, (item) => item.profile.element)

  const emphasizedNumbers = Object.entries(numberCounts)
    .filter(([, count]) => count >= EMPHASIZED_NUMBER_MIN)
    .map(([number, count]) => ({ number: Number(number), count, theme: NUMBER_THEMES[number] || null }))

  const emphasizedCourtRanks = Object.entries(courtRankCounts)
    .filter(([, count]) => count >= EMPHASIZED_COURT_RANK_MIN)
    .map(([rank, count]) => ({ rank, count }))

  const dominantSuits = Object.entries(suitCounts)
    .filter(([, count]) => count >= DOMINANT_SUIT_MIN)
    .map(([suit, count]) => ({ suit, count }))

  const missingSuits = Object.keys(SUITS).filter((suit) => !suitCounts[suit])

  const maxElementCount = Math.max(0, ...Object.values(elementCounts))
  const dominantElements =
    maxElementCount >= 2
      ? Object.keys(elementCounts).filter((element) => elementCounts[element] === maxElementCount)
      : []

  const focus = pickFocus(items)
  // 三級：比例夠高或張數夠多算外在主導；介於牌堆自然比例與門檻之間算「偏高」；
  // 低於自然比例才算日常。用「是否過半」當唯一門檻會讓小牌陣永遠判成日常。
  const majorRatio = total > 0 ? majorCount / total : 0

  // 高強度小牌（寶劍三、寶劍十…）在牌義上的份量不亞於大牌，
  // 只數大牌張數會把它們歸成日常（v10 Q5）。比照大牌計入 ——
  // 折半計入時三張寶劍十在十張牌陣裡只加 1.5，還是翻不動，等於沒修。
  const heavyMinorCount = items.filter((item) => {
    if (item.profile.kind === 'major') return false
    const vector = getCardVector(item.card, item.profile)
    return vector.polarityKnown && Math.abs(vector.polarity) >= HIGH_INTENSITY_POLARITY
  }).length
  const weightedRatio = total > 0 ? (majorCount + heavyMinorCount) / total : 0

  const dominance =
    weightedRatio >= MAJOR_RATIO_FATE || majorCount > MAJOR_COUNT_FATE_THRESHOLD
      ? 'fate'
      : weightedRatio > MAJOR_RATIO_NATURAL
        ? 'elevated'
        : 'personal'

  // 配對來自牌陣宣告的關係對；沒有宣告就退回相鄰
  const pairs = resolveRelationPairs(items.length, relations).map((relation) => ({
    ...analyzePair(items[relation.from], items[relation.to]),
    kind: relation.kind,
  }))

  const othersInvolved = hasOthersInQuestion(question)
  const courts = items
    .filter((item) => item.profile.kind === 'court')
    .map((item) => ({
      index: item.index,
      rank: item.profile.courtRank,
      suit: item.profile.suit,
      role: othersInvolved ? 'person' : 'trait',
    }))

  const conflicts = []

  pairs
    .filter((pair) => pair.relation === 'enhance' && pair.tags.includes('orientationChange'))
    .forEach((pair) => {
      conflicts.push({ type: 'enhanceWithBlocked', from: pair.from, to: pair.to })
    })

  dominantSuits.forEach(({ suit }) => {
    const suitElement = SUITS[suit].element
    if (getElementRelation(suitElement, focus.profile.element) === 'opposed') {
      conflicts.push({ type: 'focusOpposesDominantSuit', index: focus.index, suit })
    }
  })

  const uncertainties = []

  if (courts.length > 0 && !String(question || '').trim()) {
    uncertainties.push({ type: 'courtRoleWithoutQuestion', indexes: courts.map((court) => court.index) })
  }

  items
    .filter((item) => !item.profile.element)
    .forEach((item) => {
      uncertainties.push({ type: 'unknownElement', index: item.index })
    })

  const questionResult = analyzeQuestion({ question, items })

  // 領域優先序：使用者指定 → 關鍵詞比對（規則 7）→ 均等權重
  let resolvedDomain = 'general'
  let domainResolvedFrom = 'none'
  if (domain && domain !== 'general') {
    resolvedDomain = domain
    domainResolvedFrom = 'user'
  } else if (domain === 'general') {
    domainResolvedFrom = 'user'
  } else if (questionResult?.domains?.length) {
    resolvedDomain = questionResult.domains[0]
    domainResolvedFrom = 'keyword'
  }

  return {
    theme: {
      focusIndex: focus.index,
      dominance,
      emphasizedNumbers,
      emphasizedCourtRanks,
      dominantSuits,
      missingSuits,
      dominantElements,
    },
    pairs,
    courts,
    conflicts,
    uncertainties,
    quant: analyzeQuant({
      items,
      domain: resolvedDomain,
      positionWeights,
      conflictCount: conflicts.length,
      domainResolvedFrom,
    }),
    question: questionResult,
    positions: analyzePositions({ positionKeys, items }),
    numberStage: analyzeNumberStage(items),
    weights: analyzeWeights({
      items,
      focusIndex: focus.index,
      timeOrdered: Boolean(positionKeys?.includes('past') && positionKeys?.includes('future')),
      countDominantElements: dominantElements,
    }),
    stats: {
      total,
      majorCount,
      // 份量很重的小牌（高強度極性）。dominance 把它們和大牌一起計入，
      // 文字層若只報大牌張數，會出現「大牌 0 張，比例偏高」這種自相矛盾。
      heavyMinorCount,
      courtCount,
      pipCount,
      reversedCount,
      suitCounts,
      numberCounts,
      courtRankCounts,
      elementCounts,
    },
    profiles: items.map((item) => item.profile),
  }
}

module.exports = {
  analyzeCombination,
  getElementRelation,
}
