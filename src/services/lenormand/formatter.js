// 雷諾曼的中性文字（v27，詳見 doc/v27-lenormand-plan.md 3-12）：把 engine 的結構化結果組成段落。
// 只描述牌面，不下「一定會」的結論；語氣和塔羅的 analysisFormatter 一致。
const { playingCardGuide } = require('../../data/lenormand/playingCards')

const LEAN_LABELS = {
  positive: '偏順利',
  negative: '偏有挑戰',
  mixed: '吉凶交錯',
  neutral: '偏中性，重點在牌與牌的組合',
}
const SHIFT_LABELS = { improve: '轉好', worsen: '轉弱', steady: '持平' }
const THEME_EFFECT_LINES = {
  brightened: '形容它的牌偏吉，主題被往好的方向描述。',
  darkened: '形容它的牌偏凶，主題帶著需要留意的色彩。',
  mixed: '形容它的牌一吉一凶，主題同時有順與不順的一面。',
  neutral: '形容它的牌偏中性，重點在牌義本身怎麼搭配。',
}
const SUIT_INFO = Object.fromEntries(playingCardGuide.suits.map((suit) => [suit.suit, suit]))
const DIRECTION = { left: '左', right: '右' }
// 人物牌當形容詞時不用關鍵詞（「男問卜者」讀起來不通），改說「和這個人有關」；句子裡改用牌名
const PERSON_CARDS = [28, 29]
const wordOf = (card) => (PERSON_CARDS.includes(card.id) ? card.nameZh : card.keywords[0])

const nameOf = (items, index) => items[index].card.nameZh
const quote = (text) => `「${text}」`
const namesOf = (items, indexes) => indexes.map((index) => quote(nameOf(items, index))).join('、')

function toneSection(analysis, items) {
  const { counts, total, lean, clusters, cleansedIndexes, scope } = analysis.tone
  const range = scope === 'near' ? `中心周圍的 ${total} 張牌` : `這次 ${total} 張牌`
  const lines = [`${range}：吉牌 ${counts.positive} 張、凶牌 ${counts.negative} 張、中性 ${counts.neutral} 張，${scope === 'near' ? '眼前的狀況' : '整體'}${LEAN_LABELS[lean]}。`]
  if (cleansedIndexes.length) lines.push(`${namesOf(items, cleansedIndexes)}的負面被化解，這次當中性計算。`)
  for (const cluster of clusters) {
    const where = cluster.axis === 'row' ? `${quote(cluster.label)}這一列` : `${quote(cluster.label)}這一欄`
    lines.push(`凶牌集中在${where}（${namesOf(items, cluster.indexes)}），是這次要特別留意的地方。`)
  }
  return { key: 'tone', title: '整體牌性', lines }
}

function pairsSection(analysis, items, spread) {
  const { items: pairs, theme } = analysis.pairs
  const lines = []
  if (spread.key === 'grand-tableau' && pairs.length) lines.push('只讀代表牌與關鍵牌的左右相鄰（左邊是過去、右邊是未來）：')
  if (theme) {
    lines.push(`主題牌是${quote(nameOf(items, theme.index))}，由${namesOf(items, theme.modifierIndexes)}來形容。${THEME_EFFECT_LINES[theme.effect]}`)
  }
  if (spread.key === 'nine-box') {
    const groups = new Map()
    for (const pair of pairs) {
      if (!groups.has(pair.line)) groups.set(pair.line, [])
      groups.get(pair.line).push(pair)
    }
    const labels = Object.fromEntries([...analysis.nineBox.rows, ...analysis.nineBox.cols].map((line) => [line.key, line.label]))
    for (const [line, group] of groups) {
      const chain = [group[0].from, ...group.map((pair) => pair.to)].map((index) => nameOf(items, index)).join(' → ')
      const kindLabel = group[0].kind === 'stack' ? '由上到下' : '由左到右'
      lines.push(`${quote(labels[line])}${kindLabel}：${chain}（${group.map((pair) => SHIFT_LABELS[pair.shift]).join('、')}）。`)
    }
    return { key: 'pairs', title: '牌與牌的句子', lines }
  }
  for (const pair of pairs) {
    const a = items[pair.from].card
    const b = items[pair.to].card
    if (pair.kind === 'modifier' && PERSON_CARDS.includes(b.id)) {
      lines.push(`${a.nameZh}＋${b.nameZh}：${quote(a.keywords[0])}和${b.nameZh}這個人有關。`)
    } else if (pair.kind === 'modifier') {
      lines.push(`${a.nameZh}＋${b.nameZh}：${quote(a.keywords[0])}帶著${quote(b.keywords[0])}的色彩。`)
    } else {
      lines.push(`${a.nameZh} → ${b.nameZh}：從${quote(wordOf(a))}走到${quote(wordOf(b))}，牌性${SHIFT_LABELS[pair.shift]}。`)
    }
  }
  return { key: 'pairs', title: '牌與牌的句子', lines }
}

function comboLink(combo, items) {
  const [a, b] = combo.indexes.map((index) => nameOf(items, index))
  return combo.condition === 'faces' ? `${a}朝向${b}` : `${a}＋${b}`
}

function combosSection(analysis, items) {
  const lines = analysis.combos.map((combo) => `${comboLink(combo, items)}：${combo.meaning}。`)
  return lines.length ? { key: 'combos', title: '特殊組合', lines } : null
}

const COUPLE_LINES = {
  faceToFace: () => '紳士與淑女相鄰、面對面，可讀成兩人心意靠近、願意看向對方。',
  facingApart: (items, couple) => `紳士與淑女面對面，但中間隔著${namesOf(items, couple.between)}，這是兩人之間要先處理的課題。`,
  backToBack: () => '紳士與淑女背對背，可讀成兩人想法不同、各自看著不同的方向。',
  sameDirection: () => '紳士與淑女朝同一個方向，可讀成兩人看向同一個目標，或一前一後、步調不一。',
  differentRows: () => '紳士與淑女不在同一列，視線沒有交會。',
}

function gazeSection(analysis, items) {
  const { looks, couple, significator } = analysis.gaze
  const lines = []
  if (couple) lines.push(COUPLE_LINES[couple.relation](items, couple))
  if (significator && significator.index !== null) {
    const self = quote(nameOf(items, significator.index))
    if (significator.toward !== null) lines.push(`代表你的${self}看向${quote(nameOf(items, significator.toward))}，這是你目前關注的事。`)
    if (significator.away !== null) lines.push(`代表你的${self}背對${quote(nameOf(items, significator.away))}，這是你沒有正視、或已經放下的事。`)
  } else if (significator) {
    lines.push('代表你的牌沒有出現在這次的牌面上。')
  }
  for (const look of looks) {
    if ([couple?.gentleman, couple?.lady, significator?.index].includes(look.index)) continue
    const name = nameOf(items, look.index)
    const toward = look.toward !== null ? `看向${quote(nameOf(items, look.toward))}` : '看向牌陣外'
    const away = look.away !== null ? `，背對${quote(nameOf(items, look.away))}` : ''
    lines.push(`${name}朝${DIRECTION[look.facing]}，${toward}${away}。`)
  }
  return lines.length ? { key: 'gaze', title: '視線', lines } : null
}

function nineBoxSection(analysis, items) {
  const box = analysis.nineBox
  if (!box) return null
  const cardList = (indexes) => indexes.map((index) => nameOf(items, index)).join('、')
  const lines = [`中心牌${quote(nameOf(items, box.center.index))}是現在這件事的核心。`]
  for (const row of box.rows) lines.push(`${quote(row.label)}這一列（${cardList(row.indexes)}）${LEAN_LABELS[row.lean]}。`)
  for (const col of box.cols) lines.push(`${quote(col.label)}這一欄（${cardList(col.indexes)}）${LEAN_LABELS[col.lean]}。`)
  const [main, anti] = box.diagonals
  lines.push(`左上到右下的對角線（${cardList(main.indexes)}）${LEAN_LABELS[main.lean]}；右上到左下（${cardList(anti.indexes)}）${LEAN_LABELS[anti.lean]}。`)
  lines.push(`四角（${cardList(box.corners.indexes)}）是整件事的外框，${LEAN_LABELS[box.corners.lean]}。`)
  const mirrorText = (axis) =>
    box.mirrors
      .filter((mirror) => mirror.axis === axis)
      .map((mirror) => `${nameOf(items, mirror.a)}↔${nameOf(items, mirror.b)}`)
      .join('、')
  lines.push(`左右鏡射：${mirrorText('leftRight')}；上下鏡射：${mirrorText('topBottom')}。鏡射的兩張可以互相補充細節。`)
  return { key: 'nineBox', title: '九宮格', lines }
}

function suitsSection(analysis, items) {
  const suits = analysis.suits
  const lines = []
  if (suits.counted > 0) {
    const parts = Object.entries(suits.counts)
      .filter(([, count]) => count > 0)
      .map(([suit, count]) => `${SUIT_INFO[suit].name} ${count}`)
    const dominant = suits.dominant.map((suit) => `${SUIT_INFO[suit].name}（${SUIT_INFO[suit].summary}）`).join('、')
    lines.push(`有撲克標記的 ${suits.counted} 張裡：${parts.join('、')}，最多的是${dominant}。`)
    const colorText = { red: '偏順', black: '偏有挑戰', even: '順與挑戰各半' }[suits.colorLean]
    lines.push(`紅色 ${suits.colors.red} 張、黑色 ${suits.colors.black} 張，${colorText}。`)
    if (suits.faces.length) {
      lines.push(`人頭牌：${suits.faces.map((f) => `${nameOf(items, f.index)}（${SUIT_INFO[f.suit].name} ${f.rank}）`).join('、')}，可能指向某個人。`)
    }
    if (suits.aces.length) {
      lines.push(`A：${suits.aces.map((a) => `${nameOf(items, a.index)}（${SUIT_INFO[a.suit].name} A）`).join('、')}，代表這次的重點。`)
    }
  }
  if (suits.skipped > 0) lines.push(`另有 ${suits.skipped} 張擴充牌還沒有撲克對應，沒有計入花色。`)
  if (suits.counted > 0) lines.push('花色只當補充參考，解讀仍以牌義與牌的組合為主。')
  return lines.length ? { key: 'suits', title: '撲克花色', lines } : null
}

// ---- 大藍圖（L6、L7、L8、L10、L11）----
const houseOf = (items, index) => `第 ${items[index].position.house} 宮（${items[index].position.houseTheme}）`
const DISTANCE_LABELS = { near: '近', middle: '中', far: '遠' }
const H_LABELS = { past: '左邊（過去）', future: '右邊（未來）', same: '' }
const V_LABELS = { conscious: '上方（意識）', subconscious: '下方（潛意識）', same: '' }

function centerLine(tableau, items) {
  const { center } = tableau
  const self = quote(nameOf(items, center.index))
  if (center.present) return `代表你的${self}落在${houseOf(items, center.index)}。`
  const own = center.cardId === 28 ? '紳士' : '淑女'
  return `代表你的${quote(own)}沒有出現，改以${houseOf(items, center.index)}當中心，這一格是${self}。`
}

function centerSection(tableau, items) {
  const { distances, directions, surroundings } = tableau
  const lines = [centerLine(tableau, items)]
  if (surroundings.length) lines.push(`緊鄰中心的九宮：${namesOf(items, surroundings)}，影響最直接。`)
  const nearest = [
    ['past', '左邊（過去）'],
    ['future', '右邊（未來）'],
    ['conscious', '上方（意識、想法）'],
    ['subconscious', '下方（潛意識、已掌握的事）'],
  ]
    .filter(([key]) => directions[key].length)
    .map(([key, label]) => `${label}最近的是${quote(nameOf(items, directions[key][0]))}`)
  if (nearest.length) lines.push(`${nearest.join('；')}。`)
  lines.push(`依距離：近 ${distances.near.length} 張、中 ${distances.middle.length} 張、遠 ${distances.far.length} 張；越近的牌影響越直接。`)
  return { key: 'center', title: '代表牌與距離', lines }
}

function housesSection(tableau, items) {
  const lines = []
  const { houses, themeCard } = tableau
  lines.push(`中心落在${houseOf(items, houses.center.index)}：${quote(nameOf(items, houses.center.index))}和這一宮的主題連在一起讀。`)
  if (houses.theme) lines.push(`關鍵牌${quote(nameOf(items, houses.theme.index))}落在${houseOf(items, houses.theme.index)}。`)
  else if (themeCard && !themeCard.present) lines.push(`關鍵牌的宮位${houseOf(items, themeCard.index)}這次是${quote(nameOf(items, themeCard.index))}。`)
  // 合成一行：輸入實體牌時可能很多張都落在自己的宮位（例如照牌號排好），不要一張一行
  if (houses.own.length) {
    const list = houses.own.map((own) => `${quote(nameOf(items, own.index))}（第 ${items[own.index].position.house} 宮）`).join('、')
    lines.push(`落在自己宮位的牌：${list}，這些主題這次特別強。`)
  }
  return { key: 'houses', title: '宮位', lines }
}

function themeCardSection(analysis, items) {
  const theme = analysis.tableau.themeCard
  if (!theme) return null
  const label = analysis.domain.label
  if (!theme.present) {
    return {
      key: 'themeCard',
      title: '關鍵牌',
      lines: [`這次問的是${label}，關鍵牌沒有出現在牌面上，改讀它的宮位${houseOf(items, theme.index)}：這一格是${quote(nameOf(items, theme.index))}，周圍是${namesOf(items, theme.surroundings)}。`],
    }
  }
  const where = [H_LABELS[theme.direction.horizontal], V_LABELS[theme.direction.vertical]].filter(Boolean).join('、')
  const position = where ? `，在中心的${where}` : ''
  // 代表牌沒出現、關鍵牌剛好落在中心那一格（第 28／29 宮）
  const distanceText = theme.steps === 0 ? '，就在中心這一格' : `，離中心 ${theme.steps} 步（${DISTANCE_LABELS[theme.distance]}）${position}`
  return {
    key: 'themeCard',
    title: '關鍵牌',
    lines: [
      `這次問的是${label}，關鍵牌${quote(nameOf(items, theme.index))}落在${houseOf(items, theme.index)}${distanceText}。`,
      `關鍵牌周圍是${namesOf(items, theme.surroundings)}，描述這件事的狀況。`,
    ],
  }
}

// 騎士跳、鏡射的起點：代表牌或關鍵牌沒出現時，起點是它的宮位那一格，不能把那格的牌叫成代表牌（api-reviewer 2026-11-25）
function originLabel(tableau, entry, items) {
  const name = quote(nameOf(items, entry.origin))
  const house = `第 ${items[entry.origin].position.house} 宮`
  if (entry.from === 'center') return tableau.center.present ? `代表牌${name}` : `中心（${house}）${name}`
  return tableau.themeCard.present ? `關鍵牌${name}` : `關鍵牌的宮位（${house}）${name}`
}

function knightingSection(tableau, items) {
  const lines = tableau.knighting
    .filter((entry) => entry.targets.length)
    .map((entry) => `從${originLabel(tableau, entry, items)}跳出：${namesOf(items, entry.targets)}，是檯面下、間接影響它的因素。`)
  return lines.length ? { key: 'knighting', title: '騎士跳', lines } : null
}

function mirrorsSection(tableau, items) {
  const lines = tableau.mirrors.map((entry) => {
    const parts = [
      entry.leftRight !== null && `左右鏡射是${quote(nameOf(items, entry.leftRight))}`,
      `上下鏡射是${quote(nameOf(items, entry.topBottom))}`,
      entry.diagonal !== null && `對角鏡射是${quote(nameOf(items, entry.diagonal))}`,
    ].filter(Boolean)
    const middle = entry.leftRight === null ? '（在中間欄，左右鏡射是自己）' : ''
    return `${originLabel(tableau, entry, items)}${middle}：${parts.join('、')}，可以補充細節。`
  })
  return { key: 'mirrors', title: '鏡射', lines }
}

function buildGuidance(analysis, items) {
  const parts = [`${analysis.tone.scope === 'near' ? '中心周圍' : '整體'}${LEAN_LABELS[analysis.tone.lean]}。`]
  if (analysis.tableau) parts.push(centerLine(analysis.tableau, items))
  const { domain } = analysis
  if (domain.key && domain.themeCardId) {
    const themeName = items.find((item) => item.card.id === domain.themeCardId)?.card.nameZh
    parts.push(
      domain.themeIndex !== null
        ? `這次問的是${domain.label}，關鍵牌${quote(themeName)}有出現，可以多看它和旁邊的牌。`
        : `這次問的是${domain.label}，關鍵牌沒有出現在牌面上，可以把重心放在牌與牌的組合。`,
    )
  }
  if (analysis.pairs.theme) parts.push(THEME_EFFECT_LINES[analysis.pairs.theme.effect])
  const combo = analysis.combos[0]
  if (combo) parts.push(`最值得注意的組合是${quote(comboLink(combo, items))}：${combo.meaning}。`)
  if (analysis.gaze.couple) parts.push(COUPLE_LINES[analysis.gaze.couple.relation](items, analysis.gaze.couple))
  return parts.join('')
}

/**
 * @returns {{ overview: string, guidance: string, text: { sections: Array<{ key, title, lines }> } }}
 */
function formatLenormand(analysis, items, spread) {
  const overview = items.map((item) => `${item.position.label}：${item.card.nameZh}`).join('、')
  const { tableau } = analysis
  const sections = [
    toneSection(analysis, items),
    tableau && centerSection(tableau, items),
    tableau && housesSection(tableau, items),
    tableau && themeCardSection(analysis, items),
    pairsSection(analysis, items, spread),
    combosSection(analysis, items),
    gazeSection(analysis, items),
    nineBoxSection(analysis, items),
    tableau && knightingSection(tableau, items),
    tableau && mirrorsSection(tableau, items),
    suitsSection(analysis, items),
  ].filter((section) => section && section.lines.length > 0)
  return { overview, guidance: buildGuidance(analysis, items), text: { sections } }
}

module.exports = { formatLenormand, LEAN_LABELS }
