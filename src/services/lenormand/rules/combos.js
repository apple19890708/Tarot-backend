// L3 特殊組合字典：相鄰的兩張命中字典（ruleConfig.COMBOS）就標出來。
// - 一般組合不分順序；condition: 'faces' 的要 cards[0] 朝向 cards[1]（同一列、左右相鄰）
// - 鸛鳥這類「化解者」朝向相鄰的凶牌時，另外標出 cleanses（字典已有的組合不重複）
const { COMBOS, CLEANSERS } = require('../../../data/lenormand/ruleConfig')
const { adjacentPairs, faces } = require('../layout')

const keyOf = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`)
const COMBO_BY_PAIR = new Map(COMBOS.map((combo) => [keyOf(combo.cards[0], combo.cards[1]), combo]))

function analyzeCombos({ items }) {
  const results = []
  const seen = new Set()
  for (const { axis, first, second } of adjacentPairs(items)) {
    const combo = COMBO_BY_PAIR.get(keyOf(first.card.id, second.card.id))
    if (combo) {
      const [lead, other] = combo.cards[0] === first.card.id ? [first, second] : [second, first]
      if (combo.condition === 'faces' && !(axis === 'horizontal' && faces(lead, other))) continue
      const entry = { id: combo.id, indexes: [lead.index, other.index], cardIds: [lead.card.id, other.card.id], tone: combo.tone, meaning: combo.meaning }
      if (combo.condition) entry.condition = combo.condition
      if (combo.condition === 'faces') entry.cleanses = other.index
      results.push(entry)
      seen.add(keyOf(first.index, second.index))
      continue
    }
    if (axis !== 'horizontal') continue
    for (const cleanser of CLEANSERS) {
      for (const [lead, other] of [
        [first, second],
        [second, first],
      ]) {
        if (lead.card.id !== cleanser.cardId || other.card.tone !== cleanser.targetTone || !faces(lead, other)) continue
        if (seen.has(keyOf(lead.index, other.index))) continue
        results.push({
          id: `cleanse-${lead.card.id}-${other.card.id}`,
          indexes: [lead.index, other.index],
          cardIds: [lead.card.id, other.card.id],
          tone: 'positive',
          meaning: '凶牌的負面被化解',
          condition: 'faces',
          cleanses: other.index,
        })
        seen.add(keyOf(lead.index, other.index))
      }
    }
  }
  return results
}

module.exports = { analyzeCombos, COMBO_BY_PAIR, keyOf }
