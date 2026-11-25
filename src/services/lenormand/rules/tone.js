// L1 牌性統計：吉、凶、中性的張數與整體傾向；九宮格另看凶牌集中在哪一列、哪一欄。
// cleansed：被 L3 化解的凶牌（例如鸛鳥朝向蛇），這次當中性計算，另外列在 cleansedIndexes。
// scope：只看哪幾張（index 陣列）；大藍圖只看中心周圍的近距離牌（36 張的吉凶互相抵銷，整體看不出東西，2026-11-25 使用者決定）。
//   沒給就是全部（小牌陣）。回傳的 scope 是 'all' 或 'near'，counts／total／lean／negativeIndexes／cleansedIndexes 都只算範圍內的牌。
const { NINE_BOX_CLUSTER_MIN } = require('../../../data/lenormand/ruleConfig')
const { NINE_BOX_ROWS, NINE_BOX_COLS } = require('../../../data/lenormand/spreads')
const { cellOf, toneLean } = require('../layout')

function analyzeTone({ items: allItems, spread, cleansed = [], scope = null }) {
  const items = scope ? allItems.filter((item) => scope.includes(item.index)) : allItems
  const isCleansed = (item) => item.card.tone === 'negative' && cleansed.includes(item.index)
  const effective = items.map((item) => (isCleansed(item) ? { ...item.card, tone: 'neutral' } : item.card))
  const { counts, lean } = toneLean(effective)
  const negatives = items.filter((item) => item.card.tone === 'negative' && !isCleansed(item))
  const clusters = []
  if (spread.key === 'nine-box') {
    const lines = [
      ...NINE_BOX_ROWS.map((row, r) => ({ axis: 'row', key: row.key, label: row.label, match: (cell) => cell.row === r + 1 })),
      ...NINE_BOX_COLS.map((col, c) => ({ axis: 'col', key: col.key, label: col.label, match: (cell) => cell.col === c + 1 })),
    ]
    for (const line of lines) {
      const indexes = negatives.filter((item) => line.match(cellOf(item))).map((item) => item.index)
      if (indexes.length >= NINE_BOX_CLUSTER_MIN) {
        clusters.push({ axis: line.axis, key: line.key, label: line.label, indexes, count: indexes.length })
      }
    }
  }
  return {
    scope: scope ? 'near' : 'all',
    counts,
    total: items.length,
    lean,
    negativeIndexes: negatives.map((item) => item.index),
    cleansedIndexes: items.filter(isCleansed).map((item) => item.index),
    clusters,
  }
}

module.exports = { analyzeTone }
