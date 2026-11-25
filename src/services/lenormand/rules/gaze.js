// L4 視線與朝向：看 cards.js 的 facing（和原創插畫一致）。
// - looks：每張有朝向的牌看向、背對哪一張相鄰牌
// - mutual：同一列相鄰、都有朝向的兩張是面對面還是背對背
// - couple：紳士（28）與淑女（29）都出現時的關係；感情占卜看兩人心意是否一致
// - significator：求問者選的代表牌看向哪裡
const { cellOf, adjacentPairs, lookOf } = require('../layout')

const GENTLEMAN = 28
const LADY = 29

function coupleOf(items) {
  const g = items.find((item) => item.card.id === GENTLEMAN)
  const l = items.find((item) => item.card.id === LADY)
  if (!g || !l) return null
  const cg = cellOf(g)
  const cl = cellOf(l)
  const base = { gentleman: g.index, lady: l.index, between: [] }
  if (cg.row !== cl.row) return { ...base, relation: 'differentRows' }
  const [left, right] = cg.col < cl.col ? [g, l] : [l, g]
  const between = items
    .filter((item) => cellOf(item).row === cg.row && cellOf(item).col > cellOf(left).col && cellOf(item).col < cellOf(right).col)
    .map((item) => item.index)
  const adjacent = between.length === 0 && cellOf(right).col - cellOf(left).col === 1
  let relation = 'sameDirection'
  if (left.card.facing === 'right' && right.card.facing === 'left') relation = adjacent ? 'faceToFace' : 'facingApart'
  else if (left.card.facing === 'left' && right.card.facing === 'right') relation = 'backToBack'
  return { ...base, between, relation }
}

function analyzeGaze({ items, significator = null }) {
  const looks = items.map((item) => lookOf(items, item)).filter(Boolean)
  const mutual = []
  for (const { axis, first, second } of adjacentPairs(items)) {
    if (axis !== 'horizontal') continue
    if (first.card.facing === 'right' && second.card.facing === 'left') mutual.push({ a: first.index, b: second.index, relation: 'faceToFace' })
    else if (first.card.facing === 'left' && second.card.facing === 'right') mutual.push({ a: first.index, b: second.index, relation: 'backToBack' })
  }
  let sig = null
  if (significator) {
    const item = items.find((entry) => entry.card.id === significator)
    const look = item ? lookOf(items, item) : null
    sig = { cardId: significator, index: item ? item.index : null, toward: look ? look.toward : null, away: look ? look.away : null }
  }
  return { looks, mutual, couple: coupleOf(items), significator: sig }
}

module.exports = { analyzeGaze, GENTLEMAN, LADY }
