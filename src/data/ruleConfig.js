// 組合分析第二版（規則 7～10）的關鍵詞與門檻，詳見 doc/v02-tarot-combination-rules-plan.md

// 規則 7：問題領域與對應花色
// dimensions 為規則 11 的四軸關注度，一律非負且總和為 1（公式值域成立的前提）
const QUESTION_DOMAINS = {
  work: {
    label: '工作',
    keywords: ['工作', '職場', '轉職', '離職', '面試', '主管', '老闆', '同事', '升遷', '專案', '公司', '事業', '創業', '案子', '客戶', '結案', '提案', '裁員', '績效', '考績', 'KPI', '重組'],
    suits: ['wands', 'pentacles'],
    dimensions: { action: 0.35, emotion: 0.1, logic: 0.25, material: 0.3 },
  },
  money: {
    label: '財務',
    keywords: ['錢', '薪', '收入', '投資', '財務', '存款', '負債', '買房', '股票', '財運', '理財', '開銷', '花費', 'ETF', '副業', '存錢', '賺錢', '基金', '退休金', '卡債'],
    suits: ['pentacles'],
    dimensions: { action: 0.15, emotion: 0.05, logic: 0.25, material: 0.55 },
  },
  love: {
    label: '感情',
    keywords: ['感情', '愛', '伴侶', '交往', '曖昧', '復合', '分手', '結婚', '男友', '女友', '喜歡', '對象', '男朋友', '女朋友', '前任', '告白', '老公', '老婆', '另一半', '求婚', '婚禮', '催婚'],
    suits: ['cups'],
    dimensions: { action: 0.15, emotion: 0.6, logic: 0.15, material: 0.1 },
  },
  social: {
    label: '人際',
    keywords: ['朋友', '家人', '人際', '相處'],
    suits: ['cups'],
    dimensions: { action: 0.15, emotion: 0.55, logic: 0.2, material: 0.1 },
  },
  // 股市諮詢：只有 admin 與開通「金融股市」的會員能選（STOCK_ONLY_DOMAINS）。
  // 不放關鍵詞，「自動判斷」不會判成這一類——股票相關的字仍歸「財務」，避免沒有權限的人在分析裡看到這個分類
  stock: {
    label: '股市',
    keywords: [],
    suits: ['pentacles'],
    dimensions: { action: 0.2, emotion: 0.05, logic: 0.35, material: 0.4 },
  },
  study: {
    label: '學業與決策',
    // 2026-11-19 拿掉「選擇」「決定」「該不該」：「該不該離開這座城市」被歸到學業與決策。
    // 一般的選擇題改由問題類型（choice／建議題）處理，這裡只留學業
    keywords: ['考試', '學業', '讀書', '研究所', '升學', '學校', '課業', '學測', '指考', '分科', '會考', '志願'],
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

// 只有能用金融股市功能的人（admin 與被開通的 member）可以指定的問題類型。
// 前端只是不顯示，真正的放行在後端各端點
const STOCK_ONLY_DOMAINS = ['stock']

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
  // 傾向條的三格分級：[第二格起點, 第三格起點]。前端直接顯示 levels，不自己定門檻。
  // 依 2 萬次隨機抽牌（1～10 張、四種領域）的分布切成約三等份（2026-11-04 量測）：
  //   momentum   33%=0.16 67%=0.29    resistance 33%=0.10 67%=0.20
  //   confidence 33%=0.72 67%=0.80    focus      33%=0.25 67%=0.51
  // 原本四項共用 0.3／0.5，推力約七成、阻力約九成落在最低格，可信度幾乎永遠是最高格，分級沒有資訊量。
  levels: {
    momentum: [0.15, 0.3],
    resistance: [0.1, 0.2],
    confidence: [0.72, 0.8],
    focus: [0.25, 0.5],
  },
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
  // confidenceLow 改為「可信度在最低一格」（levels.confidence === 1），不再另設門檻。
  // 原本的 0.5 低於實際分布的 10% 分位（0.64），提醒句幾乎從不出現。
}

// ---- 規則 12：是非題（詳見 doc/v23-tarot-yes-no-followup-plan.md）----
const YES_NO = {
  // 問題是不是是非題：會不會、是否、能不能、有沒有…，或以「嗎」收尾
  questionPattern: /會不會|是否|能不能|能否|能夠|可不可以|可否|有沒有|該不該|要不要|是不是|好不好|行不行|適不適合|值不值得|應不應該|需不需要|[嗎吗]|(?:不會|沒有|會|是).{0,20}吧[？?]?$|(?:會|能|可以|有|得住|得了).{0,20}[嘛ㄇ齁][？?]?$|得住[嘛ㄇ齁][？?]?$/,
  // 「該不該做」的問題（2026-11-19）：「是」＝建議這麼做，用好壞軸判斷，優先於變動／維持。
  // 「應該會」「應該是」是推測（大概會），不是問該不該
  advicePattern: /該不該|要不要|需不需要|應不應該|適不適合|值不值得|是不是該|應該(?!會|是|不會|也)|(?<![會更])適合.{0,20}[嗎吗]|值得.{0,20}[嗎吗]|需要.{0,20}[嗎吗]|^(?:那|我|那我)?(?:還)?要(?!不要|多久|等多久|等到(?:什麼|何時|哪))[^，,]{1,20}[嗎吗]|要再[^，,]{1,15}[嗎吗]|(?:^|我|你|那)該(?!不該|怎)[^，,]{1,20}[嗎吗]/,
  // 「是」＝事情會變動（結束、離開、被換）
  changeKeywords: [
    '換掉', '被換', '換人', '撤換', '下台', '卸任', '離職', '辭職', '請辭', '辭掉', '離開', '走人', '出走', '退出', '退休',
    '分手', '離婚', '分開', '結束', '終止', '解約', '取消', '破局', '倒閉', '破產', '收掉', '關門', '裁員', '被裁', '開除',
    '解雇', '解僱', '失去', '放棄', '搬家', '搬走', '跳槽', '轉職', '換工作', '轉行', '翻盤', '逆轉', '改變', '變心', '改需求', '變卦', '臨時改', '調去', '調職', '調部門', '調動', '趕走', '被趕', '會倒', '倒掉', '重組', '異動', '中斷', '喊停', '停止', '暫停', '停掉', '句點', '告吹', '解散', '散掉',
  ],
  // 「是」＝事情會維持
  stayKeywords: [
    '留任', '續任', '連任', '留下', '留得住', '繼續', '持續', '維持', '守住', '保住', '保得住', '撐住', '撐得住', '撐下去',
    '穩住', '續約', '不變', '走下去', '一直待', '待在', '這樣下去', '一直這樣', '保持下去', '守得住', '長久',
  ],
  // 「是」＝不好的事會發生（看好壞軸，方向反過來）
  unfavorableKeywords: [
    '失敗', '虧', '賠', '被騙', '出事', '惡化', '落榜', '被拒', '拒絕', '吵架', '生病', '出問題', '有問題', '後悔', '翻車',
    '下跌', '大跌', '崩盤', '套牢', '被甩', '受傷', '危險', '有別人', '第三者', '劈腿', '外遇', '說謊', '反對', '變差', '變糟', '比預期低', '低於預期', '減少', '大問題', '考差', '考不好', '不及格', '被當', '騙我', '欺騙', '出狀況', '出包', '出錯', '搞砸',
  ],
  // 好壞軸的逆位：正向牌逆位＝受阻，翻成負的 0.4 倍；負向牌逆位＝壞事退去，翻成正的 0.3 倍
  reversedPositive: 0.4,
  reversedNegative: 0.3,
  // 好壞軸扣掉的基準值（隨機抽牌的平均，見計畫書的量測），讓「會」和「不會」的機會相當
  favorableOffset: 0.05,
  // 擔心題（「會不會虧錢」）把受阻的好牌當中性之後，原本的基準值會讓答案偏向「不會」（模擬 3000 組：會 23%、不會 61%），
  // 另外校準：0.2 時隨機 3000 組約 會 39%／不會 37%／拉扯 24%；直接答「不會」變少（239 → 80 組），因為受阻的好牌不再推向不會（2026-11-19，見 doc/v25 決議紀錄）
  unfavorableOffset: 0.2,
  // 變動軸扣掉的基準值：逆位多半帶一點變動，隨機抽牌平均 +0.10，不扣的話七張牌陣有四成傾向「會變」、只有 7% 傾向「不會」
  changeOffset: 0.1,
  // 牌種的份量：大牌、宮廷牌略重。不沿用規則 10 的 3／2／1——一張宮廷牌就會蓋過其他兩張小牌
  kindWeights: { major: 1.5, court: 1.2, pip: 1 },
  // 結果、未來的位置加重
  outcomeKeys: ['outcome', 'future'],
  outcomeBoost: 1.5,
  // 分級門檻：|分數| × √張數 達 lean 才給傾向，達 strong 才直接說會／不會。
  // 分數是加權平均，張數越多越往 0 靠（互相抵消），乘上 √張數 後各種張數的分布幾乎一樣（2026-11-13 量測，2 萬次隨機抽牌）：
  //   |分數|×√張數 的 10% 分位約 0.05～0.06、50% 約 0.26～0.30、80% 約 0.50～0.57
  // 使用者要求「沒有明確答案」壓在 10% 左右（原本固定 0.15／0.4，三張牌陣有 42% 沒有明確答案）。
  // strong 0.55：約兩成直接說會或不會，其餘是傾向
  lean: 0.055,
  strong: 0.55,
}

const YES_NO_VERDICT_LABELS = {
  yes: '會',
  leanYes: '傾向會',
  unclear: '兩邊拉扯，看你怎麼做',
  leanNo: '傾向不會',
  no: '不會',
}

// 「該不該做」的問題用建議的說法（同一個判斷，換成提問者問的那種答案）
const ADVICE_VERDICT_LABELS = {
  yes: '建議做',
  leanYes: '傾向建議做',
  unclear: '兩邊拉扯，看你怎麼做',
  leanNo: '傾向不建議',
  no: '不建議',
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
  STOCK_ONLY_DOMAINS,
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
  YES_NO,
  YES_NO_VERDICT_LABELS,
  ADVICE_VERDICT_LABELS,
  DIRECTION_LABELS,
  DIMENSION_LABELS,
  ELEMENT_TO_DIMENSION,
}
