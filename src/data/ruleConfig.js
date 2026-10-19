// 組合分析第二版（規則 7～10）的關鍵詞與門檻，詳見 doc/v02-tarot-combination-rules-plan.md

// 規則 7：問題領域與對應花色
// dimensions 為規則 11 的四軸關注度，一律非負且總和為 1（公式值域成立的前提）
const QUESTION_DOMAINS = {
  work: {
    label: '工作',
    keywords: ['工作', '職場', '轉職', '離職', '面試', '主管', '老闆', '同事', '升遷', '專案', '公司', '事業', '創業'],
    suits: ['wands', 'pentacles'],
    dimensions: { action: 0.35, emotion: 0.1, logic: 0.25, material: 0.3 },
  },
  money: {
    label: '財務',
    keywords: ['錢', '薪', '收入', '投資', '財務', '存款', '負債', '買房', '股票'],
    suits: ['pentacles'],
    dimensions: { action: 0.15, emotion: 0.05, logic: 0.25, material: 0.55 },
  },
  love: {
    label: '感情',
    keywords: ['感情', '愛', '伴侶', '交往', '曖昧', '復合', '分手', '結婚', '男友', '女友', '喜歡', '對象'],
    suits: ['cups'],
    dimensions: { action: 0.15, emotion: 0.6, logic: 0.15, material: 0.1 },
  },
  social: {
    label: '人際',
    keywords: ['朋友', '家人', '人際', '相處'],
    suits: ['cups'],
    dimensions: { action: 0.15, emotion: 0.55, logic: 0.2, material: 0.1 },
  },
  study: {
    label: '學業與決策',
    keywords: ['考試', '學業', '讀書', '選擇', '決定', '該不該'],
    suits: ['swords'],
    dimensions: { action: 0.15, emotion: 0.1, logic: 0.6, material: 0.15 },
  },
}

// 內部退路：選「自動判斷」但關鍵詞比對不到時使用的均等權重。
// 不開放使用者選取（「綜合／其他」已自選單移除），但必須保留，
// 否則判斷不出領域時規則 11 無法計算四軸權重。
const GENERAL_DOMAIN = {
  label: '綜合',
  suits: [],
  dimensions: { action: 0.25, emotion: 0.25, logic: 0.25, material: 0.25 },
}

// 使用者可明確指定的問題類型（規則 11 的 domain 參數），不含內部退路的 general
const SELECTABLE_DOMAINS = Object.keys(QUESTION_DOMAINS)

function getDomainConfig(domain) {
  return QUESTION_DOMAINS[domain] || GENERAL_DOMAIN
}

// 規則 9：數字階段（依化簡後的數字），order 用來判斷走向
const NUMBER_STAGES = {
  pre: { label: '起點之前', order: 0 },
  start: { label: '起步期', order: 1 },
  develop: { label: '發展與穩定期', order: 2 },
  trial: { label: '考驗與臨界期', order: 3 },
  end: { label: '結束或過載', order: 4 },
}

function getNumberStage(number) {
  if (number === 0) return 'pre'
  if (number <= 3) return 'start'
  if (number <= 6) return 'develop'
  if (number <= 9) return 'trial'
  return 'end'
}

// 大牌張數超過這個數就算外在／命運主導，與下面的比例門檻取其一成立即可。
// 十張的牌陣裡 4 張大牌只佔四成，但已經夠重，不該被說成「日常、個人可控」。
const MAJOR_COUNT_FATE_THRESHOLD = 3

// 大牌佔比的基準不是「是否過半」，而是「有沒有高於牌堆本身的比例」。
// 78 張裡有 22 張大牌 ≈ 28%，三張牌抽到一張大牌就是 33%，已經偏高；
// 用「過半」當門檻，小牌陣幾乎永遠會被判成日常。
const MAJOR_RATIO_NATURAL = 22 / 78
const MAJOR_RATIO_FATE = 0.4

// 高強度小牌：寶劍三（−0.9）、寶劍十（−0.9）這類牌在牌義上的份量不亞於大牌。
// 只數大牌張數會把它們當成日常小事（實測 19.6%）。
const HIGH_INTENSITY_POLARITY = 0.8

// 規則 10：權重門檻（含下限）
const WEIGHT_THRESHOLDS = {
  intensityMajor: 2.2, // 平均權重 ≥ 2.2：重大
  intensityMedium: 1.6, // 平均權重 ≥ 1.6：中等，以下為日常
  resistanceHigh: 0.5, // 逆位權重比 ≥ 0.5：阻力偏高
  resistanceSome: 0.3, // 逆位權重比 ≥ 0.3：有阻力，以下為阻力低
  weightedElementMargin: 1, // 加權元素第一名至少比第二名多 1 分才成立
}

// ---- 規則 11：量化指標（詳見 doc/v04-tarot-quant-analysis-plan.md）----

// 數字極性，沿用 NUMBER_THEMES 的語意
const NUMBER_POLARITY = {
  1: 0.5, // 開始
  2: 0.0, // 抉擇、平衡
  3: 0.5, // 成長、合作
  4: 0.3, // 穩定
  5: -0.6, // 衝突
  6: 0.5, // 和諧、回復
  7: -0.3, // 考驗、反思
  8: 0.4, // 推進、掌控
  9: -0.1, // 臨界、獨立
  10: 0.2, // 完成或過載
}

// 花色極性偏移（RWS 傳統上寶劍偏艱難）
const SUIT_POLARITY_BIAS = { wands: 0.05, cups: 0.05, swords: -0.25, pentacles: 0.05 }

// 宮廷牌：階級強度修正與預設極性
const COURT_RANK_INTENSITY = { page: 0.6, knight: 0.9, queen: 0.8, king: 1.0 }
const COURT_POLARITY = 0.2

// 大牌極性（計畫書 3.3.1，以名稱比對，不受力量／正義編號差異影響）
const MAJOR_POLARITY = {
  fool: 0.4,
  magician: 0.7,
  highpriestess: 0.2,
  empress: 0.8,
  emperor: 0.6,
  hierophant: 0.4,
  lovers: 0.7,
  chariot: 0.7,
  strength: 0.7,
  hermit: 0.1,
  wheeloffortune: 0.5,
  wheel: 0.5,
  justice: 0.3,
  hangedman: -0.3,
  death: -0.2,
  temperance: 0.6,
  devil: -0.8,
  tower: -0.8,
  star: 0.8,
  moon: -0.5,
  sun: 0.9,
  judgement: 0.5,
  judgment: 0.5,
  world: 0.9,
}

const MAJOR_POLARITY_ZH = {
  愚者: 0.4,
  愚人: 0.4,
  魔術師: 0.7,
  女祭司: 0.2,
  皇后: 0.8,
  皇帝: 0.6,
  教皇: 0.4,
  戀人: 0.7,
  戰車: 0.7,
  力量: 0.7,
  隱士: 0.1,
  命運之輪: 0.5,
  正義: 0.3,
  吊人: -0.3,
  倒吊人: -0.3,
  死神: -0.2,
  節制: 0.6,
  惡魔: -0.8,
  塔: -0.8,
  星星: 0.8,
  月亮: -0.5,
  太陽: 0.9,
  審判: 0.5,
  世界: 0.9,
}

const QUANT = {
  // 逆位：衰減外顯強度，不翻轉正負（規則 6）
  reversedAttenuation: 0.45,
  // 四軸第一名要比第二名多這麼多，才算得上「重心在這裡」。
  // 否則 0.25 對 0.24 也會被講成單一主軸，是假精確。
  axisMargin: 0.05,
  // 規則 11 的阻力門檻。不能沿用規則 10 的 0.5 ——
  // 那是為「逆位權重比」（上限 1.0）校準的；改看極性之後，
  // 純粹由逆位造成的阻力上限只有 0.9 × (1 − 0.45) ≈ 0.5，永遠踩不到門檻。
  resistanceHigh: 0.35,
  // 指向分級門檻（DI，-100 ~ 100）
  directionStrong: 60,
  directionMild: 20,
  // 明朗度扣分係數
  confidencePenalty: {
    unknownElement: 0.3,
    spread: 0.25, // 四軸能量分散（正規化熵）
    conflicts: 0.15,
    noDomain: 0.1,
  },
  confidenceLowThreshold: 0.5,
}

// 面向使用者的用語一律口語化，避免「正向／逆向」這類內部術語外露
const DIRECTION_LABELS = {
  strongPositive: '明顯順利',
  positive: '偏順利',
  neutral: '好壞參半',
  negative: '偏不順',
  strongNegative: '明顯不順',
}

// 四軸：整組牌的能量落在哪，含大牌的元素。
// 刻意不與 SUITS 的 domain 同名（見 cardAttributes.js 的說明）。
const DIMENSION_LABELS = { action: '行動', emotion: '感受', logic: '想法', material: '現實' }

// 四維度與四元素一一對應
const ELEMENT_TO_DIMENSION = { fire: 'action', water: 'emotion', air: 'logic', earth: 'material' }

module.exports = {
  QUESTION_DOMAINS,
  GENERAL_DOMAIN,
  SELECTABLE_DOMAINS,
  getDomainConfig,
  NUMBER_STAGES,
  getNumberStage,
  WEIGHT_THRESHOLDS,
  MAJOR_COUNT_FATE_THRESHOLD,
  MAJOR_RATIO_NATURAL,
  MAJOR_RATIO_FATE,
  HIGH_INTENSITY_POLARITY,
  NUMBER_POLARITY,
  SUIT_POLARITY_BIAS,
  COURT_RANK_INTENSITY,
  COURT_POLARITY,
  MAJOR_POLARITY,
  MAJOR_POLARITY_ZH,
  QUANT,
  DIRECTION_LABELS,
  DIMENSION_LABELS,
  ELEMENT_TO_DIMENSION,
}
