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

module.exports = {
  resolveRelationPairs,
}
