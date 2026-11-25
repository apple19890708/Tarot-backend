// L6 代表牌與距離（大藍圖）：找到中心，其他牌依和中心的切比雪夫距離分近、中、遠；
// 同一列左邊是過去、右邊是未來，同一欄上方是意識、下方是潛意識；另列出中心周圍的九宮。
// 代表牌沒出現（輸入實體牌時可能）：改用代表牌的宮位（第 28／29 宮）那一格當中心，mode 為 house。
const { DISTANCE_NEAR_MAX, DISTANCE_MIDDLE_MAX } = require('../../../data/lenormand/ruleConfig')
const { cellOf, chebyshev, neighborsOf } = require('../layout')

function distanceGroup(steps) {
  if (steps <= DISTANCE_NEAR_MAX) return 'near'
  if (steps <= DISTANCE_MIDDLE_MAX) return 'middle'
  return 'far'
}

// 中心那一格：代表牌的位置；沒出現時是第 significator 宮（index = significator − 1）
function findCenter(items, significator) {
  const found = items.find((item) => item.card.id === significator)
  const item = found || items.find((entry) => entry.position.house === significator)
  const { col, row } = cellOf(item)
  return { mode: found ? 'significator' : 'house', cardId: significator, present: Boolean(found), index: item.index, house: item.position.house, col, row }
}

function analyzeSignificator({ items, significator }) {
  const center = findCenter(items, significator)
  const distances = { near: [], middle: [], far: [] }
  const directions = { past: [], future: [], conscious: [], subconscious: [] }
  // 由近到遠排：先算步數
  const others = items
    .filter((item) => item.index !== center.index)
    .map((item) => ({ item, cell: cellOf(item), steps: chebyshev(cellOf(item), center) }))
    .sort((a, b) => a.steps - b.steps || a.item.index - b.item.index)
  for (const { item, cell, steps } of others) {
    distances[distanceGroup(steps)].push(item.index)
    if (cell.row === center.row) directions[cell.col < center.col ? 'past' : 'future'].push(item.index)
    if (cell.col === center.col) directions[cell.row < center.row ? 'conscious' : 'subconscious'].push(item.index)
  }
  return { center, distances, directions, surroundings: neighborsOf(items, center) }
}

module.exports = { analyzeSignificator, distanceGroup }
