// 由牌陣宣告的 relations 產生要分析的配對清單。
// 牌陣沒有宣告時退回「相鄰兩張」，所以未設定的牌陣與手動選牌行為不變。
const { DEFAULT_KIND } = require('../../data/relationKinds')

/**
 * @param count 牌數
 * @param relations 牌陣宣告的關係對 [{ from, to, kind }]，索引為位置順序（0 起算）
 * @returns [{ from, to, kind }]，索引已確認在範圍內
 */
function resolveRelationPairs(count, relations = null) {
  if (Array.isArray(relations) && relations.length > 0) {
    return relations
      .filter(
        (relation) =>
          Number.isInteger(relation.from) &&
          Number.isInteger(relation.to) &&
          relation.from !== relation.to &&
          relation.from >= 0 &&
          relation.to >= 0 &&
          relation.from < count &&
          relation.to < count,
      )
      .map((relation) => ({ from: relation.from, to: relation.to, kind: relation.kind || DEFAULT_KIND }))
  }

  // 退回相鄰配對
  return Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({
    from: i,
    to: i + 1,
    kind: DEFAULT_KIND,
  }))
}

/**
 * 自訂位置裡名稱相同的位置分成一組（名稱完全相同才算，前後空白已在輸入時去掉）。
 * 沒有任何重複的名稱時回傳 null，維持原本「一張一個位置」的行為。
 * @param positions 牌陣位置 [{ label }]
 * @returns [{ label, indexes }]（依第一次出現的順序）或 null
 */
function positionGroups(positions) {
  if (!Array.isArray(positions) || positions.length < 2) return null
  const groups = []
  const byLabel = new Map()
  positions.forEach((position, index) => {
    const label = typeof position?.label === 'string' ? position.label.trim() : ''
    if (!label) return
    if (!byLabel.has(label)) {
      const group = { label, indexes: [] }
      byLabel.set(label, group)
      groups.push(group)
    }
    byLabel.get(label).indexes.push(index)
  })
  return groups.some((group) => group.indexes.length > 1) ? groups : null
}

/**
 * 有分組時的牌對：組內相鄰兩張是「同組」，組與組之間只比一對（前一組最後一張 → 下一組第一張，「對照」）。
 * 不同組不是時間上的前後，所以不用「順承」。沒有分組時回傳 null，交給 resolveRelationPairs 退回相鄰。
 */
function groupRelations(positions) {
  const groups = positionGroups(positions)
  if (!groups) return null
  const relations = []
  groups.forEach((group, groupIndex) => {
    for (let i = 1; i < group.indexes.length; i += 1) {
      relations.push({ from: group.indexes[i - 1], to: group.indexes[i], kind: 'group' })
    }
    const next = groups[groupIndex + 1]
    if (next) relations.push({ from: group.indexes[group.indexes.length - 1], to: next.indexes[0], kind: 'contrast' })
  })
  return relations
}

// 牌陣宣告的關係優先；沒有宣告時看自訂位置有沒有同名分組
function relationsOfSpread(spread) {
  if (Array.isArray(spread?.relations) && spread.relations.length > 0) return spread.relations
  return groupRelations(spread?.positions)
}

module.exports = {
  resolveRelationPairs,
  positionGroups,
  groupRelations,
  relationsOfSpread,
}
