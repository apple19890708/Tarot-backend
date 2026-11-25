// 雷諾曼規則共用的位置計算：從牌陣的 layout（col／row 由 1 起算）找相鄰、同列、朝向。
// items：[{ index, card, position }]，card 是 src/data/lenormand/cards.js 的牌（測試可以換掉 facing）。
const { TONE_LEAN_RATIO } = require('../../data/lenormand/ruleConfig')

const cellOf = (item) => item.position.layout

// 相鄰的兩張：horizontal（同一列左右相鄰，left 在左）、vertical（同一欄上下相鄰，top 在上）
function adjacentPairs(items) {
  const pairs = []
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = cellOf(items[i])
      const b = cellOf(items[j])
      if (a.row === b.row && Math.abs(a.col - b.col) === 1) {
        const [left, right] = a.col < b.col ? [items[i], items[j]] : [items[j], items[i]]
        pairs.push({ axis: 'horizontal', first: left, second: right })
      } else if (a.col === b.col && Math.abs(a.row - b.row) === 1) {
        const [top, bottom] = a.row < b.row ? [items[i], items[j]] : [items[j], items[i]]
        pairs.push({ axis: 'vertical', first: top, second: bottom })
      }
    }
  }
  return pairs
}

// 某一格上的牌（沒有就是 null）
function itemAt(items, col, row) {
  return items.find((item) => cellOf(item).col === col && cellOf(item).row === row) ?? null
}

// 有朝向的牌看向（toward）與背對（away）的相鄰牌
function lookOf(items, item) {
  const { facing } = item.card
  if (facing !== 'left' && facing !== 'right') return null
  const { col, row } = cellOf(item)
  const step = facing === 'right' ? 1 : -1
  const toward = itemAt(items, col + step, row)
  const away = itemAt(items, col - step, row)
  return { index: item.index, cardId: item.card.id, facing, toward: toward ? toward.index : null, away: away ? away.index : null }
}

// a 是不是朝向 b（同一列，b 在 a 的朝向那一側；不要求相鄰）
function faces(a, b) {
  const ca = cellOf(a)
  const cb = cellOf(b)
  if (ca.row !== cb.row) return false
  if (a.card.facing === 'right') return cb.col > ca.col
  if (a.card.facing === 'left') return cb.col < ca.col
  return false
}

// 一組牌的吉凶傾向：positive | negative | mixed | neutral
function toneLean(cards) {
  const counts = { positive: 0, negative: 0, neutral: 0 }
  for (const card of cards) counts[card.tone] += 1
  const total = cards.length
  if (total === 0) return { counts, lean: 'neutral' }
  const ratio = (counts.positive - counts.negative) / total
  let lean = 'neutral'
  if (ratio >= TONE_LEAN_RATIO) lean = 'positive'
  else if (ratio <= -TONE_LEAN_RATIO) lean = 'negative'
  else if (counts.positive > 0 && counts.negative > 0) lean = 'mixed'
  return { counts, lean }
}

// 切比雪夫距離：橫、直、斜走一步都算 1
function chebyshev(a, b) {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row))
}

// 某一格周圍的九宮（不含自己；邊緣時少於 8 格），依 index 排序
function neighborsOf(items, cell) {
  return items
    .filter((item) => chebyshev(cellOf(item), cell) === 1)
    .map((item) => item.index)
    .sort((a, b) => a - b)
}

module.exports = { cellOf, adjacentPairs, itemAt, lookOf, faces, toneLean, chebyshev, neighborsOf }
