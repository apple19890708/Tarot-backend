const mongoose = require('mongoose')

const ORIENTATIONS = ['upright', 'reversed']
const MANUAL_MAX_CARDS = 10
const SUIT_ORDER = { wands: 0, cups: 1, swords: 2, pentacles: 3 }

// 大牌依編號、小牌依花色再依編號，供前端分組顯示
function compareCards(a, b) {
  if (a.arcanaType !== b.arcanaType) {
    return a.arcanaType === 'major' ? -1 : 1
  }
  if (a.arcanaType === 'minor' && a.suit !== b.suit) {
    return (SUIT_ORDER[a.suit] ?? 99) - (SUIT_ORDER[b.suit] ?? 99)
  }
  return a.number - b.number
}

// 驗證手動選牌送來的 cards，回傳 { error } 或 { drawn }
function validateManualCards(raw) {
  const drawn = Array.isArray(raw) ? raw : []
  if (drawn.length < 1 || drawn.length > MANUAL_MAX_CARDS) {
    return { error: `請選擇 1 到 ${MANUAL_MAX_CARDS} 張牌。` }
  }
  const ids = new Set()
  for (const item of drawn) {
    if (!mongoose.isValidObjectId(item?.id) || !ORIENTATIONS.includes(item?.orientation)) {
      return { error: '牌卡資料格式不正確。' }
    }
    if (ids.has(String(item.id))) {
      return { error: '同一張牌不可重複選取。' }
    }
    ids.add(String(item.id))
  }
  return { drawn }
}

module.exports = {
  MANUAL_MAX_CARDS,
  compareCards,
  validateManualCards,
}
