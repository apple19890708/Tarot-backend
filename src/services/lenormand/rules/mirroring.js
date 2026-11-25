// L11 鏡射（大藍圖）：以牌陣中軸對照。左右（同一列，第 c 欄 ↔ 第 cols+1−c 欄）、上下（同一欄，第 r 列 ↔ 第 rows+1−r 列）、對角（兩者都換）。
// 9 欄的中間欄（第 5 欄）左右鏡射會落回自己：leftRight 與 diagonal（會和 topBottom 同一格）都給 null。4 列沒有中間列，topBottom 一定有。
// 九宮格的左右、上下鏡射在 L5（nineBox.js）。
const { cellOf, itemAt } = require('../layout')

function mirrorsOf(items, origin, grid) {
  const { col, row } = cellOf(items[origin])
  const mc = grid.cols + 1 - col
  const mr = grid.rows + 1 - row
  const indexAt = (c, r) => itemAt(items, c, r)?.index ?? null
  const sameCol = mc === col
  return {
    leftRight: sameCol ? null : indexAt(mc, row),
    topBottom: mr === row ? null : indexAt(col, mr),
    diagonal: sameCol || mr === row ? null : indexAt(mc, mr),
  }
}

// origins：[{ from: 'center' | 'theme', origin: index }]
function analyzeMirroring({ items, origins, grid }) {
  return origins.map(({ from, origin }) => ({ from, origin, ...mirrorsOf(items, origin, grid) }))
}

module.exports = { analyzeMirroring, mirrorsOf }
