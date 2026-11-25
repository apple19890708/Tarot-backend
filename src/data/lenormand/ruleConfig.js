// 雷諾曼規則引擎的門檻與字典（v27，詳見 doc/v27-lenormand-plan.md 3-5）。調整門檻改這裡。
// 判斷在 src/services/lenormand/rules/，文字在 src/services/lenormand/formatter.js。
const { QUESTION_DOMAINS } = require('../ruleConfig')
const { deepFreeze } = require('../../lib/deepFreeze')

// ---- L1 牌性 ----
// 吉 − 凶 的張數佔全部的比例 ≥ LEAN_RATIO 算偏吉，≤ −LEAN_RATIO 算偏凶（3 張裡多 1 張就算傾向）
const TONE_LEAN_RATIO = 0.3
// 九宮格同一列（或欄）有幾張凶牌算「凶牌集中」
const NINE_BOX_CLUSTER_MIN = 2
// 比較牌性好壞用（L2 的轉折）
const TONE_RANK = { negative: 0, neutral: 1, positive: 2 }

// ---- L6 大藍圖的距離（切比雪夫距離：橫、直、斜走一步都算 1；9×4 最遠是 8）----
// 近：緊鄰中心的九宮；中：2～3 步；遠：4 步以上
const DISTANCE_NEAR_MAX = 1
const DISTANCE_MIDDLE_MAX = 3

// ---- 問題類型 → 主題牌（3-5 L8；小牌陣只標出主題牌有沒有出現）----
// 關鍵詞盡量沿用塔羅的 QUESTION_DOMAINS（複製一份再凍結，不會凍到塔羅的陣列）；健康、家庭是雷諾曼才有的類型。
// 不含股市：雷諾曼不開放股市諮詢。
// 判斷：命中關鍵詞最多的類型；同分時依 DOMAIN_ORDER 的順序。
// heuristic-check（2026-11-25，普查 500 題＋真實 21 題）找到的誤判：
//   「這隻貓好可愛」被判成感情（「愛」）→ DOMAIN_EXCLUDE_WORDS 先拿掉「可愛」「熱愛」再比對
//   「家人對租屋還是買房的態度」被判成家庭 → 家庭不放「租屋」（買房、租屋是財務）
//   「家人」塔羅歸人際，雷諾曼有家庭這一類 → 人際的副本拿掉「家人」
const LENORMAND_DOMAINS = {
  love: { label: '感情', themeCardId: 24, keywords: [...QUESTION_DOMAINS.love.keywords] },
  money: { label: '財務', themeCardId: 34, keywords: [...QUESTION_DOMAINS.money.keywords] },
  work: { label: '工作', themeCardId: 35, keywords: [...QUESTION_DOMAINS.work.keywords] },
  health: {
    label: '健康',
    themeCardId: 5,
    // 不放單字「病」「檢查」：「毛病」「檢查工作」會誤判
    keywords: ['健康', '身體', '生病', '疾病', '手術', '開刀', '住院', '醫院', '看醫生', '健檢', '體檢', '失眠', '睡眠', '懷孕', '體重', '減肥', '復健', '治療', '康復'],
  },
  family: {
    label: '家庭',
    themeCardId: 4,
    keywords: ['家人', '家庭', '家裡', '父母', '爸爸', '媽媽', '爸媽', '孩子', '小孩', '兒子', '女兒', '公婆', '岳父', '岳母', '搬家', '同住'],
  },
  social: { label: '人際', themeCardId: 20, keywords: QUESTION_DOMAINS.social.keywords.filter((word) => word !== '家人') },
  study: { label: '學業', themeCardId: 26, keywords: [...QUESTION_DOMAINS.study.keywords] },
}
const DOMAIN_ORDER = ['love', 'money', 'work', 'health', 'family', 'social', 'study']
// 比對前先從問題裡拿掉的詞：裡面含有關鍵字，但意思不同
const DOMAIN_EXCLUDE_WORDS = ['可愛', '熱愛']

// ---- L3 特殊組合字典 ----
// 只看相鄰的兩張（同一列左右相鄰；九宮格另含上下相鄰）。cards 沒有順序，除非有 condition：
//   condition: 'faces' → cards[0] 必須朝向 cards[1]（看 facing），例如說明書的「鸛鳥朝向蛇，蛇的負面被清除」
// meaning 是短語，完整句子由 formatter 組。由 Claude Code 撰寫，不是 AI 產生的。
const COMBOS = [
  { id: 'stork-snake', cards: [17, 7], condition: 'faces', tone: 'positive', meaning: '蛇的負面被清除，危機化解' },
  { id: 'ring-heart', cards: [25, 24], tone: 'positive', meaning: '承諾的感情' },
  { id: 'coffin-child', cards: [8, 13], tone: 'neutral', meaning: '舊的結束、新的開始' },
  { id: 'house-mice', cards: [4, 23], tone: 'negative', meaning: '家裡有損耗或不安' },
  { id: 'rider-letter', cards: [1, 27], tone: 'neutral', meaning: '很快收到書面消息' },
  { id: 'rider-heart', cards: [1, 24], tone: 'positive', meaning: '新的心意或戀情傳來' },
  { id: 'clover-sun', cards: [2, 31], tone: 'positive', meaning: '好運加倍，事情順利' },
  { id: 'ship-fish', cards: [3, 34], tone: 'positive', meaning: '遠方或貿易帶來收入' },
  { id: 'ship-house', cards: [3, 4], tone: 'neutral', meaning: '搬遷或離家' },
  { id: 'tree-coffin', cards: [5, 8], tone: 'negative', meaning: '健康需要多留意、好好休養' },
  { id: 'tree-sun', cards: [5, 31], tone: 'positive', meaning: '體力恢復，生命力旺盛' },
  { id: 'clouds-sun', cards: [6, 31], tone: 'positive', meaning: '雲散天晴，疑慮消除' },
  { id: 'clouds-key', cards: [6, 33], tone: 'positive', meaning: '釐清之後找到答案' },
  { id: 'snake-ring', cards: [7, 25], tone: 'negative', meaning: '不單純的約定，或關係裡有第三者' },
  { id: 'snake-heart', cards: [7, 24], tone: 'negative', meaning: '感情裡有心機或嫉妒' },
  { id: 'coffin-ring', cards: [8, 25], tone: 'negative', meaning: '合約或關係走到終點' },
  { id: 'coffin-heart', cards: [8, 24], tone: 'negative', meaning: '感情冷卻、心累' },
  { id: 'coffin-cross', cards: [8, 36], tone: 'negative', meaning: '沉重的低潮，需要休息' },
  { id: 'bouquet-heart', cards: [9, 24], tone: 'positive', meaning: '示好與浪漫' },
  { id: 'bouquet-ring', cards: [9, 25], tone: 'positive', meaning: '值得慶祝的約定，例如求婚或簽約' },
  { id: 'scythe-ring', cards: [10, 25], tone: 'negative', meaning: '突然解約或分開' },
  { id: 'scythe-tree', cards: [10, 5], tone: 'negative', meaning: '突發的健康狀況或手術' },
  { id: 'whip-heart', cards: [11, 24], tone: 'negative', meaning: '感情裡反覆的爭吵' },
  { id: 'whip-birds', cards: [11, 12], tone: 'negative', meaning: '激烈的言語衝突' },
  { id: 'birds-letter', cards: [12, 27], tone: 'neutral', meaning: '大量的訊息往來' },
  { id: 'child-heart', cards: [13, 24], tone: 'positive', meaning: '剛萌芽的感情' },
  { id: 'child-stork', cards: [13, 17], tone: 'positive', meaning: '懷孕或家中添新成員' },
  { id: 'fox-ring', cards: [14, 25], tone: 'negative', meaning: '不可靠的承諾，或合約裡有陷阱' },
  { id: 'fox-anchor', cards: [14, 35], tone: 'negative', meaning: '工作上有人耍心機' },
  { id: 'bear-fish', cards: [15, 34], tone: 'positive', meaning: '可觀的資產、財力雄厚' },
  { id: 'bear-tower', cards: [15, 19], tone: 'neutral', meaning: '權威機構或上級單位' },
  { id: 'stars-key', cards: [16, 33], tone: 'positive', meaning: '目標有望達成' },
  { id: 'stork-house', cards: [17, 4], tone: 'positive', meaning: '搬家，或居住環境改善' },
  { id: 'dog-heart', cards: [18, 24], tone: 'positive', meaning: '從友情發展的感情、忠誠的愛' },
  { id: 'dog-fox', cards: [18, 14], tone: 'negative', meaning: '看似朋友，其實不可信' },
  { id: 'tower-letter', cards: [19, 27], tone: 'neutral', meaning: '公文或官方文件' },
  { id: 'tower-book', cards: [19, 26], tone: 'neutral', meaning: '正式的進修或考試' },
  { id: 'garden-birds', cards: [20, 12], tone: 'neutral', meaning: '社交場合的交流，或消息在人群中流傳' },
  { id: 'garden-bouquet', cards: [20, 9], tone: 'positive', meaning: '熱鬧的聚會或慶祝' },
  { id: 'mountain-key', cards: [21, 33], tone: 'positive', meaning: '障礙終將被突破' },
  { id: 'mountain-anchor', cards: [21, 35], tone: 'negative', meaning: '工作停滯不前' },
  { id: 'crossroads-key', cards: [22, 33], tone: 'positive', meaning: '找到該走的路' },
  { id: 'crossroads-ship', cards: [22, 3], tone: 'neutral', meaning: '在遠行或改變之間抉擇' },
  { id: 'clover-crossroads', cards: [2, 22], tone: 'positive', meaning: '小小的好機會來自一個選擇' },
  { id: 'mice-fish', cards: [23, 34], tone: 'negative', meaning: '漏財、金錢慢慢流失' },
  { id: 'mice-tree', cards: [23, 5], tone: 'negative', meaning: '壓力耗損健康' },
  { id: 'heart-anchor', cards: [24, 35], tone: 'positive', meaning: '穩定長久的感情' },
  { id: 'ring-anchor', cards: [25, 35], tone: 'positive', meaning: '長期的契約，或穩定的工作' },
  { id: 'book-letter', cards: [26, 27], tone: 'neutral', meaning: '機密文件，或還沒公開的消息' },
  { id: 'book-key', cards: [26, 33], tone: 'positive', meaning: '祕密被解開，或學習有成' },
  { id: 'letter-fish', cards: [27, 34], tone: 'neutral', meaning: '帳單或款項通知' },
  { id: 'lily-heart', cards: [30, 24], tone: 'positive', meaning: '成熟穩定、親密和諧的感情' },
  { id: 'sun-anchor', cards: [31, 35], tone: 'positive', meaning: '事業成功、穩定發展' },
  { id: 'moon-stars', cards: [32, 16], tone: 'positive', meaning: '名聲與成就受到肯定' },
  { id: 'moon-heart', cards: [32, 24], tone: 'positive', meaning: '浪漫的情感' },
  { id: 'key-cross', cards: [33, 36], tone: 'positive', meaning: '負擔找到解法' },
  { id: 'fish-anchor', cards: [34, 35], tone: 'positive', meaning: '穩定的收入' },
  { id: 'cross-heart', cards: [36, 24], tone: 'negative', meaning: '感情裡的犧牲與負擔' },
  { id: 'lotus-coffin', cards: [37, 8], tone: 'positive', meaning: '結束之後重生' },
  { id: 'shadow-snake', cards: [38, 7], tone: 'negative', meaning: '檯面下的惡意' },
  { id: 'forest-key', cards: [39, 33], tone: 'positive', meaning: '在迷惘中找到指引' },
  { id: 'hourglass-ring', cards: [40, 25], tone: 'neutral', meaning: '約定有期限，承諾需要時間' },
  { id: 'mask-heart', cards: [41, 24], tone: 'negative', meaning: '感情裡沒有展現真心' },
  { id: 'gears-anchor', cards: [43, 35], tone: 'positive', meaning: '團隊合作讓工作穩定運轉' },
  { id: 'mirror-mask', cards: [46, 41], tone: 'neutral', meaning: '看清偽裝，面對真實' },
  { id: 'butterfly-heart', cards: [49, 24], tone: 'neutral', meaning: '輕盈但可能短暫的心動' },
  { id: 'bridge-mountain', cards: [50, 21], tone: 'positive', meaning: '找到跨越障礙的方法' },
  { id: 'wings-cross', cards: [51, 36], tone: 'positive', meaning: '從負擔中解脫' },
  { id: 'diamond-ring', cards: [52, 25], tone: 'positive', meaning: '珍貴而長久的承諾' },
]

// 朝向凶牌時能化解它的牌（說明書：鸛鳥朝向蛇可「吃掉」蛇的負面；牌義寫的是鸛鳥朝向凶牌都適用）。
// 字典裡已經有的組合（鸛鳥＋蛇）不重複列。
const CLEANSERS = [{ cardId: 17, targetTone: 'negative' }]

module.exports = deepFreeze({
  TONE_LEAN_RATIO,
  NINE_BOX_CLUSTER_MIN,
  TONE_RANK,
  DISTANCE_NEAR_MAX,
  DISTANCE_MIDDLE_MAX,
  LENORMAND_DOMAINS,
  DOMAIN_ORDER,
  DOMAIN_EXCLUDE_WORDS,
  COMBOS,
  CLEANSERS,
})
