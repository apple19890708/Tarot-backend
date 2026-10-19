const { QUESTION_DOMAINS } = require('../../data/ruleConfig')

// 規則 7：問題領域對照。問題沒有命中任何領域時回傳 null
function analyzeQuestion({ question, items }) {
  const text = String(question || '')
  const domains = Object.keys(QUESTION_DOMAINS).filter((domain) =>
    QUESTION_DOMAINS[domain].keywords.some((keyword) => text.includes(keyword)),
  )

  if (domains.length === 0) {
    return null
  }

  const expectedSuits = [...new Set(domains.flatMap((domain) => QUESTION_DOMAINS[domain].suits))]
  const minors = items.filter((item) => item.profile.kind !== 'major')

  if (minors.length === 0) {
    return { domains, expectedSuits, alignment: 'noMinor', topSuits: [], evidence: [] }
  }

  const suitCounts = {}
  minors.forEach((item) => {
    suitCounts[item.profile.suit] = (suitCounts[item.profile.suit] || 0) + 1
  })
  const maxCount = Math.max(...Object.values(suitCounts))
  const topSuits = Object.keys(suitCounts).filter((suit) => suitCounts[suit] === maxCount)

  // 「對焦」要求張數最多的花色全都落在該領域內。
  // 若與其他花色並列最多，代表牌面同時從別的角度切入，降級為「部分回應」。
  let alignment = 'mismatch'
  if (topSuits.every((suit) => expectedSuits.includes(suit))) {
    alignment = 'aligned'
  } else if (expectedSuits.some((suit) => suitCounts[suit])) {
    alignment = 'partial'
  }

  // 對焦或部分時，依據是對應花色的牌；偏離時，依據是牌面實際最多的花色
  const evidenceSuits = alignment === 'mismatch' ? topSuits : expectedSuits
  const evidence = minors.filter((item) => evidenceSuits.includes(item.profile.suit)).map((item) => item.index)

  return { domains, expectedSuits, alignment, topSuits, evidence }
}

module.exports = {
  analyzeQuestion,
}
