const { WEIGHT_THRESHOLDS } = require('../../data/ruleConfig')

const round2 = (value) => Math.round(value * 100) / 100
// 避免浮點誤差讓剛好等於門檻的值被判到下一級（例如 11 ÷ 5 = 2.2）
const atLeast = (value, threshold) => value >= threshold - 1e-9

// 規則 10：權重分析（大牌 3、宮廷牌 2、數字牌 1）
// focusIndex 為權重最高的牌（焦點牌）；timeOrdered 表示牌陣有時間順序，才判斷影響力走向
function analyzeWeights({ items, focusIndex, timeOrdered, countDominantElements }) {
  const total = items.reduce((sum, item) => sum + item.profile.weight, 0)
  const average = total / items.length

  let intensity = 'daily'
  if (atLeast(average, WEIGHT_THRESHOLDS.intensityMajor)) {
    intensity = 'major'
  } else if (atLeast(average, WEIGHT_THRESHOLDS.intensityMedium)) {
    intensity = 'medium'
  }

  // 只比第一張與最後一張的牌種權重（小牌 1／宮廷 2／大牌 3）。
  // 差一階（例如宮廷→小牌）訊號太弱，說成「分量越走越輕」是過度詮釋；
  // 差兩階才是大牌↔小牌，那個轉折才真的值得講。
  let trend = null
  if (timeOrdered && items.length >= 2) {
    const first = items[0].profile.weight
    const last = items[items.length - 1].profile.weight
    const gap = last - first
    trend = gap >= 2 ? 'rising' : gap <= -2 ? 'falling' : null
  }

  const weightedElements = {}
  items
    .filter((item) => item.profile.element)
    .forEach((item) => {
      weightedElements[item.profile.element] = (weightedElements[item.profile.element] || 0) + item.profile.weight
    })

  // 加權主導元素：第一名至少比第二名多 1 分才成立
  const ranked = Object.entries(weightedElements).sort((a, b) => b[1] - a[1])
  const weightedDominant =
    ranked.length > 0 && ranked[0][1] - (ranked[1]?.[1] || 0) >= WEIGHT_THRESHOLDS.weightedElementMargin
      ? ranked[0][0]
      : null
  const majorShiftsElement = Boolean(weightedDominant) && !countDominantElements.includes(weightedDominant)

  const reversedWeight = items
    .filter((item) => item.orientation === 'reversed')
    .reduce((sum, item) => sum + item.profile.weight, 0)
  const reversedWeightRatio = total > 0 ? reversedWeight / total : 0

  let resistance = 'low'
  if (atLeast(reversedWeightRatio, WEIGHT_THRESHOLDS.resistanceHigh)) {
    resistance = 'high'
  } else if (atLeast(reversedWeightRatio, WEIGHT_THRESHOLDS.resistanceSome)) {
    resistance = 'some'
  }

  const majorWeight = items
    .filter((item) => item.profile.kind === 'major')
    .reduce((sum, item) => sum + item.profile.weight, 0)

  return {
    total,
    average: round2(average),
    intensity,
    centerIndex: focusIndex,
    trend,
    weightedElements,
    weightedDominant,
    majorShiftsElement,
    reversedWeightRatio: round2(reversedWeightRatio),
    resistance,
    majorWeightShare: total > 0 ? round2(majorWeight / total) : 0,
  }
}

module.exports = {
  analyzeWeights,
}
