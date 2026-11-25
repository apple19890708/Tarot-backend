// L10 騎士跳（大藍圖）：從中心與主題牌走西洋棋騎士的 L 形（橫 2 直 1、橫 1 直 2），
// 落到的牌和起點成對解讀，看「檯面下、間接的影響」。在邊緣能跳的格子較少（角落只有 2～3 格）。
const { cellOf, itemAt } = require('../layout')

const MOVES = [
  [-2, -1],
  [-2, 1],
  [2, -1],
  [2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
]

function knightTargets(items, origin) {
  const { col, row } = cellOf(items[origin])
  return MOVES.map(([dc, dr]) => itemAt(items, col + dc, row + dr))
    .filter(Boolean)
    .map((item) => item.index)
    .sort((a, b) => a - b)
}

// origins：[{ from: 'center' | 'theme', origin: index }]
function analyzeKnighting({ items, origins }) {
  return origins.map(({ from, origin }) => ({ from, origin, targets: knightTargets(items, origin) }))
}

module.exports = { analyzeKnighting, knightTargets }
