// L8 關鍵牌（大藍圖；計畫書原稱「主題牌」，2026-11-25 使用者決定顯示文字改叫「關鍵牌」，避免和主題牌陣中間的「主題牌」撞名；欄位名稱 themeCard 不變）：依問題類型找關鍵牌（感情＝愛心、財務＝魚、工作＝錨、健康＝樹木、家庭＝房屋、人際＝庭園、學業＝書），
// 看它在哪一宮、離中心多遠、在中心的哪個方位、周圍是哪些牌。
// 沒出現時改讀它對應的宮位（主題牌都是傳統牌，第 n 張對應第 n 宮），present 為 false。
const { cellOf, chebyshev, neighborsOf } = require('../layout')
const { distanceGroup } = require('./significator')

function directionOf(cell, center) {
  return {
    horizontal: cell.col < center.col ? 'past' : cell.col > center.col ? 'future' : 'same',
    vertical: cell.row < center.row ? 'conscious' : cell.row > center.row ? 'subconscious' : 'same',
  }
}

function analyzeThemeCard({ items, domain, center }) {
  if (!domain || !domain.themeCardId) return null
  const found = items.find((item) => item.card.id === domain.themeCardId)
  const item = found || items.find((entry) => entry.position.house === domain.themeCardId)
  const cell = cellOf(item)
  const steps = chebyshev(cell, center)
  return {
    cardId: domain.themeCardId,
    present: Boolean(found),
    index: item.index,
    house: item.position.house,
    distance: distanceGroup(steps),
    steps,
    direction: directionOf(cell, center),
    surroundings: neighborsOf(items, cell),
  }
}

module.exports = { analyzeThemeCard }
