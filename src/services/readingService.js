const { analyzeCombination } = require('./combinationRules')
const { formatAnalysis, buildGuidance } = require('./analysisFormatter')
const { parseMeaningGroups, getCoreMessage } = require('./meaningSections')
const { lookupPairs } = require('./pairDictionary')
const { resolveRelationPairs } = require('./rules/relationPairs')

function randomOrientation() {
  return Math.random() > 0.5 ? 'upright' : 'reversed'
}

function orientationLabel(orientation) {
  return orientation === 'upright' ? '正位' : '逆位'
}

function getSection(card, orientation) {
  const key = orientation === 'upright' ? '正位牌義' : '逆位牌義'
  const lines = card.sections?.[key]

  return Array.isArray(lines) ? lines.filter(Boolean) : []
}

// 手動選牌沒有牌陣位置，改用「第 N 張」
const MANUAL_SPREAD = { key: 'manual', name: '自選牌', description: '由你自己挑選的牌' }

function positionLabelOf(position, index) {
  return position ? position.label : `第 ${index + 1} 張`
}

// 開場用「核心訊息」的內容，不要把小標題當成內文
function buildInterpretation(card, orientation, position, index, groups) {
  const opening = getCoreMessage(groups) || '這張牌提醒你回到問題本身，重新看見局勢。'
  const label = positionLabelOf(position, index)

  return `${label}出現${card.nameZh}${orientationLabel(orientation)}，${opening}`
}

// 牌陣模式傳 spread（含 positions）；手動選牌傳 spread = null，由 cards 的順序決定
// pairTexts：先由呼叫端查好的辭典文字（Map<key, {text, source}>），省略時全部走規則運算。
// 查詢要碰資料庫，所以在外面先批次查完，buildReading 與 formatAnalysis 維持同步、好測試。
function buildReading({
  question,
  spread = null,
  cards,
  drawOrientation = randomOrientation,
  domain = null,
  pairTexts = null,
}) {
  const positions = spread ? spread.positions : null

  const entries = cards.map((card, index) => {
    const position = positions ? positions[index] : null
    const orientation = drawOrientation(index)
    const groups = parseMeaningGroups(getSection(card, orientation))

    return {
      position,
      orientation,
      interpretation: buildInterpretation(card, orientation, position, index, groups),
      // 完整牌義，依小標題分組；前台用這個顯示
      meaning: groups,
      // 舊欄位保留：只取內容行，不再出現落單的小標題
      highlights: groups.flatMap((group) => group.lines).slice(0, 3),
      card: {
        id: card._id,
        nameZh: card.nameZh,
        nameEn: card.nameEn,
        suit: card.suit,
        arcanaType: card.arcanaType,
        number: card.number,
        keywords: card.keywords,
        source: card.source,
        image: card.image || '',
      },
    }
  })

  const overview = entries
    .map((entry, index) => `${positionLabelOf(entry.position, index)}：${entry.card.nameZh}${orientationLabel(entry.orientation)}`)
    .join('、')

  const analysisEntries = entries.map((entry, index) => ({
    card: cards[index],
    orientation: entry.orientation,
    label: positionLabelOf(entry.position, index),
    // 手動選牌沒有牌陣，label 只是「第 N 張」，不能當成有意義的位置來造句
    hasPosition: Boolean(entry.position),
  }))
  const combination = analyzeCombination({
    entries: analysisEntries,
    question,
    positionKeys: positions ? entries.map((entry) => entry.position.key) : null,
    relations: spread?.relations || null,
    // 只有在每個位置都有權重時才採用，避免部分加權、部分均分造成比例失真
    positionWeights:
      positions && positions.every((position) => typeof position.weight === 'number')
        ? positions.map((position) => position.weight)
        : null,
    domain,
  })
  const analysis = formatAnalysis(combination, analysisEntries, pairTexts)
  // 結語要用組合分析的結果（份量、推力、阻力），所以排在 analyzeCombination 之後
  const guidance = buildGuidance(combination, analysisEntries)

  entries.forEach((entry, index) => {
    entry.card.element = combination.profiles[index].element
    entry.card.kind = combination.profiles[index].kind
  })

  return {
    question,
    spread: spread
      ? { key: spread.key, name: spread.name, description: spread.description, cardCount: spread.cardCount }
      : { ...MANUAL_SPREAD, cardCount: cards.length },
    overview,
    guidance,
    cards: entries,
    analysis,
  }
}

// 先查辭典再組解讀。端點用這個，buildReading 留給測試與不需要辭典的場合。
async function buildReadingWithDictionary(options) {
  const { cards, spread = null, drawOrientation = randomOrientation, domain = null } = options

  const orientations = cards.map((_, index) => drawOrientation(index))

  // 要查的配對必須和之後分析的配對一致。v6 之後牌陣可以宣告非相鄰的關係對
  // （例如直指核心的「問題核心 × 資源」），這裡若只查相鄰就會漏掉，辭典明明有卻退回規則文字。
  const lookupTargets = resolveRelationPairs(cards.length, spread?.relations || null).map((pair) => ({
    from: { slug: cards[pair.from].slug, orientation: orientations[pair.from] },
    to: { slug: cards[pair.to].slug, orientation: orientations[pair.to] },
  }))

  const pairTexts = await lookupPairs(lookupTargets, domain)

  // 正逆位已經決定好，這裡直接沿用，避免再抽一次導致與查詢結果對不上
  return buildReading({ ...options, drawOrientation: (index) => orientations[index], pairTexts })
}

module.exports = {
  buildReading,
  buildReadingWithDictionary,
}