// 規則 11：牌的四維向量與極性。詳見 doc/v04-tarot-quant-analysis-plan.md
// 四維度（行動／情感／思維／物質）與四元素一一對應，所以小牌可由花色直接推導，
// 只有大牌的極性需要人工給定（放在 ruleConfig 的 MAJOR_POLARITY）。
const {
  NUMBER_POLARITY,
  SUIT_POLARITY_BIAS,
  COURT_RANK_INTENSITY,
  COURT_POLARITY,
  MAJOR_POLARITY,
  MAJOR_POLARITY_ZH,
  ELEMENT_TO_DIMENSION,
} = require('./ruleConfig')

const DIMENSION_KEYS = ['action', 'emotion', 'logic', 'material']

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const zeroDimensions = () => ({ action: 0, emotion: 0, logic: 0, material: 0 })

// 推導值無法表達的牌，逐張覆寫（以 nameEn 正規化後為鍵）
// 首批只列明顯偏離推導值的小牌；大牌極性走 MAJOR_POLARITY，不需列在這裡
// 數字啟發式在 7、9、10 最不準（同數字的四個花色差異極大，例如聖杯九是願望成真、寶劍九是焦慮），
// 因此這幾個數字的覆寫最多。清單會隨使用逐步補齊。
const CARD_OVERRIDES = {
  // 數字 3
  threeofswords: { polarity: -0.9 }, // 心碎，比數字 3 推導的 +0.5 嚴重得多
  // 數字 4
  fourofcups: { polarity: -0.3 }, // 倦怠、看不見眼前的機會
  // 數字 5
  fiveofpentacles: { polarity: -0.7 }, // 匱乏、被排除
  // 數字 7
  sevenofwands: { polarity: 0 }, // 防守、堅持立場，中性
  sevenofswords: { polarity: -0.5 }, // 欺瞞、投機
  sevenofpentacles: { polarity: 0.2 }, // 耐心等待與評估，偏正向
  // 數字 8
  eightofswords: { polarity: -0.5 }, // 受困、自我設限
  eightofcups: { polarity: -0.2 }, // 離開與放下，過程帶失落
  // 數字 9
  nineofcups: { polarity: 0.7 }, // 願望成真、滿足
  nineofpentacles: { polarity: 0.7 }, // 豐收、自律、獨立、富足
  nineofswords: { polarity: -0.8 }, // 焦慮、惡夢
  // 數字 10
  tenofwands: { polarity: -0.4 }, // 重擔、過度承擔
  tenofswords: { polarity: -0.9 }, // 徹底結束、背叛
  tenofpentacles: { dimensions: { material: 1, emotion: 0.5 }, polarity: 0.8 }, // 家業與傳承，兼具物質與情感
  tenofcups: { dimensions: { emotion: 1, material: 0.3 }, polarity: 0.9 }, // 圓滿的情感生活
}

function normalizeNameEn(nameEn) {
  return String(nameEn || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z]/g, '')
}

function getOverride(card) {
  return CARD_OVERRIDES[normalizeNameEn(card.nameEn)] || null
}

// 大牌極性：先比英文名，再比中文名；都比不到回傳 null（計入明朗度扣分）
function getMajorPolarity(card) {
  const byEn = MAJOR_POLARITY[normalizeNameEn(card.nameEn)]
  if (typeof byEn === 'number') {
    return byEn
  }
  const byZh = MAJOR_POLARITY_ZH[String(card.nameZh || '').trim()]
  return typeof byZh === 'number' ? byZh : null
}

// 由 profile（已含 element / suit / kind / numerology）推導維度向量與極性
// 回傳 { dimensions, polarity, intensity, polarityKnown }
function getCardVector(card, profile) {
  const override = getOverride(card)
  const dimensions = zeroDimensions()

  // 維度：元素對應軸。小牌的元素來自花色，大牌來自金色黎明對應，兩者都已在 profile 裡
  const axis = ELEMENT_TO_DIMENSION[profile.element]
  if (axis) {
    dimensions[axis] = 1
  }

  let polarity = 0
  let polarityKnown = true

  if (profile.kind === 'major') {
    const majorPolarity = getMajorPolarity(card)
    polarityKnown = majorPolarity !== null
    polarity = majorPolarity ?? 0
  } else if (profile.kind === 'court') {
    polarity = COURT_POLARITY
  } else {
    const base = NUMBER_POLARITY[profile.pipNumber]
    polarityKnown = typeof base === 'number'
    polarity = (base ?? 0) + (SUIT_POLARITY_BIAS[profile.suit] ?? 0)
  }

  if (override?.dimensions) {
    Object.assign(dimensions, override.dimensions)
  }
  if (typeof override?.polarity === 'number') {
    polarity = override.polarity
    polarityKnown = true
  }

  // 宮廷階級只影響強度，不影響極性
  const intensity = profile.kind === 'court' ? COURT_RANK_INTENSITY[profile.courtRank] ?? 1 : 1

  DIMENSION_KEYS.forEach((key) => {
    dimensions[key] = clamp(dimensions[key], 0, 1)
  })

  return {
    dimensions,
    polarity: clamp(polarity, -1, 1),
    intensity,
    polarityKnown,
  }
}

module.exports = {
  DIMENSION_KEYS,
  CARD_OVERRIDES,
  getCardVector,
}
