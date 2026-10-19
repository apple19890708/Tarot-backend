// covers：這個牌組管的事，用講話的口吻寫。
// 不要和四軸的 DIMENSION_LABELS 用同一組詞 —— 以前兩邊都叫「行動／情感／思維／物質」，
// 於是同一份報告會同時出現「主要在講情感」（四軸，含大牌元素）
// 與「缺少聖杯（情感）」（只看小牌花色），讀起來像自相矛盾。
const SUITS = {
  wands: { label: '權杖', element: 'fire', domain: '行動', covers: '做事和衝勁' },
  cups: { label: '聖杯', element: 'water', domain: '情感', covers: '感情和人' },
  swords: { label: '寶劍', element: 'air', domain: '思維', covers: '溝通和判斷' },
  pentacles: { label: '錢幣', element: 'earth', domain: '物質', covers: '錢和實際的東西' },
}

const ELEMENT_LABELS = {
  fire: '火',
  water: '水',
  air: '風',
  earth: '土',
}

// 金色黎明體系，一張大牌只取一個主要元素
const MAJOR_ELEMENTS_BY_NAME_EN = {
  fool: 'air',
  magician: 'air',
  highpriestess: 'water',
  empress: 'earth',
  emperor: 'fire',
  hierophant: 'earth',
  lovers: 'air',
  chariot: 'water',
  strength: 'fire',
  hermit: 'earth',
  wheeloffortune: 'fire',
  wheel: 'fire',
  justice: 'air',
  hangedman: 'water',
  death: 'water',
  temperance: 'fire',
  devil: 'earth',
  tower: 'fire',
  star: 'air',
  moon: 'water',
  sun: 'fire',
  judgement: 'fire',
  judgment: 'fire',
  world: 'earth',
}

const MAJOR_ELEMENTS_BY_NAME_ZH = {
  愚者: 'air',
  魔術師: 'air',
  女祭司: 'water',
  皇后: 'earth',
  皇帝: 'fire',
  教皇: 'earth',
  戀人: 'air',
  戰車: 'water',
  力量: 'fire',
  隱士: 'earth',
  命運之輪: 'fire',
  正義: 'air',
  吊人: 'water',
  倒吊人: 'water',
  死神: 'water',
  節制: 'fire',
  惡魔: 'earth',
  塔: 'fire',
  高塔: 'fire',
  星星: 'air',
  月亮: 'water',
  太陽: 'fire',
  審判: 'fire',
  世界: 'earth',
}

// 力量與正義在不同版本分別是 8 或 11 號，無法用編號判斷，故不列入
const MAJOR_ELEMENTS_BY_NUMBER = {
  0: 'air',
  1: 'air',
  2: 'water',
  3: 'earth',
  4: 'fire',
  5: 'earth',
  6: 'air',
  7: 'water',
  9: 'earth',
  10: 'fire',
  12: 'water',
  13: 'water',
  14: 'fire',
  15: 'earth',
  16: 'fire',
  17: 'air',
  18: 'water',
  19: 'fire',
  20: 'fire',
  21: 'earth',
}

const NUMBER_THEMES = {
  1: '開始',
  2: '抉擇、平衡',
  3: '成長、合作',
  4: '穩定',
  5: '衝突',
  6: '和諧、回復',
  7: '考驗、反思',
  8: '推進、掌控',
  9: '臨界、獨立',
  10: '完成或過載',
}

// 愚者（0）不在 1～10 的主題表內，另外定義
const ZERO_THEME = '起點、未知'

const COURT_RANKS = {
  page: { label: '侍者', pattern: /\bpage\b|侍者|侍從|隨從/i },
  knight: { label: '騎士', pattern: /\bknight\b|騎士/i },
  queen: { label: '王后', pattern: /\bqueen\b|王后|皇后/i },
  king: { label: '國王', pattern: /\bking\b|國王/i },
}

const WEIGHTS = {
  major: 3,
  court: 2,
  pip: 1,
}

const OTHERS_KEYWORDS = [
  '他',
  '她',
  '對方',
  '主管',
  '老闆',
  '同事',
  '伴侶',
  '男友',
  '女友',
  '男朋友',
  '女朋友',
  '老公',
  '老婆',
  '家人',
  '朋友',
  '客戶',
]

function normalizeNameEn(nameEn) {
  return String(nameEn || '')
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z]/g, '')
}

function getMajorElement(card) {
  return (
    MAJOR_ELEMENTS_BY_NAME_EN[normalizeNameEn(card.nameEn)] ||
    MAJOR_ELEMENTS_BY_NAME_ZH[String(card.nameZh || '').trim()] ||
    MAJOR_ELEMENTS_BY_NUMBER[card.number] ||
    null
  )
}

function getCourtRank(card) {
  const name = `${card.nameEn || ''} ${card.nameZh || ''}`
  const entry = Object.entries(COURT_RANKS).find(([, rank]) => rank.pattern.test(name))

  return entry ? entry[0] : null
}

// 大牌 11～21 以各位數相加化簡（例：13 → 4、19 → 10、21 → 3），0 與 1～10 維持原值
function reduceMajorNumber(number) {
  if (number <= 10) {
    return number
  }
  return String(number)
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0)
}

function getNumberTheme(number) {
  return number === 0 ? ZERO_THEME : NUMBER_THEMES[number] || null
}

function getCardProfile(card) {
  if (card.arcanaType === 'major') {
    const numerology = Number.isInteger(card.number) ? reduceMajorNumber(card.number) : null

    return {
      kind: 'major',
      element: getMajorElement(card),
      suit: null,
      courtRank: null,
      pipNumber: null,
      majorNumber: card.number,
      numerology,
      numberTheme: numerology === null ? null : getNumberTheme(numerology),
      weight: WEIGHTS.major,
    }
  }

  const courtRank = getCourtRank(card)
  const kind = courtRank ? 'court' : 'pip'
  const pipNumber = kind === 'pip' ? card.number : null

  return {
    kind,
    element: SUITS[card.suit]?.element || null,
    suit: card.suit,
    courtRank,
    pipNumber,
    majorNumber: null,
    // 宮廷牌不套用數字主題
    numerology: pipNumber,
    numberTheme: pipNumber === null ? null : getNumberTheme(pipNumber),
    weight: WEIGHTS[kind],
  }
}

module.exports = {
  SUITS,
  ELEMENT_LABELS,
  NUMBER_THEMES,
  COURT_RANKS,
  OTHERS_KEYWORDS,
  getCardProfile,
}
