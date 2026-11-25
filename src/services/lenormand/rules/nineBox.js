// L5 九宮格結構：三列（思想、現實、內心）、三欄（過去、現在、未來）、中心、兩條對角線、四角，以及左右、上下鏡射（L11 的九宮格版）。
// 不是九宮格回傳 null。
const { NINE_BOX_ROWS, NINE_BOX_COLS } = require('../../../data/lenormand/spreads')
const { itemAt, toneLean } = require('../layout')

// cleansed：被 L3 化解的凶牌，和 L1 一樣當中性
function analyzeNineBox({ items, spread, cleansed = [] }) {
  if (spread.key !== 'nine-box') return null
  const toneOf = (item) => (item.card.tone === 'negative' && cleansed.includes(item.index) ? { tone: 'neutral' } : item.card)
  const group = (cells) => {
    const picked = cells.filter(Boolean)
    return { indexes: picked.map((item) => item.index), cardIds: picked.map((item) => item.card.id), lean: toneLean(picked.map(toneOf)).lean }
  }
  const at = (col, row) => itemAt(items, col, row)
  const rows = NINE_BOX_ROWS.map((row, r) => ({ key: row.key, label: row.label, ...group([1, 2, 3].map((c) => at(c, r + 1))) }))
  const cols = NINE_BOX_COLS.map((col, c) => ({ key: col.key, label: col.label, ...group([1, 2, 3].map((r) => at(c + 1, r))) }))
  const centerItem = at(2, 2)
  const mirrors = []
  for (let r = 1; r <= 3; r += 1) mirrors.push({ axis: 'leftRight', a: at(1, r).index, b: at(3, r).index })
  for (let c = 1; c <= 3; c += 1) mirrors.push({ axis: 'topBottom', a: at(c, 1).index, b: at(c, 3).index })
  return {
    rows,
    cols,
    center: { index: centerItem.index, cardId: centerItem.card.id, tone: toneOf(centerItem).tone },
    diagonals: [
      { key: 'main', ...group([at(1, 1), at(2, 2), at(3, 3)]) },
      { key: 'anti', ...group([at(3, 1), at(2, 2), at(1, 3)]) },
    ],
    corners: group([at(1, 1), at(3, 1), at(1, 3), at(3, 3)]),
    mirrors,
  }
}

module.exports = { analyzeNineBox }
