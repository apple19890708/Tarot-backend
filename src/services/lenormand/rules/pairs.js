// L2 成對組合：雷諾曼把相鄰的牌讀成句子。
// - 主題牌陣：主題牌被左右的牌形容（modifier：from 是被形容的牌，to 是形容它的牌）
// - 時間線：相鄰兩張的轉折（sequence）
// - 九宮格：每一列由左到右（sequence）、每一欄由上到下（stack）
// - 大藍圖：只讀代表牌（中心）與主題牌的左右相鄰（focus），不列出 36 張全部的配對
// 只產生結構化結果，文字在 formatter.js。
const { TONE_RANK } = require('../../../data/lenormand/ruleConfig')
const { NINE_BOX_ROWS, NINE_BOX_COLS } = require('../../../data/lenormand/spreads')
const { cellOf, itemAt } = require('../layout')

function shiftOf(fromTone, toTone) {
  const diff = TONE_RANK[toTone] - TONE_RANK[fromTone]
  if (diff > 0) return 'improve'
  if (diff < 0) return 'worsen'
  return 'steady'
}

const EFFECTS = { positive: 'brightens', negative: 'darkens', neutral: 'neutral' }

function pairOf(items, from, to, kind, line) {
  const a = items[from].card
  const b = items[to].card
  return {
    from,
    to,
    kind,
    line,
    cardIds: [a.id, b.id],
    tones: [a.tone, b.tone],
    shift: kind === 'modifier' ? null : shiftOf(a.tone, b.tone),
    effect: kind === 'modifier' ? EFFECTS[b.tone] : null,
  }
}

// focus：大藍圖要讀的牌 [{ line: 'significator' | 'theme', index }]（沒出現的不放）
function grandTableauPairs(items, focus) {
  const pairs = []
  const seen = new Set()
  const add = (from, to, line) => {
    if (seen.has(`${from}-${to}`)) return
    seen.add(`${from}-${to}`)
    pairs.push(pairOf(items, from, to, 'sequence', line))
  }
  for (const { line, index } of focus) {
    const { col, row } = cellOf(items[index])
    const left = itemAt(items, col - 1, row)
    const right = itemAt(items, col + 1, row)
    if (left) add(left.index, index, line)
    if (right) add(index, right.index, line)
  }
  return { items: pairs, theme: null }
}

function analyzePairs({ items, spread, focus = [] }) {
  if (spread.key === 'grand-tableau') return grandTableauPairs(items, focus)
  const isNine = spread.key === 'nine-box'
  const pairs = spread.relations.map((relation) => {
    const line = isNine ? NINE_BOX_ROWS[cellOf(items[relation.from]).row - 1].key : null
    return pairOf(items, relation.from, relation.to, relation.kind, line)
  })

  if (isNine) {
    // 每一欄由上到下：思想 → 現實 → 內心
    NINE_BOX_COLS.forEach((col, c) => {
      const column = items.filter((item) => cellOf(item).col === c + 1).sort((x, y) => cellOf(x).row - cellOf(y).row)
      for (let k = 0; k + 1 < column.length; k += 1) pairs.push(pairOf(items, column[k].index, column[k + 1].index, 'stack', col.key))
    })
  }

  let theme = null
  const themeIndex = spread.positions.findIndex((position) => position.key === 'theme')
  if (themeIndex >= 0) {
    const modifierIndexes = pairs.filter((pair) => pair.kind === 'modifier' && pair.from === themeIndex).map((pair) => pair.to)
    const tones = modifierIndexes.map((index) => items[index].card.tone)
    let effect = 'neutral'
    if (tones.includes('positive') && tones.includes('negative')) effect = 'mixed'
    else if (tones.includes('positive')) effect = 'brightened'
    else if (tones.includes('negative')) effect = 'darkened'
    theme = { index: themeIndex, cardId: items[themeIndex].card.id, modifierIndexes, effect }
  }

  return { items: pairs, theme }
}

module.exports = { analyzePairs, shiftOf }
