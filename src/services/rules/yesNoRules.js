// 規則 12：是非題的答案（會／不會）。詳見 doc/v23-tarot-yes-no-followup-plan.md
//
// 規則 11 的指向分數回答的是「這件事順不順」，不是「會不會發生」。問「會不會被換掉」時，
// 「偏順利」沒有定義，AI 會讀成「現狀順利所以不會」。這裡分三步：
// 1. 問題是不是是非題（會不會、是否、能不能、有沒有、…嗎）
// 2. 「是」代表什麼：事情變動（換掉、分手、離職）、維持（留任、繼續）、不好的事發生（失敗、虧損），或好的事發生（預設）
// 3. 變動／維持看 cardChange 的變動軸；好事／壞事看極性，但逆位要翻向（正向牌逆位＝受阻，偏「不會」）
const { getChangeValue } = require('../../data/cardChange')
const { getCardVector } = require('../../data/cardDimensions')
const { YES_NO } = require('../../data/ruleConfig')

const round2 = (value) => Math.round(value * 100) / 100

// 回傳 null（不是是非題）或 { yesMeans: 'change' | 'stay' | 'unfavorable' | 'favorable', keyword }
function detectYesNo(question) {
  const text = String(question || '').trim()
  if (!text || !YES_NO.questionPattern.test(text)) return null

  const find = (keywords) => keywords.find((keyword) => text.includes(keyword)) || null
  const change = find(YES_NO.changeKeywords)
  const stay = find(YES_NO.stayKeywords)
  // 同時提到走和留（「會離開還是留下」）是二選一，不是是非題
  if (change && stay) return null
  if (change) return { yesMeans: 'change', keyword: change }
  if (stay) return { yesMeans: 'stay', keyword: stay }
  const unfavorable = find(YES_NO.unfavorableKeywords)
  if (unfavorable) return { yesMeans: 'unfavorable', keyword: unfavorable }
  return { yesMeans: 'favorable', keyword: null }
}

// 好事會不會發生：正位照極性；逆位翻向並打折（正向牌逆位＝受阻；負向牌逆位＝壞事退去）
function favorableValue(item) {
  const vector = getCardVector(item.card, item.profile)
  if (!vector.polarityKnown) return null
  const value = vector.polarity * vector.intensity
  if (item.orientation !== 'reversed') return value
  return value > 0 ? -value * YES_NO.reversedPositive : -value * YES_NO.reversedNegative
}

// count：參與計算的牌數。門檻跟著 √張數 縮小（見 ruleConfig 的 YES_NO.lean 說明）
function verdictOf(score, count = 1) {
  const scaled = score * Math.sqrt(Math.max(1, count))
  if (scaled >= YES_NO.strong) return 'yes'
  if (scaled >= YES_NO.lean) return 'leanYes'
  if (scaled > -YES_NO.lean) return 'unclear'
  if (scaled > -YES_NO.strong) return 'leanNo'
  return 'no'
}

/**
 * @param items 規則引擎的牌（index / card / orientation / profile）
 * @param positionKeys 各張牌的位置 key（選填）；結果、未來的位置加重
 * @param positionWeights 各位置權重（選填，總和 1）
 * @returns null（不是是非題）或 { yesMeans, keyword, score, verdict, contributions }
 */
function analyzeYesNo({ question, items, positionKeys = null, positionWeights = null }) {
  const kind = detectYesNo(question)
  if (!kind || items.length === 0) return null

  const usesChangeAxis = kind.yesMeans === 'change' || kind.yesMeans === 'stay'
  // 「是」的方向：維持、壞事發生時，軸上的值要反過來
  const sign = kind.yesMeans === 'stay' || kind.yesMeans === 'unfavorable' ? -1 : 1
  const evenWeight = 1 / items.length

  const rows = items.map((item, i) => {
    const raw = usesChangeAxis ? getChangeValue(item.card, item.profile, item.orientation) : favorableValue(item)
    const positionWeight = positionWeights?.[i] ?? evenWeight
    const outcomeBoost = YES_NO.outcomeKeys.includes(positionKeys?.[i]) ? YES_NO.outcomeBoost : 1
    const weight = positionWeight * outcomeBoost * (YES_NO.kindWeights[item.profile.kind] ?? 1)
    // 兩條軸隨機抽牌的平均都不是 0，先扣掉基準值，「會」和「不會」的機會才相當
    const centered = raw === null ? null : raw - (usesChangeAxis ? YES_NO.changeOffset : YES_NO.favorableOffset)
    return { item, value: centered === null ? null : centered * sign, weight }
  })

  const known = rows.filter((row) => row.value !== null)
  const totalWeight = known.reduce((sum, row) => sum + row.weight, 0)
  if (totalWeight <= 0) return null

  const score = known.reduce((sum, row) => sum + row.weight * row.value, 0) / totalWeight
  const totalAbs = known.reduce((sum, row) => sum + Math.abs(row.weight * row.value), 0)
  // 每張牌把答案往「會」（正）還是「不會」（負）拉、拉多少
  const contributions = known
    .map((row) => ({
      index: row.item.index,
      value: round2(row.value),
      share: totalAbs > 0 ? round2((row.weight * row.value) / totalAbs) : 0,
    }))
    .sort((a, b) => Math.abs(b.share) - Math.abs(a.share))

  return {
    yesMeans: kind.yesMeans,
    keyword: kind.keyword,
    score: round2(score),
    verdict: verdictOf(round2(score), known.length),
    contributions,
  }
}

module.exports = { detectYesNo, analyzeYesNo, verdictOf }
