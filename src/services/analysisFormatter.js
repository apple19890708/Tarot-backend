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

function buildThemeText(result, entries) {
  const { theme, stats } = result
  const focus = entries[theme.focusIndex]
  const lines = [`焦點牌是${cardLabel(focus)}。`]

  if (theme.dominance === 'fate') {
    lines.push(
      stats.majorCount > stats.total / 2
        ? `大牌有 ${stats.majorCount} 張，超過總數 ${stats.total} 張的一半，議題偏向由外在或命運層面主導。`
        : `大牌有 ${stats.majorCount} 張，數量已經不少，議題偏向由外在或命運層面主導。`,
    )
  } else if (theme.dominance === 'elevated') {
    // 比牌堆本身的比例高，但還沒到主導。這一級的存在是為了和
    // 「大牌份量超過一半」那句對齊，不要一邊說可控一邊說不可控。
    lines.push(heavyText(stats))
  } else if (stats.majorCount === 0) {
    // 一張大牌都沒有時不用特別點名「大牌 0 張」
    lines.push('整組都是小牌，議題偏向日常，由個人可控。')
  } else {
    lines.push(`大牌只有 ${stats.majorCount} 張，議題偏向日常，由個人可控。`)
  }

  theme.emphasizedCourtRanks.forEach(({ rank, count }) => {
    lines.push(`${COURT_RANKS[rank].label}出現 ${count} 張，此階級被強調。`)
  })

  theme.dominantSuits.forEach(({ suit, count }) => {
    lines.push(`${SUITS[suit].label}出現 ${count} 張，${SUITS[suit].covers}這一塊是重點。`)
  })

  return lines.join('')
}

// 元素與數字的分布。沒有任何可講的就回空字串，前端整區不顯示。
function buildElementNumberText(result) {
  const { theme } = result
  const lines = []

  theme.emphasizedNumbers.forEach(({ number, count, theme: numberTheme }) => {
    lines.push(`數字 ${number} 出現 ${count} 張，「${numberTheme}」的主題被強調。`)
  })

  if (theme.dominantElements.length > 0) {
    const elements = theme.dominantElements.map((element) => ELEMENT_LABELS[element]).join('、')
    lines.push(`元素以${elements}最多。`)
  }

  if (theme.missingSuits.length > 0) {
    const missing = theme.missingSuits.map((suit) => `${SUITS[suit].label}（${SUITS[suit].covers}）`).join('、')
    lines.push(`這次一張${missing}都沒出現，那幾塊沒有被直接點到。`)
  }

  return lines.join('')
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

// 宮廷階級在這組牌裡的份量（COURT_RANK_INTENSITY：page 0.6／knight 0.9／queen 0.8／king 1.0）
const COURT_RANK_WEIGHT_TEXT = {
  page: '侍者是宮廷裡最輕的階級，份量有限',
  knight: '騎士的衝勁強，份量不輕',
  queen: '皇后的份量僅次於國王',
  king: '國王是宮廷裡份量最重的階級',
}

// contributions 是依 |share| 排序過的陣列，不能用 index 直接取
function contributionOf(quant, index) {
  return quant?.contributions?.find((item) => item.index === index) || null
}

// 不輸出百分比。那個數字是三個極小數的比值（本局 v 分別是 0.20／0.03／0.04），
// 用兩位有效數字呈現會讓人以為有實證基礎，實際上權重表是自訂的。
const SHARE_LEVELS = [
  { min: 0.4, level: 'lead', text: '在整組裡說話最大聲' },
  { min: 0.15, level: 'second', text: '在整組裡也有一定的份量' },
  { min: 0, level: 'support', text: '在整組裡只是輔助的角色' },
]

function shareLevelOf(share) {
  const value = Math.abs(share)
  return SHARE_LEVELS.find((item) => value >= item.min) || SHARE_LEVELS[SHARE_LEVELS.length - 1]
}

function shareText(share) {
  return shareLevelOf(share).text
}

// 不論代表誰，都先講它在這組牌裡有多重，再講角色
// 階級的輕重，用來判斷它和帶動幅度是不是在講相反的事
const RANK_IS_HEAVY = { page: false, knight: true, queen: true, king: true }

function buildCourtText(court, entries, quant) {
  const entry = entries[court.index]
  const contribution = contributionOf(quant, court.index)

  // 一句只講一件事。階級與位置是「這張牌本來有多重」，
  // 帶動幅度是「這次它實際帶動了多少」，兩者可以相反，
  // 塞在同一句裡就會變成「份量最重的階級…只是輔助的角色」（v10 Q2，實測 69.1%）。
  const standing = [COURT_RANK_WEIGHT_TEXT[court.rank]]

  if (contribution) {
    // 位置權重已正規化，均分時每張是 1/n，明顯高於均分才值得一提
    const average = 1 / entries.length
    if (contribution.weight >= average * 1.2) {
      standing.push('又落在權重較高的位置')
    }
  }

  const parts = [standing.join('，')]

  if (contribution) {
    const level = shareLevelOf(contribution.share).level
    const heavyRank = RANK_IS_HEAVY[court.rank]
    // 階級重卻帶不動、或階級輕卻帶得動，都要用轉折詞接，不能平鋪直敘
    const turn =
      (heavyRank && level === 'support') || (!heavyRank && level === 'lead') ? '不過這次' : '這次'
    parts.push(`${turn}${shareText(contribution.share)}`)
  }

  // 兩種讀法都留著。「問題沒提到別人」只是預設值，不是判斷 ——
  // 宮廷牌落在過去位很常指具體的人（前主管、前一個團隊的風格），
  // 直接關掉這個可能性等於放棄這組牌最有資訊量的入口。
  // 不要用「問題沒提到別人」當開場 —— 問「我該不該買電腦」的人就是當事人，
  // 說「沒提到別人」會讓人覺得系統沒看懂問題。直接講這張牌代表誰。
  const role =
    court.role === 'person'
      ? '這張牌講的是問題裡那個人；同時也反映你面對他的姿態'
      : '這張牌講的是你自己處理這件事的方式；如果背後其實有個具體的人，也可以照著對'

  return `${cardLabel(entry)}：${parts.join('。')}。${role}。`
}

// 整區的開場。沒有宮廷牌時也要有一句，不能整區空白
function buildCourtSummary(courts, entries, quant) {
  if (courts.length === 0) {
    return '這組牌沒有宮廷牌，人的因素不是重點，關鍵在事情本身怎麼走。'
  }

  // 只有一張時，下面那張牌自己的句子就說完了，不再加一句廢話
  if (courts.length === 1) {
    return ''
  }

  // 多張時先講誰最重，後面各自的句子才有比較基準
  const sorted = [...courts].sort((a, b) => {
    const sa = Math.abs(contributionOf(quant, a.index)?.share ?? 0)
    const sb = Math.abs(contributionOf(quant, b.index)?.share ?? 0)
    return sb - sa
  })

  return `這組牌有 ${courts.length} 張宮廷牌，其中${cardNameOnly(entries[sorted[0].index])}份量最重。`
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

function buildPositionText(finding, entries) {
  const [a, b, c] = finding.evidence.map((index) => cardLabel(entries[index]))
  const elementOf = (index) => elementName(entries[index].profile.element)

  switch (finding.type) {
    case 'orientationTrend': {
      // 這一句的主詞就是正逆位，牌名不要再帶正逆位後綴，否則會寫出
      //「…未來的錢幣五正逆位交錯」這種黏在一起的句子
      const plain = finding.evidence.map((index) => cardNameOnly(entries[index]))
      const reversedNames = finding.evidence
        .filter((index) => entries[index].orientation === 'reversed')
        .map((index) => cardNameOnly(entries[index]))

      return {
        smooth: `${plain.join('、')}三格都是正位，這些力量都是往外使的。`,
        stuck: `${plain.join('、')}三格都是逆位，這些力量目前都往內走，沒有外顯。`,
        unblock: `${b}之後是${c}，由逆轉正，原本收著的開始往外走。`,
        blockAhead: `${b}之後是${c}，由正轉逆，力道由外顯轉為收在內部。`,
        mixed: `這三格裡${reversedNames.join('、')}是逆位，其餘往外使得出來。`,
      }[finding.value]
    }
    // 助力位（資源／正面影響）
    case 'resourceReady':
      return `${a}：這份優勢現在使得出來，可以直接拿來用。`
    case 'resourceBlocked':
      return `${a}：這份優勢是有的，只是現在沒有往外使出來。`
    case 'resourceAdverse':
      return `${a}：這一格本來該是你的本錢，但這張牌本身就偏滯，先別指望它。`
    case 'resourceAdverseMild':
      return `${a}：這一格算是本錢，不過這張牌有所保留，能用的程度有限。`
    case 'resourceRecovering':
      return `${a}：這一格原本是拖累，不過力道在減弱，慢慢能當本錢用。`
    case 'supportActive':
      return `${a}：這份助力是實際在發揮的，不是只存在於想像。`
    case 'supportBlocked':
      return `${a}：這份助力是有的，只是現在沒有往外使出來。`
    case 'supportHollow':
      return `${a}：這一格該是助力，牌本身卻偏負面，指望它不如自己想辦法。`
    case 'supportHollowMild':
      return `${a}：這一格該是助力，但這張牌本身有點猶豫，幫得有限。`

    // 阻力位（負面影響）
    case 'negativeActive':
      return `${a}：這股阻力現在是明顯在起作用的，閃不掉。`
    case 'negativeEasing':
      return `${a}：阻力的力道沒有全開，影響比看起來輕。`
    case 'negativeMild':
      return `${a}：這一格雖然標著負面影響，牌本身其實不壞，沒那麼難處理。`

    // 希望與恐懼
    case 'hopesFearsClear':
      return `${a}：你清楚自己在期待什麼，也清楚在怕什麼，兩者沒有混在一起。`
    case 'hopesFearsTangled':
      return `${a}：期待與恐懼糾纏在一起，你可能也分不清自己真正想要什麼。`
    case 'hopesFearsHeavy':
      return `${a}：這一格偏向恐懼那一邊，你擔心的成分多過期待的。`

    // 環境
    case 'environmentSupportive':
      return `${a}：外在條件與他人的態度是站在你這邊的。`
    case 'environmentUnclear':
      return `${a}：外在支持是有的，只是還沒明朗化。`
    case 'environmentAdverse':
      return `${a}：外在條件並不友善，這一塊得自己扛。`
    case 'environmentRecovering':
      return `${a}：外在的阻力在減弱，環境沒有先前那麼難。`

    // 核心與根基看的是大小牌，不是極性
    case 'coreMajor':
      return `${a}是大牌，核心議題超出個人能完全掌控的範圍。`
    case 'coreMinor':
      return `${a}是小牌，核心議題落在具體、可以著手處理的層面。`
    case 'foundationMajor':
      return `${a}是大牌，真正的動力來自你自己也未必完全察覺的層面。`
    case 'foundationMinor':
      return `${a}是小牌，底下的動機相對單純，你自己說得出來。`

    default:
      return ''
  }
}

// 走向的說法。peak／dip 會多收到一個中間極值的階段名稱。
const SHAPE_TEXT = {
  // 同階段不等於停滯。數字相同是「同一個主題被重複強調」，
  // 這也是 NEUTRAL_CLUES 的 numberRepeat 一直在用的說法。
  flat: (first) => `都落在${first}，同一個主題被重複強調。`,
  rising: (first, last) => `從${first}一路推到${last}。`,
  falling: (first, last, extreme, endNumber) =>
    endNumber !== null && endNumber <= 3
      ? `從${first}一路退回${last}，一輪走完了，接下來是重新起步。`
      : `從${first}一路退回${last}，像是要回頭重新整理。`,
  // 下降到 1～3 是「重新開始」，不是「收尾」。終點數字由 buildNumberStageText 帶進來。
  peak: (first, last, extreme, endNumber) =>
    endNumber !== null && endNumber <= 3
      ? `中段衝到${extreme}，最後回到${last}，像是一輪走完要重新起步。`
      : `中段衝到${extreme}，最後收在${last}。`,
  dip: (first, last, extreme) => `中間掉到${extreme}，後面又拉回來，收在${last}。`,
  zigzag: () => '階段起伏不定，節奏不穩。',
}

// v7：講「走到哪個階段」，依牌陣順序走一遍。
// 不再輸出分布（「○○ 2 張」）與主軸（「以○○為主」），那兩句看不出推進。
function buildNumberStageText(numberStage, entries, quant) {
  const { sequence, shape, skipped } = numberStage
  const stageLabel = (step) => NUMBER_STAGES[step.stage].label
  const ordered = entries.some((entry) => entry.hasPosition) ? '依牌陣順序' : '依抽牌順序'

  // 每一站帶上數字主題。只分期會把「抉擇、平衡」這種語意壓成「起步期」，
  // 錢幣二因此被說成原地踏步。
  const path = sequence
    .map((step) => {
      const theme = entries[step.index].profile.numberTheme
      const number = theme ? `${step.number}．${theme}` : `${step.number}`
      return `${entries[step.index].label} ${entries[step.index].card.nameZh}（${number}）`
    })
    .join(' → ')

  const lines = [`${ordered}：${path}。`]

  if (sequence.length >= 2) {
    const orders = sequence.map((step) => NUMBER_STAGES[step.stage].order)
    const extremeOrder = shape === 'dip' ? Math.min(...orders) : Math.max(...orders)
    const extreme = stageLabel(sequence[orders.indexOf(extremeOrder)])

    const endNumber = sequence[sequence.length - 1].number
    lines.push(
      SHAPE_TEXT[shape](stageLabel(sequence[0]), stageLabel(sequence[sequence.length - 1]), extreme, endNumber),
    )
  } else {
    lines.push('只有一張有數字的小牌，看不出階段走向。')
  }

  // 同一個數字出現多次時，在這裡就講，不要丟給「元素與數字」那段各說各話（v10 Q7）
  const numberCounts = {}
  sequence.forEach((step) => {
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
    lines.push(`其中數字 ${text}，同一個主題被重複強調。`)
  }

  if (skipped.length > 0) {
    lines.push(`${skipped.map((index) => cardNameOnly(entries[index])).join('、')}不走小牌的數字階段。`)

    // 被剔除的若正好是帶動最大的那張，一定要講出來，
    // 否則「看不出走向」會變成剔除規則的產物，而不是牌面的訊息。
    const lead = quant?.contributions?.[0]
    if (lead && skipped.includes(lead.index)) {
      lines.push(`但${cardNameOnly(entries[lead.index])}是這組牌裡說話最大聲的一張，看階段時要記得它不在這條線上。`)
    }
  }

  return lines.join('')
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
function buildQuantText(quant, entries, focusIndex) {
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

  if (top && top.share !== 0) {
    if (soleReversedIsTop) {
      const name = cardNameOnly(entries[top.index])
      lines.push(
        top.share > 0
          ? `其中${name}說話最大聲，但它是逆位，力道出不來，推進時會卡。`
          : `其中${name}說話最大聲，又是逆位，推進時會卡。`,
      )
    } else {
      const card = cardLabel(entries[top.index])
      if (top.share > 0) {
        // 和焦點牌不同張時要說清楚這是另一個角度，否則讀者不知道該看哪張（v10 Q1）
        lines.push(
          top.index === focusIndex
            ? `其中${card}最能推一把。`
            : `就帶動整體走向來說，${card}推得最用力 —— 這和份量最重的那張是兩回事。`,
        )
      } else {
        // 正位的牌卻在拖，光看「正位…拖」像是前後矛盾，補一句說明拖的來源是牌義本身
        const fromMeaning = entries[top.index].orientation === 'upright' ? '（牌義本身就偏滯）' : ''
        // 和「推得動」那個分支一樣，不是焦點牌時要說清楚這是另一個角度（v10 Q1）
        lines.push(
          top.index === focusIndex
            ? `其中${card}拖得最明顯${fromMeaning}。`
            : `就帶動整體走向來說，${card}拖得最明顯${fromMeaning} —— 這和份量最重的那張是兩回事。`,
        )
      }
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
  } else if (!heavyResistance && quant.momentum >= 0.5) {
    // momentum 現在算的是「正向極性且使得出來」的佔比，與牌義一致，
    // 所以這裡可以直接說推得動，不必再替算錯的數字圓場。
    lines.push('牌本身是正向的，力道也使得出來，推得動。')
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
    hit: (texts) => texts.some((t) => t.includes('由個人可控')) && texts.some((t) => t.includes('不是你能完全掌控')),
  },
  {
    name: '同時宣告單一重心又說份量相當',
    hit: (texts) => texts.some((t) => t.includes('力氣主要花在')) && texts.some((t) => t.includes('份量差不多')),
  },
  {
    name: '焦點牌被講兩次',
    hit: (texts) => texts.filter((t) => t.includes('焦點牌')).length > 1,
  },
]

function assertConsistency(analysis) {
  if (process.env.NODE_ENV === 'production') {
    return
  }
  const texts = [
    analysis.theme.text,
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
      text: buildCourtText(court, entries, result.quant),
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
          text: buildQuantText(result.quant, entries, result.theme.focusIndex),
        }
      : null,
    question: result.question ? { ...result.question, text: buildQuestionText(result.question) } : null,
    positions: result.positions.map((finding) => ({ ...finding, text: buildPositionText(finding, entries) })),
    numberStage: result.numberStage
      ? { ...result.numberStage, text: buildNumberStageText(result.numberStage, entries, result.quant) }
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
  flat: () => '數字都落在同一階段，同一個主題被重複強調。',
  rising: () => '階段一路往前推，方向是對的。',
  falling: (endNumber) =>
    endNumber <= 3 ? '階段走回起點，一輪結束，接下來是重新開始。' : '階段在往回走，像是要回頭重整。',
  peak: (endNumber) =>
    endNumber <= 3 ? '中段衝得最高，最後回到起點，一輪走完了。' : '中段衝得最高，後面要收尾。',
  dip: () => '中間掉下去過，現在正在拉回來。',
  zigzag: () => '階段起伏不定，節奏不穩。',
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
    // 最有份量的那張是逆位：力道出不來的原因在內還是在外
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
    ask: (ctx) =>
      `${ctx.last.label}的${ctx.last.card.nameZh}，你希望它往哪個方向走？為此你這週能做的第一件事是什麼？`,
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
    missingCovers: result.theme.missingSuits.map((suit) => SUITS[suit].covers),
  }

  const usable = GUIDANCE_QUESTIONS.filter((rule) => rule.when(ctx) && !mentioned.has(rule.fact))
  // 全部都講過時退回「落點」那題，它是提問而非陳述，重複的感覺最輕
  const chosen = usable.length > 0 ? usable : GUIDANCE_QUESTIONS.filter((rule) => rule.when(ctx)).slice(-1)

  return chosen.slice(0, 2).map((rule) => rule.ask(ctx))
}

// 結語：份量與張力、議題性質、主導領域、階段走向、最該留意的卡點、落點、提問。
// 不逐張列舉（每張牌下面本來就有完整牌義），也不重複位置名稱。
function buildGuidance(result, rawEntries) {
  const entries = rawEntries.map((entry, index) => ({ ...entry, profile: result.profiles[index] }))

  if (entries.length === 1) {
    return `這次只有${cardLabel(entries[0])}一張，就照它說的看。`
  }

  const contributions = result.quant?.contributions || []
  const lines = []

  // 一、份量與二、張力合併成一句：contributions 依 |share| 排序，
  // 所以第一名必定是推力或阻力其中一方，分開寫會把同一張牌講兩次。
  const top = contributions[0]
  const pusher = contributions.find((item) => item.share > 0)
  const blocker = contributions.find((item) => item.share < 0)

  const named = new Set()
  // 記下結語已經陳述過的事實，最後的提問不要再問一次同一件事
  const mentioned = new Set()

  if (top && top.share !== 0) {
    const head = `這組牌的份量集中在${cardLabel(entries[top.index])}`
    named.add(top.index)

    if (top.share > 0) {
      if (blocker) {
        named.add(blocker.index)
        lines.push(`${head}，推得動；但${cardNameOnly(entries[blocker.index])}拖住。`)
      } else {
        lines.push(`${head}，推得動，沒有明顯擋路的。`)
      }
    } else if (pusher) {
      named.add(pusher.index)
      lines.push(`${head}，它在拖；${cardNameOnly(entries[pusher.index])}是推得動的那張。`)
    } else {
      lines.push(`${head}，它在拖，推力還沒出現。`)
    }
  }

  // 三、議題性質：大牌份量決定這件事有多少在自己手上
  if (result.theme.dominance === 'fate') {
    mentioned.add('dominance')
    lines.push(`大牌有 ${result.stats.majorCount} 張，這件事有不少部分不是你能完全掌控的。`)
  } else if (result.theme.dominance === 'elevated') {
    mentioned.add('dominance')
    lines.push(heavyText(result.stats))
  } else if (result.weights?.majorWeightShare >= 0.5) {
    lines.push('大牌張數不多，份量卻重，別只看表面的張數。')
  } else {
    lines.push('整體偏向日常範圍，多半還在你自己處理得來的程度。')
  }

  // 四、主導領域：缺什麼往往比有什麼更值得講
  const dominantSuit = result.theme.dominantSuits[0]
  if (dominantSuit) {
    lines.push(`檯面上的重點是${SUITS[dominantSuit.suit].label}，也就是${SUITS[dominantSuit.suit].covers}。`)
  }
  if (result.theme.missingSuits.length > 0) {
    mentioned.add('missing')
    const missing = result.theme.missingSuits.map((suit) => SUITS[suit].covers).join('、')
    lines.push(`${missing}這幾塊這次沒出現，是容易被忽略的地方。`)
  }

  // 五、階段走向
  // 只有一張有數字的小牌時沒有「走向」可言，整句略過
  const stage = result.numberStage
  if (stage && stage.sequence.length >= 2 && SHAPE_SUMMARY[stage.shape]) {
    lines.push(SHAPE_SUMMARY[stage.shape](stage.sequence[stage.sequence.length - 1].number))
  }

  // 六、最需要留意的卡點：矛盾點只取第一個，講完整反而失焦
  const conflict = result.conflicts[0]
  if (conflict) {
    mentioned.add('conflict')
    lines.push(`要留意的是，${buildConflictText(conflict, entries)}`)
  }

  // 七、落點：描述走向，但不下宣判。
  // 「會停在○○」聽起來像預告結果，塔羅的價值在把選項攤開，不在宣判。
  const lastIndex = entries.length - 1
  const last = entries[lastIndex]

  if (last.hasPosition && !named.has(lastIndex)) {
    mentioned.add('last')
    // 前面已經講過位置，這裡只要牌名；逆位才標註，正位是常態
    lines.push(`${last.label}這格是${last.card.nameZh}${last.orientation === 'reversed' ? '逆位' : ''}。`)
  }

  if (result.quant?.confidenceLow) {
    lines.push('這組牌的訊息比較雜，當參考就好。')
  }

  // 八、留兩個問題給自己回答。
  // 這是規則版的保底，AI 解讀那段會依這次的牌寫得更貼身（見 narrationService 的 SYSTEM_PROMPT）。
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
