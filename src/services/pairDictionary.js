// 牌對組合辭典的查詢與逐層退回。詳見 doc/v05-tarot-pair-dictionary-plan.md
//
// 查詢優先序（找到就用）：
//   1. (牌對, 指定領域) 人工精選
//   2. (牌對, any)      人工精選   ← 經典組合不分領域都成立
//   3. (牌對, 指定領域) AI 生成
//   4. 規則運算（呼叫端的既有邏輯）
//
// 辭典完全沒有資料時，第 4 層讓行為與現況相同，所以這是漸進增強而非前置條件。
const CardPair = require('../models/CardPair')
const { CURATED_PAIRS } = require('../data/curatedPairs')

const ANY_DOMAIN = 'any'

function pairKey(fromSlug, fromOrientation, toSlug, toOrientation) {
  return `${fromSlug}|${fromOrientation}>${toSlug}|${toOrientation}`
}

// 人工精選以程式碼管理（方便版控與審閱），啟動時建索引
const curatedIndex = new Map()
for (const entry of CURATED_PAIRS) {
  curatedIndex.set(`${entry.key}@${entry.domain || ANY_DOMAIN}`, entry)
}

function lookupCurated(key, domain) {
  return curatedIndex.get(`${key}@${domain}`) || curatedIndex.get(`${key}@${ANY_DOMAIN}`) || null
}

/**
 * 批次查詢一次占卜中所有相鄰配對的辭典文字。
 * 一次查完再交給 formatter，formatter 才能維持同步的純函式。
 *
 * @param pairs 形如 [{ from: {slug, orientation}, to: {slug, orientation} }]
 * @param domain 已決定的領域；null 代表判斷不出領域
 * @returns Map<key, { text, source }>
 */
async function lookupPairs(pairs, domain) {
  const found = new Map()
  if (pairs.length === 0) {
    return found
  }

  const keys = pairs.map((pair) =>
    pairKey(pair.from.slug, pair.from.orientation, pair.to.slug, pair.to.orientation),
  )

  // 第 1、2 層：人工精選（記憶體查表，不碰資料庫）
  const missing = []
  for (const key of keys) {
    const curated = domain ? lookupCurated(key, domain) : curatedIndex.get(`${key}@${ANY_DOMAIN}`)
    if (curated) {
      found.set(key, { text: curated.text, source: 'curated' })
    } else {
      missing.push(key)
    }
  }

  // 第 3 層：AI 生成（只查指定領域；沒有領域就不查，直接退回規則）
  if (missing.length > 0 && domain) {
    const rows = await CardPair.find({ key: { $in: missing }, domain }).lean()
    for (const row of rows) {
      found.set(row.key, { text: row.text, source: 'ai' })
    }
  }

  return found
}

module.exports = {
  ANY_DOMAIN,
  pairKey,
  lookupPairs,
}
