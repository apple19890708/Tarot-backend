const { SUITS, ELEMENT_LABELS, COURT_RANKS } = require('../data/cardAttributes')
const {
  QUESTION_DOMAINS,
  NUMBER_STAGES,
  DIRECTION_LABELS,
  DIMENSION_LABELS,
  QUANT,
} = require('../data/ruleConfig')
const { RELATION_KINDS, DEFAULT_KIND } = require('../data/relationKinds')

// 這個標籤算的純粹是「兩張牌的元素關係」（見 combinationRules.analyzePair），
// 與牌義無關。原本叫「增強／削弱」像在下價值判斷，但旁邊的辭典文字講的是牌義，
// 兩者本來就會不一致 —— 實測 46.5% 的牌對對不上（v10 Q3）。
// 改用描述元素的詞，讀者就不會把它當成好壞評分。
const RELATION_LABELS = {
  enhance: '元素相合',
  weaken: '元素相剋',
  cause: '數字接續',
  neutral: '元素無關',
}

// 規則 4 補充：中性配對依序採用的線索
const NEUTRAL_CLUES = [
  ['blocked', '由正位轉為逆位，同一股力量從外顯換成往內走'],
  ['unblocked', '由逆位轉為正位，原本壓著的開始浮上來'],
  ['majorToMinor', '從大牌落到小牌，大方向落到日常執行'],
  ['minorToMajor', '從小牌走到大牌，日常的累積引發較大的變化'],
  ['numberUp', '數字往上，帶有推進的意味'],
  ['numberDown', '數字往下，像是回頭重新整理'],
  ['numberRepeat', '數字相同，同一個主題被重複強調'],
]

// 面向使用者的用語一律口語化
const INTENSITY_LABELS = { major: '人生級的轉折', medium: '需要認真看待', daily: '生活小事' }
// 阻力只在規則 11 的指向分析顯示（它有計入位置權重），這裡保留欄位供相容
const RESISTANCE_LABELS = { high: '卡得明顯', some: '有點卡', low: '大致順利' }

function orientationLabel(orientation) {
  return orientation === 'upright' ? '正位' : '逆位'
}

// 敘述裡只標逆位。正位是常態，每張都寫「正位」會把句子撐得很長，
// 也讓真正該注意的逆位失去對比。
function cardLabel(entry) {
  const name = entry.orientation === 'reversed' ? `${entry.card.nameZh}逆位` : entry.card.nameZh
  return entry.label ? `${entry.label}的${name}` : name
}

// 只要位置與牌名，不帶正逆位（用在已經講過正逆位的句子裡，避免重複）
function cardNameOnly(entry) {
  return entry.label ? `${entry.label}的${entry.card.nameZh}` : entry.card.nameZh
}

function elementName(element) {
  return element ? `${ELEMENT_LABELS[element]}元素` : '元素未知'
}

// 「整體在說什麼」：焦點、大牌份量、花色與宮廷階級。
// 元素與數字另外成段（見 buildElementNumberText），它們和數字階段放在一起比較好讀。
// elevated 這一級是「大牌＋高強度小牌」加總算出來的，所以句子不能只報大牌張數。
// 沒有大牌時要改講小牌的份量，否則會說出「大牌 0 張，比例偏高」。
function heavyText(stats) {
  const heavy = stats.heavyMinorCount ?? 0
  if (stats.majorCount === 0) {
    return `${stats.total} 張裡沒有大牌，但有 ${heavy} 張份量很重的小牌，有一部分不完全在你手上。`
  }
  if (heavy === 0) {
    return `${stats.total} 張裡有 ${stats.majorCount} 張大牌，比例偏高，有一部分不完全在你手上。`
  }
  return `${stats.total} 張裡有 ${stats.majorCount} 張大牌、${heavy} 張份量很重的小牌，比例偏高，有一部分不完全在你手上。`
}

// 宮廷階級被強調時，要講出這代表什麼，不能只說「此階級被強調」——標籤已經寫了張數，
// 文字再報一次數字沒有資訊量。
const COURT_RANK_THEMES = {
  page: '事情帶著新開始、新消息，或還在摸索學習的味道',
  knight: '事情正在動，有人在推進或帶來變動',
  queen: '偏向用照顧和感受來掌握局面',
  king: '有人得拿主意、扛起責任',
}

// 花色：一句講完，兩個花色並列時順便講它們之間的關係（沿用牌與牌的元素組合說明）
function suitText(dominantSuits) {
  if (dominantSuits.length === 0) return ''
  const labels = dominantSuits.map(({ suit }) => SUITS[suit].label)
  const covers = dominantSuits.map(({ suit }) => SUITS[suit].covers)
  const counts = dominantSuits.map(({ count }) => count)
  const sameCount = counts.every((count) => count === counts[0])

  if (dominantSuits.length === 1) {
    return `${labels[0]}最多（${counts[0]} 張），重點在${covers[0]}。`
  }

  const countText = sameCount
    ? `${labels.join('和')}各 ${counts[0]} 張`
    : dominantSuits.map(({ count }, i) => `${labels[i]} ${count} 張`).join('、')
  const head = `${countText}，重點在${covers.join('、')}`

  if (dominantSuits.length === 2) {
    const [a, b] = dominantSuits.map(({ suit }) => SUITS[suit].element)
    const meaning = pairMeaning(a, b)
    if (meaning) return `${head}；這兩塊${meaning}。`
  }
  return `${head}。`
}

// 焦點牌有位置時寫成「落在『問題』位置的…」：直接接「問題的聖杯侍者」讀起來像牌名的一部分
function focusText(entry) {
  const name = entry.orientation === 'reversed' ? `${entry.card.nameZh}逆位` : entry.card.nameZh
  return entry.label ? `這組牌的焦點牌是落在「${entry.label}」位置的${name}。` : `這組牌的焦點牌是${name}。`
}

function buildThemeText(result, entries) {
  const { theme, stats } = result
  const lines = [focusText(entries[theme.focusIndex])]

  if (theme.dominance === 'fate') {
    lines.push(
      stats.majorCount > stats.total / 2
        ? `大牌有 ${stats.majorCount} 張，超過一半，這件事有不少部分由外在情勢主導。`
        : `大牌有 ${stats.majorCount} 張，數量已經不少，這件事有不少部分由外在情勢主導。`,
    )
  } else if (theme.dominance === 'elevated') {
    // 比牌堆本身的比例高，但還沒到主導。這一級的存在是為了和
    // 「大牌份量超過一半」那句對齊，不要一邊說可控一邊說不可控。
    lines.push(heavyText(stats))
  } else if (stats.majorCount === 0) {
    // 一張大牌都沒有時不用特別點名「大牌 0 張」
    lines.push('整組都是小牌，這件事多半在你自己處理得來的範圍。')
  } else {
    lines.push(`大牌只有 ${stats.majorCount} 張，這件事多半在你自己處理得來的範圍。`)
  }

  lines.push(suitText(theme.dominantSuits))

  theme.emphasizedCourtRanks.forEach(({ rank, count }) => {
    lines.push(`${COURT_RANKS[rank].label}有 ${count} 張，${COURT_RANK_THEMES[rank]}。`)
  })

  return lines.join('')
}

// 缺少的花色要再分兩種：真的整塊沒出現，和「沒有這組小牌、但大牌帶來的同元素補上了」。
// 後者不能說「這塊沒出現」，否則會和「火元素最多」這類句子互相矛盾。
// 「元素」區與結語都用這個判斷，兩邊才不會各說各話。
function splitMissingSuits(theme) {
  const coveredByMajor = theme.missingSuits.filter((suit) => theme.dominantElements.includes(SUITS[suit].element))
  return {
    coveredByMajor,
    trulyMissing: theme.missingSuits.filter((suit) => !coveredByMajor.includes(suit)),
  }
}

// 元素對應的花色，用來借花色的 covers 講「這個元素管什麼事」，兩邊用詞才一致
const SUIT_OF_ELEMENT = Object.fromEntries(Object.entries(SUITS).map(([suit, { element }]) => [element, suit]))

// 「元素」區。沒有任何可講的就回空字串，前端整區不顯示。
// v11：數字重複改由「走到哪個階段」講（那邊連大牌、宮廷牌都算進去），這裡只講元素，
// 欄位名稱 elementNumberText 保留給舊版前端。
function buildElementNumberText(result) {
  const { theme } = result
  const lines = []

  if (theme.dominantElements.length > 0) {
    const names = theme.dominantElements.map((element) => ELEMENT_LABELS[element]).join('和')
    const suits = theme.dominantElements.map((element) => SUIT_OF_ELEMENT[element])
    // 元素有算大牌、花色只看小牌。兩者剛好一致時，「整體在說什麼」已經講過重點，這裡不再重複
    const sameAsSuits =
      suits.length === theme.dominantSuits.length && suits.every((suit) => theme.dominantSuits.some((s) => s.suit === suit))
    lines.push(
      sameAsSuits
        ? `${names}元素最多，和花色看到的重點一致。`
        : `把大牌的元素也算進來，${names}元素最多，牌面偏重${suits.map((suit) => SUITS[suit].covers).join('、')}。`,
    )
  }

  // 缺少的花色：講出是哪一塊、可能代表什麼，不要只說「沒有被點到」。
  // 例如沒有權杖但有塔、皇帝這類火元素大牌時，改說大牌補上了這塊（見 splitMissingSuits）
  const { coveredByMajor, trulyMissing } = splitMissingSuits(theme)

  if (trulyMissing.length > 0) {
    const labels = joinList(trulyMissing.map((suit) => SUITS[suit].label))
    const covers = joinList(trulyMissing.map((suit) => SUITS[suit].covers), '、')
    const these = trulyMissing.length > 1 ? '這幾塊' : '這塊'
    lines.push(`這次沒有${labels}，${covers}${these}牌面沒有提到：可能不是這件事的重點，也可能是你暫時沒顧到的地方。`)
  }
  if (coveredByMajor.length > 0) {
    const labels = joinList(coveredByMajor.map((suit) => SUITS[suit].label))
    const elements = joinList(coveredByMajor.map((suit) => ELEMENT_LABELS[SUITS[suit].element]))
    lines.push(`雖然沒有${labels}的小牌，大牌帶來的${elements}元素補上了這塊。`)
  }

  return lines.join('')
}

// 「A和B」「A、B和C」；指定 separator 時一律用它連接
function joinList(items, separator = null) {
  if (separator) return items.join(separator)
  if (items.length <= 2) return items.join('和')
  return `${items.slice(0, -1).join('、')}和${items[items.length - 1]}`
}

// 用「面向」而不是「元素」描述，讀者才知道兩張牌實際上在互相影響什麼
const ELEMENT_ASPECT = { fire: '行動', water: '情感', air: '思維', earth: '現實條件' }

// 以元素組合（排序後）對應到具體的互動說明
const PAIR_MEANINGS = {
  'air|fire': '想法與行動配合得上，想到的事比較推得出去',
  'earth|water': '情感與現實條件互相支撐，感受和實際狀況對得上',
  'fire|water': '想往前推的力道與情緒的需求互相拉扯',
  'air|earth': '想法與實際條件對不上，計畫容易落不了地',
  'earth|fire': '一個偏實際、一個偏行動，各走各的',
  'air|water': '一個講道理、一個講感受，不在同一條線上',
}

function pairMeaning(a, b) {
  return PAIR_MEANINGS[[a, b].sort().join('|')] || null
}

// 正逆位會改變這股作用能不能展開，要講清楚，否則「互相增強」會與畫面上的逆位矛盾
function orientationNote(from, to) {
  const fromRev = from.orientation === 'reversed'
  const toRev = to.orientation === 'reversed'
  if (fromRev && toRev) {
    return '兩張都是逆位，這股作用現在使不太出來'
  }
  if (fromRev || toRev) {
    return `不過${cardNameOnly(fromRev ? from : to)}是逆位，這股作用現在使不出全力`
  }
  return null
}

function buildPairText(pair, entries) {
  const from = entries[pair.from]
  const to = entries[pair.to]
  const aspect = ELEMENT_ASPECT[from.profile.element]
  const meaning = pairMeaning(from.profile.element, to.profile.element)
  // 關係型態決定開頭怎麼帶（順承／橫跨／對照…），由牌陣宣告
  const kind = RELATION_KINDS[pair.kind] || RELATION_KINDS[DEFAULT_KIND]
  const head = kind.frame(cardLabel(from), cardLabel(to))

  const parts = []

  if (pair.relation === 'enhance' && pair.tags.includes('sameElement')) {
    parts.push(aspect ? `同樣都在講${aspect}，力道疊在一起，集中但也容易過頭` : '同一個面向疊加，力道集中但也容易過頭')
  } else if (meaning) {
    parts.push(meaning)
  } else {
    parts.push('其中一張的面向無法判定，這組的互動看不出來')
  }

  if (pair.relation === 'cause') {
    parts.push('數字依序往下走，前面那張像是後面那張的起因')
  } else if (pair.relation === 'neutral') {
    const clues = NEUTRAL_CLUES.filter(([tag]) => pair.tags.includes(tag)).map(([, text]) => text)
    if (clues.length > 0) {
      parts.push(`不過${clues.join('，')}`)
    }
  }

  if (pair.relation !== 'cause' && pair.tags.includes('numberProgression')) {
    parts.push('數字也依序遞進，有前後承接的意味')
  }

  const note = orientationNote(from, to)
  if (note) {
    parts.push(note)
  }

  return `${head}：${parts.join('；')}。`
}

// 宮廷牌當成一個人來講：階級是他的作風，花色（covers）是他在意的領域。
// 以前寫「侍者是宮廷裡最輕的階級，份量有限」，講的是權重表，讀者不知道這代表什麼。
const COURT_RANK_PERSONA = {
  page: '像個還在學、在打探消息的新手',
  knight: '像個急著行動、一路往前衝的人',
  queen: '像個用感受和照顧來掌握局面的人',
  king: '像個拿主意、扛責任的人',
}

// 宮廷牌所在的領域。SUITS.covers（感情和人、錢和實際的東西）接「在…上」讀起來不順，另外寫
const COURT_ARENA = {
  wands: '在做事上',
  cups: '在感情和人際上',
  swords: '在溝通和判斷上',
  pentacles: '在錢和現實的事上',
}

// 逆位時這個作風會變成什麼樣子。要具體，不要寫「作風沒有完全發揮」這種空話
const COURT_RANK_REVERSED = {
  page: '逆位時像是還沒準備好，消息不可靠，或學得半調子',
  knight: '逆位時容易衝過頭、衝錯方向，或急著出手',
  queen: '逆位時感受容易變成情緒化，照顧變成控制或疏遠',
  king: '逆位時拿主意容易變成獨斷，或該扛的責任沒扛起來',
}

// contributions 是依 |share| 排序過的陣列，不能用 index 直接取
function contributionOf(quant, index) {
  return quant?.contributions?.find((item) => item.index === index) || null
}

// 不輸出百分比。那個數字是三個極小數的比值（本局 v 分別是 0.20／0.03／0.04），
// 用兩位有效數字呈現會讓人以為有實證基礎，實際上權重表是自訂的。
// 用詞統一：share 是「把結果往順利／往不順拉了多少」，和畫面上「每張牌往哪邊拉」同一組詞。
// 「份量」只留給牌本身的輕重（位置、大牌、宮廷階級），不再拿來講 share。
const SHARE_LEVELS = [
  { min: 0.4, level: 'lead', text: (toward) => `是把結果${toward}拉最多的一張` },
  { min: 0.15, level: 'second', text: (toward) => `把結果${toward}拉了不少` },
  { min: 0, level: 'support', text: () => '對結果的影響不大' },
]

function shareLevelOf(share) {
  const value = Math.abs(share)
  return SHARE_LEVELS.find((item) => value >= item.min) || SHARE_LEVELS[SHARE_LEVELS.length - 1]
}

function towardOf(share) {
  return share >= 0 ? '往順利' : '往不順'
}

function shareText(share) {
  return shareLevelOf(share).text(towardOf(share))
}

// 階級的輕重，用來判斷它和帶動幅度是不是在講相反的事
const RANK_IS_HEAVY = { page: false, knight: true, queen: true, king: true }

// 宮廷牌的兩種讀法都要留著（v8 E）：「問題沒提到別人」只是預設值，不是判斷 ——
// 宮廷牌落在過去位很常指具體的人（前主管、前一個團隊的風格），關掉這個可能性等於放棄最有資訊量的入口。
// 也不要用「問題沒提到別人」當開場，問「我該不該買電腦」的人就是當事人。
// v11：讀法同一組牌通常都一樣，改在開場講一次，不再每張牌重複同一句。
function courtRoleText(role, subject) {
  return role === 'person'
    ? `${subject}可以看成問題裡的那個人，也反映你面對他的姿態。`
    : `${subject}可以看成你自己面對這件事的姿態；如果身邊真有這樣的人，也可以照著對。`
}

// showRole：同一組牌裡讀法不一致時，才在每張牌後面各自補上
//
// v11：這一區只講「這張宮廷牌是什麼樣的人，逆位時會變成什麼樣子」。
// 對結果的拉力只在明顯時才提（拉最多或拉了不少）；影響小就不寫 ——
// 「每張牌往哪邊拉」那區已經畫出來，這裡再講「這格比較重要，但影響不大」
// 讀者會覺得矛盾（落在「終局」的牌對結果影響不大？），而解釋原因又得搬出演算法。
function buildCourtText(court, entries, quant, showRole = false) {
  const entry = entries[court.index]
  const contribution = contributionOf(quant, court.index)
  const reversed = entry.orientation === 'reversed'
  const lines = [`${cardLabel(entry)}：${COURT_ARENA[entry.profile.suit]}，${COURT_RANK_PERSONA[court.rank]}。`]

  const level = contribution ? shareLevelOf(contribution.share).level : 'support'
  const notable = level !== 'support'

  if (reversed && notable) {
    // 逆位只打折、不反轉方向（規則 6）：逆位卻仍往順利拉時要用轉折接，否則讀起來像矛盾
    const impact = shareText(contribution.share)
    lines.push(
      contribution.share > 0
        ? `${COURT_RANK_REVERSED[court.rank]}；但整體來說，這張${level === 'lead' ? '仍' : '還是'}${impact}。`
        : `${COURT_RANK_REVERSED[court.rank]}，這張${impact}。`,
    )
  } else if (reversed) {
    lines.push(`${COURT_RANK_REVERSED[court.rank]}。`)
  } else if (notable) {
    // 階級輕（侍者）卻拉最多時用轉折
    const turn = !RANK_IS_HEAVY[court.rank] && level === 'lead' ? '不過這次' : '這次'
    lines.push(`${turn}${shareText(contribution.share)}。`)
  }

  if (showRole) {
    lines.push(courtRoleText(court.role, '這張牌'))
  }

  return lines.join('')
}

// 讀法是否整組一致；一致時在開場講一次
function courtRolesUniform(courts) {
  return new Set(courts.map((court) => court.role)).size === 1
}

// 整區的開場。沒有宮廷牌時也要有一句，不能整區空白
function buildCourtSummary(courts, entries, quant) {
  if (courts.length === 0) {
    return '這組牌沒有宮廷牌，人的因素不是重點，關鍵在事情本身怎麼走。'
  }

  const roleLine = courtRolesUniform(courts)
    ? courtRoleText(courts[0].role, courts.length === 1 ? '這張宮廷牌' : '這些宮廷牌')
    : '這些宮廷牌有的講人、有的講你自己的姿態，各張下面分別註明。'

  // 只有一張時不必比較誰影響最大
  if (courts.length === 1) {
    return roleLine
  }

  // 多張時先講誰影響最大，後面各自的句子才有比較基準
  const sorted = [...courts].sort((a, b) => {
    const sa = Math.abs(contributionOf(quant, a.index)?.share ?? 0)
    const sb = Math.abs(contributionOf(quant, b.index)?.share ?? 0)
    return sb - sa
  })

  // 排序依據是 share（影響結果的幅度），不是牌本身的份量，用詞要對上
  return `這組牌有 ${courts.length} 張宮廷牌，其中${cardNameOnly(entries[sorted[0].index])}對結果的影響最大。${roleLine}`
}

// 同型矛盾可能一次出現好幾組，句型輪替，不要整段都是同一句話
const ENHANCE_BLOCKED_PATTERNS = [
  (a, b, blocked) => `${a}和${b}本來能互相幫上忙，但${blocked}是逆位，這份助力現在使不出來。`,
  (a, b, blocked) => `${a}和${b}是同一股力量，可惜${blocked}逆位，兩邊串不起來。`,
  (a, b, blocked) => `${a}原本接得上${b}，但${blocked}逆位，接力到這裡斷了。`,
]

// 兩個位置隔得遠時要講出來。「過去」與「近未來」中間隔了整個現在，
// 說它們「本來能互相幫上忙」卻不交代距離，讀起來像兩張相鄰的牌（v10 Q10）。
function distanceNote(conflict, entries) {
  const gap = Math.abs(conflict.to - conflict.from)
  if (gap < 3 || !entries[conflict.from].hasPosition) {
    return ''
  }
  return '這兩格隔得遠，是跨越好幾個階段的呼應，不是接連發生的事；'
}

// 矛盾要講得出「實際上會怎樣」：點名位置、不用系統術語、講後果而不只是狀態
function buildConflictText(conflict, entries, order = 0) {
  if (conflict.type === 'enhanceWithBlocked') {
    const from = entries[conflict.from]
    const to = entries[conflict.to]
    const blocked = from.orientation === 'reversed' ? from : to
    const pattern = ENHANCE_BLOCKED_PATTERNS[order % ENHANCE_BLOCKED_PATTERNS.length]

    return distanceNote(conflict, entries) + pattern(cardNameOnly(from), cardNameOnly(to), blocked.card.nameZh)
  }

  if (conflict.type === 'focusOpposesDominantSuit') {
    const suit = SUITS[conflict.suit]
    const focus = entries[conflict.index]

    return `你最在意的是${cardNameOnly(focus)}，但整組牌的重心壓在${suit.label}（${suit.domain}）上。想的和實際要處理的不是同一件事，容易顧此失彼。`
  }

  return ''
}

function buildUncertaintyText(uncertainty, entries) {
  if (uncertainty.type === 'courtRoleWithoutQuestion') {
    const names = uncertainty.indexes.map((index) => cardLabel(entries[index])).join('、')
    return `未提供問題，${names}暫時視為性格或行動方式，也可能代表某位人物。`
  }

  if (uncertainty.type === 'unknownElement') {
    return `${cardLabel(entries[uncertainty.index])}無法判定元素，未納入元素分析。`
  }

  return ''
}

const suitWithDomain = (suit) => `${SUITS[suit].label}（${SUITS[suit].covers}）`
const listSuits = (suits) => suits.map(suitWithDomain).join('、')

function buildQuestionText(question) {
  const domains = question.domains.map((domain) => QUESTION_DOMAINS[domain].label).join('、')
  const head = `問題屬於${domains}，對應${listSuits(question.expectedSuits)}。`

  if (question.alignment === 'noMinor') {
    return `${head}這組全是大牌，議題超出單一生活領域。`
  }
  if (question.alignment === 'aligned') {
    return `${head}牌面以${listSuits(question.topSuits)}為主，正面回應了你問的領域。`
  }

  if (question.alignment === 'partial') {
    // 花色分散是塔羅的常態（同一件事本來就會從多個面向看），描述即可，不當成缺點
    const matched = question.expectedSuits.filter((suit) => question.topSuits.includes(suit))
    const others = question.topSuits.filter((suit) => !question.expectedSuits.includes(suit))
    return matched.length > 0
      ? `${head}${listSuits(matched)}有出現，牌面同時也從${listSuits(others)}的角度切入。`
      : `${head}對應的花色有出現，牌面則在${listSuits(question.topSuits)}著墨較多。`
  }
  // 只有在單一花色明顯主導時才下「真正卡住的在這裡」的判斷；
  // 散落在多個花色時只描述，不硬指方向
  if (question.topSuits.length === 1) {
    const suit = question.topSuits[0]
    return `${head}牌面沒有出現對應的牌組，反而以${suitWithDomain(suit)}為主；真正的重點可能在${SUITS[suit].covers}上。`
  }
  return `${head}牌面沒有出現對應的花色，而是分散在${listSuits(question.topSuits)}，這次的訊息不集中在你問的領域上。`
}

// 用講話的口吻寫，不用「往外使」「外顯」「力道」這類抽象詞。
// 正逆位在這裡的意思是：事情有沒有攤在檯面上、有沒有真的發生，不是好壞。
function buildPositionText(finding, entries) {
  const [a] = finding.evidence.map((index) => cardLabel(entries[index]))

  switch (finding.type) {
    case 'orientationTrend': {
      // 這一句的主詞就是正逆位，牌名不要再帶正逆位後綴，否則會寫出
      //「…未來的錢幣五正逆位交錯」這種黏在一起的句子
      const plain = finding.evidence.map((index) => cardNameOnly(entries[index]))
      const [, nb, nc] = plain
      const reversedNames = finding.evidence
        .filter((index) => entries[index].orientation === 'reversed')
        .map((index) => cardNameOnly(entries[index]))

      return {
        smooth: `${plain.join('、')}都是正位：從過去到未來，牌上說的事都會實際表現出來，不是悶在心裡。`,
        stuck: `${plain.join('、')}都是逆位：這些事大多還悶著、卡著，從外面不太看得出來。`,
        unblock: `${nb}還是逆位，到了${nc}轉成正位：之前悶著、卡住的事，接下來會開始動起來。`,
        blockAhead: `${nb}還是正位，到了${nc}變成逆位：現在看得到的動作，接下來可能慢下來或收回去。`,
        mixed: `${reversedNames.join('、')}是逆位，那裡的事還悶著、沒完全表現出來；其他格都是攤在檯面上的。`,
      }[finding.value]
    }
    // 助力位（資源／正面影響）
    case 'resourceReady':
      return `${a}：這是你手上現成的優勢，可以直接拿來用。`
    case 'resourceBlocked':
      return `${a}：你其實有這份優勢，只是現在還沒拿出來用。`
    // 負面的牌落在正向位置，讀法要跟著位置轉：不是「這格沒用」，而是幫助以不舒服的形式出現（v11）
    case 'resourceAdverse':
      return `${a}：這格是你的本錢，抽到的卻是偏負面的牌——你手上的優勢不是舒服的東西，而是吃過的虧、看清的事實，這些反而能拿來用。`
    case 'resourceAdverseMild':
      return `${a}：這格是你的本錢，牌意有點保留——能用的優勢藏在你不太想面對的那一面，先接受它才用得上。`
    case 'resourceRecovering':
      return `${a}：這張牌本來是扯後腿的，但壞的那面在減弱，慢慢能變成可以用的條件。`
    case 'supportActive':
      return `${a}：這份幫助是真的，現在就在幫你。`
    case 'supportBlocked':
      return `${a}：幫得上你的力量是有的，只是現在還沒真的出手。`
    case 'supportHollow':
      return `${a}：這格是助力，抽到的卻是偏負面的牌——幫你的不會是順順的支持，而是一次打擊或被迫面對的事，熬過去才會發現它推了你一把。`
    case 'supportHollowMild':
      return `${a}：這格是助力，牌意有點猶豫——幫助會來，但要你先把卡住的那一點想清楚，它才幫得上。`

    // 阻力位（負面影響）
    case 'negativeActive':
      return `${a}：這個麻煩現在正在發生，躲不掉，得正面處理。`
    case 'negativeEasing':
      return `${a}：這個麻煩是逆位，殺傷力打了折，沒有看起來那麼嚴重。`
    // 好牌落在負面位置也一樣要轉：麻煩出在好事本身，不是「沒什麼麻煩」
    case 'negativeMild':
      return `${a}：這格是負面影響，抽到的卻是偏正面的牌——麻煩出在好事本身，例如太順而鬆懈、太滿意而不想改變，要防的是自己放鬆。`

    // 希望與恐懼
    case 'hopesFearsClear':
      return `${a}：你很清楚自己想要什麼、怕什麼，兩件事沒有攪在一起。`
    case 'hopesFearsTangled':
      return `${a}：想要的和害怕的攪在一起，你可能自己也說不清楚到底想怎樣。`
    case 'hopesFearsHeavy':
      return `${a}：這格偏向害怕那一邊，擔心的比期待的多。`

    // 環境
    case 'environmentSupportive':
      return `${a}：身邊的人和外在條件是挺你的。`
    case 'environmentUnclear':
      return `${a}：外面是有人挺你的，只是還沒表態。`
    case 'environmentAdverse':
      return `${a}：外在條件不太友善，這部分得靠自己撐。`
    case 'environmentRecovering':
      return `${a}：外面的阻礙在變小，環境沒有之前那麼難了。`

    // 行動（你現在的做法）
    case 'actionSound':
      return `${a}：這個做法方向是對的，可以照著做下去。`
    case 'actionHesitant':
      return `${a}：做法本身沒問題，只是你還沒真的動手，或做得不夠到位。`
    case 'actionCostly':
      return `${a}：照這個做法走下去會付出代價，值得先停下來想想有沒有別條路。`
    case 'actionShaky':
      return `${a}：這個做法有些地方不太穩，邊做邊修正會比一次衝到底好。`
    case 'actionEasing':
      return `${a}：這個做法原本有風險，但壞的那面在減弱，代價沒有想像中大。`

    // 建議／對策。位置名稱由 cardLabel 帶出，這裡不寫死「建議」或「對策」
    case 'adviceDirect':
      return `${a}：方向很直接，照這張牌說的去做就好。`
    case 'adviceInner':
      return `${a}：這張是逆位，重點不在往外多做什麼，而是先把自己心裡卡住的地方鬆開。`
    // 負面的牌落在建議位，和 resourceAdverse 一樣要跟著位置轉讀法
    case 'adviceFaceIt':
      return `${a}：抽到偏負面的牌不是叫你往壞處走，而是要你正面面對這張牌說的那件難事，不要再繞過去。`
    case 'adviceFaceItMild':
      return `${a}：牌意有點保留——先承認這張牌點出的不舒服，再做決定，會比硬撐著往前好。`
    case 'adviceLetGo':
      return `${a}：這張偏負面的牌是逆位，建議是放下那份不安或舊包袱，它已經沒有那麼大的力量了。`

    // 隱藏的影響
    case 'hiddenHelp':
      return `${a}：你沒注意到的地方，其實有一股在幫你的力量。`
    case 'hiddenDormant':
      return `${a}：有一份還沒浮上檯面的助力，時機到了才會發揮。`
    case 'hiddenRisk':
      return `${a}：檯面下有你沒看到的麻煩，最好主動去查清楚，不要等它自己冒出來。`
    case 'hiddenDoubt':
      return `${a}：檯面下有些說不清的顧慮，可能是你或身邊的人沒說出口的事。`
    case 'hiddenFading':
      return `${a}：檯面下原本有的麻煩正在消退，影響沒有那麼大了。`

    // 核心與根基看的是大小牌，不是極性
    case 'coreMajor':
      return `${a}是大牌：這件事的核心不完全由你決定，有些得看時機和外在情勢。`
    case 'coreMinor':
      return `${a}是小牌：這件事的核心是具體的事情，你可以自己動手處理。`
    case 'foundationMajor':
      return `${a}是大牌：推著你的動機比你以為的深，可能連你自己都沒完全察覺。`
    case 'foundationMinor':
      return `${a}是小牌：背後的動機很單純，你自己說得出來。`

    default:
      return ''
  }
}

// 階段的口語說法。NUMBER_STAGES.label（起步期、考驗與臨界期…）像術語，讀者要自己翻譯
const STAGE_PLAIN = {
  pre: '還沒開始',
  start: '剛起步',
  develop: '穩住、發展',
  trial: '面對考驗',
  end: '收尾或過載',
}
const stagePlain = (step) => `${STAGE_PLAIN[step.stage]}的階段`

// 依 numberStage.timeline（index 清單）取回時間線上的步驟；舊資料沒有 timeline 時整條 sequence 都算
function timelineSteps(numberStage) {
  const byIndex = new Map(numberStage.sequence.map((step) => [step.index, step]))
  return (numberStage.timeline ?? numberStage.sequence.map((step) => step.index)).map((index) => byIndex.get(index))
}

// 終點落在起點之前／起步期：一輪走完、重新開始。
// 用階段判斷而不是數字：宮廷牌沒有數字（侍者對到起步期）。
function endsAtRestart(steps) {
  const end = steps[steps.length - 1]
  return end.stage === 'pre' || end.stage === 'start'
}

// 走向的說法。只有兩格時不說「一路」，兩點之間談不上一路推進。
const SHAPE_TEXT = {
  // 同階段不等於停滯。數字相同是「同一個主題被重複強調」，
  // 這也是 NEUTRAL_CLUES 的 numberRepeat 一直在用的說法。
  flat: ({ first }) => `時間線上都在${first}，同一個主題被重複強調。`,
  rising: ({ first, last, count }) => (count > 2 ? `從${first}一路往前，走到${last}。` : `從${first}走到${last}。`),
  falling: ({ first, last, restart }) =>
    restart ? `從${first}退回${last}，像是一輪走完、要重新起步。` : `從${first}退回${last}，像是要回頭重新整理。`,
  peak: ({ last, extreme, restart }) =>
    restart ? `中間走到${extreme}，最後回到${last}，像是一輪走完、要重新起步。` : `中間走到${extreme}，最後收在${last}。`,
  dip: ({ last, extreme }) => `中間退回${extreme}，後面又拉回來，收在${last}。`,
  zigzag: () => '時間線上一下前進、一下後退，節奏不太穩。',
}

// 每張牌在階段裡的記號：大牌寫出化簡過程（13→4），宮廷牌寫階級，讀者才知道數字從哪來
function stepMark(step, entry) {
  if (step.kind === 'court') {
    return COURT_RANKS[entry.profile.courtRank].label
  }
  return step.kind === 'major' && step.majorNumber !== step.number ? `${step.majorNumber}→${step.number}` : `${step.number}`
}

function stepText(step, entries) {
  const entry = entries[step.index]
  const label = entry.label ? `${entry.label} ` : ''
  const theme = step.themeLabel ? `．${step.themeLabel}` : ''
  return `${label}${entry.card.nameZh}（${stepMark(step, entry)}${theme}）`
}

// v11：走向只看時間線（過去／現在／未來／結果這類位置），其他格只列出階段、不畫箭頭。
// 回傳三樣：
//   text    完整文字（含路徑列舉），給 AI 解讀與舊版前端
//   summary 只有結論，前端畫了時間軸時用它，避免路徑講兩次
//   steps   每張牌的記號與階段，給前端畫時間軸
function buildNumberStage(numberStage, entries, quant) {
  const { sequence } = numberStage
  const timeline = timelineSteps(numberStage)
  const inTimeline = new Set(timeline.map((step) => step.index))
  const others = sequence.filter((step) => !inTimeline.has(step.index))
  const hasPositions = entries.some((entry) => entry.hasPosition)

  const pathLines = []
  const summary = []

  if (timeline.length >= 2) {
    pathLines.push(
      `${hasPositions ? '時間線' : '依抽牌順序'}：${timeline.map((step) => stepText(step, entries)).join(' → ')}。`,
    )

    const orders = timeline.map((step) => NUMBER_STAGES[step.stage].order)
    const extremeOrder = numberStage.shape === 'dip' ? Math.min(...orders) : Math.max(...orders)
    summary.push(
      SHAPE_TEXT[numberStage.shape]({
        first: stagePlain(timeline[0]),
        last: stagePlain(timeline[timeline.length - 1]),
        extreme: stagePlain(timeline[orders.indexOf(extremeOrder)]),
        restart: endsAtRestart(timeline),
        count: timeline.length,
      }),
    )
    // 兩點之間只看得出方向，看不出過程
    if (timeline.length === 2) {
      summary.push('只有兩格能比較，走向參考就好。')
    }
  } else if (hasPositions) {
    summary.push('這個牌陣沒有能排出先後的時間位置，只看各格落在哪個階段，不談走向。')
  } else {
    summary.push('只有一張牌能看階段，看不出走向。')
  }

  if (others.length > 0) {
    const head = timeline.length >= 2 ? '其他格不是時間點，不算進走向' : '各格'
    pathLines.push(`${head}：${others.map((step) => stepText(step, entries)).join('、')}。`)
  }

  // 同一個數字出現多次時，在這裡就講，不要丟給「元素與數字」那段各說各話（v10 Q7）
  // 宮廷牌沒有數字，不參與「同一個數字重複」的判斷
  const numberCounts = {}
  sequence
    .filter((step) => step.number !== null)
    .forEach((step) => {
      numberCounts[step.number] = (numberCounts[step.number] || 0) + 1
    })
  const repeated = Object.entries(numberCounts).filter(([, count]) => count >= 2)
  if (repeated.length > 0) {
    const text = repeated
      .map(([number, count]) => {
        const theme = sequence.find((step) => String(step.number) === number)
        return `${number}（${theme?.themeLabel || ''}）出現 ${count} 次`
      })
      .join('、')
    summary.push(`數字 ${text}，同一個主題被重複強調。`)
  }

  const steps = sequence.map((step) => {
    const entry = entries[step.index]
    return {
      index: step.index,
      label: entry.label ?? null,
      name: entry.card.nameZh,
      mark: stepMark(step, entry),
      theme: step.themeLabel ?? null,
      stage: step.stage,
      stageLabel: STAGE_PLAIN[step.stage],
    }
  })

  return {
    text: [...pathLines, ...summary].join(''),
    summary: summary.join(''),
    steps,
  }
}

// 焦點牌由 buildThemeText 獨佔，這裡不再重講一次（v8 A8）
function buildWeightText(weights, entries, dominance) {
  const lines = [`這件事的規模是${INTENSITY_LABELS[weights.intensity]}。`]

  // intensity 只算牌卡權重的平均，和牌陣大小無關，於是十張牌陣常被判成「生活小事」
  // （實測 21.8%），三張牌陣常被判成「人生級的轉折」（22%）。
  // 牌陣的選擇本身就表達了份量，判定不改，但要把落差講出來（v10 Q4）。
  if (entries.length >= 10 && weights.intensity === 'daily') {
    lines.push('不過會攤開這麼多張牌來問，通常不是小事；這個分級只看牌本身的輕重，沒把你選的牌陣算進去。')
  } else if (entries.length <= 3 && weights.intensity === 'major') {
    lines.push('不過這次只抽了三張，分級容易被單張大牌拉高，當成方向看就好。')
  }

  // 只有大牌↔小牌這種跨兩階的轉折才講，而且要講清楚是哪一種轉折，
  // 不要寫成「分量越走越輕」這種看不出依據的句子。
  if (weights.trend === 'rising') {
    lines.push('從小牌走到大牌，事情從日常層面升到你不能完全控制的層面。')
  } else if (weights.trend === 'falling') {
    lines.push('從大牌走到小牌，大方向底定之後，剩下的是具體執行。')
  }

  if (weights.majorShiftsElement) {
    lines.push(`把大牌算進來之後，${ELEMENT_LABELS[weights.weightedDominant]}這個元素最突出。`)
  }

  // 「份量」專指牌卡權重佔比，不要再叫「影響力」——
  // 那個詞在指向分析裡指的是 DI 貢獻，兩個是不同的量（v8 A2）。
  // 還要與「議題偏向日常」那句對齊，否則會出現可控與不可控同時成立（v8 A5）。
  if (weights.majorWeightShare >= 0.5) {
    lines.push(
      dominance === 'personal'
        ? '大牌張數不多，份量卻超過一半，有些地方還是推不動的。'
        : '大牌的份量超過一半，這件事有不少部分不是你能完全掌控的。',
    )
  }

  return lines.join('')
}

// 指向（好不好）與正逆位（順不順）是兩個不同的軸，兩者不一致時措辭要分清楚
const NEGATIVE_DIRECTIONS = new Set(['strongNegative', 'negative'])

// 規則 11：文字只講分級與傾向，不寫出 DI 數字（避免假精確感）
function buildQuantText(quant, entries) {
  const lines = []
  const axes = Object.entries(quant.energy).sort((a, b) => b[1] - a[1])
  const [topAxis, secondAxis] = axes

  lines.push(`從${quant.domainLabel}來看，整體${DIRECTION_LABELS[quant.direction]}。`)

  // 第一名要明顯領先才敢說「重心在這裡」，差一點點就只說兩邊相當
  if (topAxis && topAxis[1] > 0) {
    const margin = topAxis[1] - (secondAxis?.[1] ?? 0)
    lines.push(
      margin >= QUANT.axisMargin
        ? `這組牌的力氣主要花在「${DIMENSION_LABELS[topAxis[0]]}」上。`
        : `「${DIMENSION_LABELS[topAxis[0]]}」和「${DIMENSION_LABELS[secondAxis[0]]}」的份量差不多，沒有單一的重心。`,
    )
  }

  // 阻力是用份量算的，不是張數。大牌權重 3，單張逆位大牌就可能讓阻力過半，
  // 這時候講「逆位的牌佔了不少」會與畫面上的張數矛盾，要改說它份量重。
  const top = quant.contributions[0]
  const reversed = entries.filter((entry) => entry.orientation === 'reversed')
  const heavyResistance = quant.resistance >= QUANT.resistanceHigh
  // 影響最大的牌剛好就是唯一的逆位牌時，兩句話會重複講同一張牌，合併成一句
  const soleReversedIsTop =
    heavyResistance && reversed.length === 1 && top && entries[top.index] === reversed[0]

  // 用詞和畫面上的「每張牌往哪邊拉」對齊：往順利／往不順。
  // 以前寫「帶動整體走向」「這和份量最重的那張是兩回事」，但畫面上沒有任何東西叫「份量最重」，
  // 讀者對不起來。改成直接點名，不再拿另一張牌比較：
  // 「焦點牌」已在 theme.text 講過，這裡再提會觸發 assertConsistency 的「焦點牌被講兩次」。
  if (top && top.share !== 0) {
    const toward = top.share > 0 ? '往順利' : '往不順'
    if (soleReversedIsTop) {
      const name = cardNameOnly(entries[top.index])
      lines.push(
        top.share > 0
          ? `${toward}拉最多的是${name}，但它是逆位，力道出不來，推進時會卡。`
          : `${toward}拉最多的是${name}，又是逆位，推進時會卡。`,
      )
    } else {
      const card = cardLabel(entries[top.index])
      // 正位的牌卻往不順拉，光看「正位」像是前後矛盾，補一句原因在牌義本身
      const fromMeaning =
        top.share < 0 && entries[top.index].orientation === 'upright' ? '這張是正位，往不順拉是因為牌義本身就偏消極。' : ''
      lines.push(`${toward}拉最多的是${card}。${fromMeaning}`)
    }
  }

  if (heavyResistance && !soleReversedIsTop) {
    // v9：阻力有兩個來源，要講對是哪一種，否則會出現「沒有任何逆位牌
    // 卻說逆位的牌份量不小」這種與畫面對不上的句子。
    const byMeaning = quant.resistanceFromMeaning ?? 0
    const byReversal = quant.resistanceFromReversal ?? 0

    if (reversed.length === 0 || byMeaning > byReversal * 2) {
      lines.push('卡住的不是逆位，是這些牌本身就偏滯。')
    } else if (byReversal > byMeaning * 2) {
      // 純粹是逆位讓力道出不來，這時才適合比張數
      const reversedRatio = reversed.length / entries.length
      if (reversed.length === 1) {
        lines.push(`只有${cardNameOnly(reversed[0])}是逆位，但它份量夠重，力道出不來。`)
      } else if (reversedRatio < 0.5) {
        lines.push('逆位的牌雖然不多，份量卻不小，力道一時出不來。')
      } else if (reversedRatio === 0.5) {
        lines.push('正逆各半，但逆位那半份量更重，力道出不來。')
      } else {
        lines.push('逆位的牌過半，多數力量現在都收在裡面。')
      }
    } else {
      lines.push('一邊是牌本身就偏滯，一邊是逆位讓力道出不來，兩種都有。')
    }
  } else if (quant.levels.momentum === 3 && quant.levels.resistance < 3) {
    // momentum 現在算的是「正向極性且使得出來」的佔比，與牌義一致，
    // 所以這裡可以直接說推得動，不必再替算錯的數字圓場。
    // 用分級而不是固定 0.5：要和畫面上「推力：相當充足」那格對得起來。
    lines.push('牌本身是正向的，力道也使得出來，推得動。')
  } else if (quant.levels.momentum === 1 && quant.levels.resistance === 1) {
    // 推力、阻力兩格都在最低一格時，畫面上看起來像「什麼都沒有」，要講明這代表平靜
    lines.push('推的力量和卡的力量都不大，局面目前偏平靜，不太會自己大起大落。')
  }

  if (quant.confidenceLow) {
    lines.push('不過這組牌的訊息比較雜，當參考就好。')
  }

  return lines.join('')
}

// pairTexts：辭典查到的文字，Map<key, { text, source }>。查不到就用規則運算的結果。
// 整份報告的共同結論。各區塊的文字都該引用這裡，不要自己重算 ——
// 以前每段各算各的，才會出現「議題偏向日常」與「不是你能完全掌控」同時成立。
function buildVerdict(result) {
  const axes = Object.entries(result.quant?.energy || {}).sort((a, b) => b[1] - a[1])
  const [topAxis, secondAxis] = axes
  const axisDecisive = Boolean(topAxis && topAxis[1] > 0 && topAxis[1] - (secondAxis?.[1] ?? 0) >= QUANT.axisMargin)

  return {
    // 重心面向：差距不夠就是 null，不要硬指一個
    axis: axisDecisive ? topAxis[0] : null,
    tiedAxes: axisDecisive ? null : axes.slice(0, 2).map(([key]) => key),
    dominance: result.theme.dominance,
    majorHeavy: (result.weights?.majorWeightShare ?? 0) >= 0.5,
    dominantSuits: result.theme.dominantSuits.map((item) => item.suit),
    missingSuits: result.theme.missingSuits,
    leadIndex: result.quant?.contributions?.[0]?.index ?? null,
    focusIndex: result.theme.focusIndex,
    // 唯一的主牌。焦點牌看的是牌本身的份量，是塔羅師會先看的那張；
    // 帶動幅度與宮廷階級降為補充，不得再各自宣告「最重要」（v10 Q1）。
    primaryIndex: result.theme.focusIndex,
  }
}

// 互斥組合的守門員。只在測試環境拋錯，正式環境不因為措辭問題讓請求失敗。
const CONTRADICTIONS = [
  {
    name: '可控與不可控同時成立',
    hit: (texts) =>
      texts.some((t) => t.includes('由個人可控') || t.includes('自己處理得來的範圍')) &&
      texts.some((t) => t.includes('不是你能完全掌控')),
  },
  {
    name: '同時宣告單一重心又說份量相當',
    hit: (texts) => texts.some((t) => t.includes('力氣主要花在')) && texts.some((t) => t.includes('份量差不多')),
  },
  {
    name: '焦點牌被講兩次',
    hit: (texts) => texts.filter((t) => t.includes('焦點牌')).length > 1,
  },
  {
    // 例：「火元素最多」又說「這次沒有權杖」。大牌補上的花色要講成「雖然沒有權杖的小牌」（見 splitMissingSuits）
    name: '元素最多卻說沒有對應的花色',
    hit: (texts) =>
      Object.values(SUITS).some(
        ({ label, element }) =>
          texts.some((t) => new RegExp(`[火水風土和]*${ELEMENT_LABELS[element]}[火水風土和]*元素最多`).test(t)) &&
          texts.some((t) => new RegExp(`這次沒有[^，。]*${label}`).test(t)),
      ),
  },
]

function assertConsistency(analysis) {
  if (process.env.NODE_ENV === 'production') {
    return
  }
  const texts = [
    analysis.theme.text,
    analysis.theme.elementNumberText,
    analysis.weights.text,
    analysis.quant?.text,
    analysis.question?.text,
    analysis.numberStage?.text,
  ].filter(Boolean)

  const hit = CONTRADICTIONS.find((rule) => rule.hit(texts))
  if (hit) {
    throw new Error(`判斷依據自相矛盾：${hit.name}`)
  }
}

function formatAnalysis(result, rawEntries, pairTexts = null) {
  const entries = rawEntries.map((entry, index) => ({ ...entry, profile: result.profiles[index] }))
  const verdict = buildVerdict(result)

  const analysis = {
    verdict,
    theme: {
      ...result.theme,
      text: buildThemeText(result, entries),
      // 新增欄位：元素與數字的分布，前端放在「走到哪個階段」下方
      elementNumberText: buildElementNumberText(result),
    },
    pairs: result.pairs.map((pair) => {
      const from = entries[pair.from]
      const to = entries[pair.to]
      const key = `${from.card.slug}|${from.orientation}>${to.card.slug}|${to.orientation}`
      const hit = pairTexts?.get(key)

      return {
        ...pair,
        relationLabel: RELATION_LABELS[pair.relation],
        kindLabel: (RELATION_KINDS[pair.kind] || RELATION_KINDS[DEFAULT_KIND]).label,
        // 辭典優先，查不到才用規則運算
        text: hit?.text || buildPairText(pair, entries),
        textSource: hit?.source || 'rule',
      }
    }),
    courts: result.courts.map((court) => ({
      ...court,
      text: buildCourtText(court, entries, result.quant, !courtRolesUniform(result.courts)),
    })),
    // 新增欄位：沒有宮廷牌時也要有一句，前端不要整區隱藏
    courtSummary: buildCourtSummary(result.courts, entries, result.quant),
    conflicts: result.conflicts.map((conflict, order) => ({
      ...conflict,
      text: buildConflictText(conflict, entries, order),
    })),
    uncertainties: result.uncertainties.map((uncertainty) => ({
      ...uncertainty,
      text: buildUncertaintyText(uncertainty, entries),
    })),
    quant: result.quant
      ? {
          ...result.quant,
          directionLabel: DIRECTION_LABELS[result.quant.direction],
          text: buildQuantText(result.quant, entries),
        }
      : null,
    question: result.question ? { ...result.question, text: buildQuestionText(result.question) } : null,
    positions: result.positions.map((finding) => ({ ...finding, text: buildPositionText(finding, entries) })),
    numberStage: result.numberStage
      ? { ...result.numberStage, ...buildNumberStage(result.numberStage, entries, result.quant) }
      : null,
    weights: {
      ...result.weights,
      intensityLabel: INTENSITY_LABELS[result.weights.intensity],
      resistanceLabel: RESISTANCE_LABELS[result.weights.resistance],
      text: buildWeightText(result.weights, entries, result.theme.dominance),
    },
    stats: result.stats,
  }

  assertConsistency(analysis)

  return analysis
}

// 結語裡的階段走向，比 SHAPE_TEXT 更短，不重述階段名稱
// 和 SHAPE_TEXT 一樣，下降到 1～3 是「重新起步」不是「收尾」。
// 之前只改了階段區塊，結語這份漏掉，是同一個 bug 的兩個出口。
const SHAPE_SUMMARY = {
  flat: () => '時間線上都落在同一個階段，同一個主題被重複強調。',
  // 不說「方向是對的」：往前推進不等於好事，好壞看的是上面的走向
  rising: () => '時間線上一路往前推進。',
  falling: (restart) =>
    restart ? '時間線上走回起點，像是一輪走完、要重新開始。' : '時間線上在往回走，像是要回頭重新整理。',
  peak: (restart) =>
    restart ? '時間線上中間衝到最高，最後回到起點，像是一輪走完了。' : '時間線上中間衝到最高，後面要收尾。',
  dip: () => '時間線上中間掉下去過，後來又拉回來。',
  zigzag: () => '時間線上一下前進、一下後退，節奏不太穩。',
}

// 規則版的提問。依序比對，最多取兩題 —— 問題一多就失焦，反而沒人回答。
// 每題都要綁在這次牌面的具體事實上，不能是通用的心靈雞湯。
const GUIDANCE_QUESTIONS = [
  {
    // 有「本來能幫上忙卻使不出來」的矛盾時，這通常是最該問的
    fact: 'conflict',
    when: (ctx) => ctx.blockedConflict,
    ask: (ctx) =>
      `${cardNameOnly(ctx.entries[ctx.blockedConflict.from])}那份使不出來的助力，是你還沒決定，還是在等別人表態？`,
  },
  {
    // 影響結果最多的那張是逆位：力道出不來的原因在內還是在外
    fact: 'lead',
    when: (ctx) => ctx.lead && ctx.entries[ctx.lead.index].orientation === 'reversed',
    ask: (ctx) =>
      `${cardNameOnly(ctx.entries[ctx.lead.index])}卡住，是外面的條件不配合，還是你自己還沒鬆手？`,
  },
  {
    // 議題有一部分不在自己手上：問怎麼應對，而不是問會怎樣
    fact: 'dominance',
    when: (ctx) => ctx.dominance !== 'personal',
    ask: () => '不在你手上的那一部分，你打算配合它，還是繞過它？',
  },
  {
    // 缺少的牌組往往是刻意沒去想的那塊
    fact: 'missing',
    when: (ctx) => ctx.missingCovers.length > 0,
    ask: (ctx) => `${ctx.missingCovers[0]}這塊這次沒出現，是真的不重要，還是你暫時不想碰？`,
  },
  {
    // 最後一格：問你希望它是哪一種，而不是宣告它會是什麼
    fact: 'last',
    when: (ctx) => ctx.last.hasPosition,
    // 問的是事情，不是牌：「你希望寶劍騎士往哪走」讀起來像在問一張牌
    ask: (ctx) => `想讓${ctx.last.label}往你要的方向走，這週能做的第一件事是什麼？`,
  },
]

// mentioned：前文已經陳述過的事實。提問不該把剛講完的事再問一次
// （v10 Q8，實測 36.9% 的結語把「缺少的牌組」講兩次）。
function buildGuidanceQuestions(result, entries, last, mentioned) {
  const ctx = {
    entries,
    last,
    lead: result.quant?.contributions?.[0] || null,
    dominance: result.theme.dominance,
    blockedConflict: result.conflicts.find((item) => item.type === 'enhanceWithBlocked') || null,
    missingCovers: splitMissingSuits(result.theme).trulyMissing.map((suit) => SUITS[suit].covers),
  }

  const usable = GUIDANCE_QUESTIONS.filter((rule) => rule.when(ctx) && !mentioned.has(rule.fact))
  // 全部都講過時退回「落點」那題，它是提問而非陳述，重複的感覺最輕
  const chosen = usable.length > 0 ? usable : GUIDANCE_QUESTIONS.filter((rule) => rule.when(ctx)).slice(-1)

  return chosen.slice(0, 2).map((rule) => rule.ask(ctx))
}

// 結語。v11 改成先下總結再展開，不再一條一條列事實：
//   一、整體：走向＋這件事有多少在你手上
//   二、關鍵牌：往順利／往不順拉最多的牌
//   三、重點與盲點：主要花色（並列時全部講）、真的沒出現的那塊
//   四、要留意的卡點：矛盾點只取第一個
//   五、時間線上的走向
//   六、終局（落點）代表什麼：只報牌名沒有資訊量，宮廷牌講出人物樣貌
//   七、留問題給自己
// 不逐張列舉（每張牌下面本來就有完整牌義）。
const CONTROL_TEXT = {
  personal: '多半還在你自己處理得來的範圍',
  elevated: '有一部分不完全在你手上',
  fate: '有不少部分不是你能完全掌控的',
}

function lastCardText(last) {
  const name = `${last.label}落在${last.card.nameZh}${last.orientation === 'reversed' ? '逆位' : ''}`
  if (last.profile.kind === 'court') {
    const rank = last.profile.courtRank
    const look = last.orientation === 'reversed' ? COURT_RANK_REVERSED[rank] : COURT_RANK_PERSONA[rank]
    return `${name}：${COURT_ARENA[last.profile.suit]}，${look}。`
  }
  // 其他牌的牌義在牌卡上，這裡只指出要回頭看哪一張
  return `${name}，這張的牌義值得多看一眼。`
}

function buildGuidance(result, rawEntries) {
  const entries = rawEntries.map((entry, index) => ({ ...entry, profile: result.profiles[index] }))

  if (entries.length === 1) {
    return `這次只有${cardLabel(entries[0])}一張，就照它說的看。`
  }

  const contributions = result.quant?.contributions || []
  const lines = []
  // 記下結語已經陳述過的事實，最後的提問不要再問一次同一件事
  const mentioned = new Set()

  // 一、整體
  const direction = result.quant ? DIRECTION_LABELS[result.quant.direction] : null
  const control = CONTROL_TEXT[result.theme.dominance] ?? CONTROL_TEXT.personal
  if (result.theme.dominance !== 'personal') mentioned.add('dominance')
  lines.push(direction ? `整體來看${direction}，這件事${control}。` : `這件事${control}。`)

  // 二、關鍵牌。contributions 依 |share| 排序，第一名必定是往順利或往不順其中一方，
  // 和反方向拉最多的那張合成一句，不要把同一張牌講兩次
  const top = contributions[0]
  if (top && top.share !== 0) {
    const other = contributions.find((item) => Math.sign(item.share) === -Math.sign(top.share))
    const head = `關鍵在${cardLabel(entries[top.index])}，它把結果${towardOf(top.share)}拉得最多`
    lines.push(other ? `${head}；${cardNameOnly(entries[other.index])}則${towardOf(other.share)}拉。` : `${head}。`)
  }

  // 三、重點與盲點。花色並列時全部講，只挑第一個會漏掉一半
  const focusCovers = result.theme.dominantSuits.map(({ suit }) => SUITS[suit].covers)
  const { trulyMissing } = splitMissingSuits(result.theme)
  const missingCovers = trulyMissing.map((suit) => SUITS[suit].covers)
  if (missingCovers.length > 0) mentioned.add('missing')
  if (focusCovers.length > 0 && missingCovers.length > 0) {
    lines.push(`牌面的焦點在${focusCovers.join('、')}；${missingCovers.join('、')}這塊沒出現，可能是容易被忽略的地方。`)
  } else if (focusCovers.length > 0) {
    lines.push(`牌面的焦點在${focusCovers.join('、')}。`)
  } else if (missingCovers.length > 0) {
    lines.push(`${missingCovers.join('、')}這塊沒出現，可能是容易被忽略的地方。`)
  }

  // 四、要留意的卡點
  const conflict = result.conflicts[0]
  if (conflict) {
    mentioned.add('conflict')
    lines.push(`要留意的是，${buildConflictText(conflict, entries)}`)
  }

  // 五、時間線上的走向（少於兩格時 shape 是 null，不談走向）
  const stage = result.numberStage
  if (stage && stage.shape && SHAPE_SUMMARY[stage.shape]) {
    lines.push(SHAPE_SUMMARY[stage.shape](endsAtRestart(timelineSteps(stage))))
  }

  // 六、終局（落點）：描述它代表什麼，但不下宣判
  // 終局剛好就是關鍵牌時，第二點已經點名過，不再講一次
  const lastIndex = entries.length - 1
  const last = entries[lastIndex]
  if (last.hasPosition && lastIndex !== top?.index) {
    lines.push(lastCardText(last))
  }

  if (result.quant?.confidenceLow) {
    lines.push('這組牌的訊息比較雜，當參考就好。')
  }

  // 七、留問題給自己。規則版的保底，AI 解讀會依這次的牌寫得更貼身（見 narrationService 的 SYSTEM_PROMPT）
  const questions = buildGuidanceQuestions(result, entries, last, mentioned)
  if (questions.length > 0) {
    lines.push(`接下來值得自己回答：${questions.join('')}`)
  }

  return lines.join('')
}

module.exports = {
  formatAnalysis,
  buildGuidance,
  // 匯出供測試檢查守門員本身有效
  CONTRADICTIONS,
}
