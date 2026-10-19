const { NUMBER_STAGES, getNumberStage } = require('../../data/ruleConfig')

// 整條路徑的形狀。只看有變化的步伐方向，連續相同的階段不算轉折。
// 轉折 0 次是單向（rising／falling），1 次是中間有高／低點，2 次以上就是來回擺盪。
function getShape(sequence) {
  const orders = sequence.map((step) => NUMBER_STAGES[step.stage].order)

  if (orders.length === 1) {
    return 'flat'
  }

  if (Math.max(...orders) === Math.min(...orders)) {
    return 'flat'
  }

  const directions = []
  for (let i = 1; i < orders.length; i += 1) {
    const direction = Math.sign(orders[i] - orders[i - 1])
    if (direction !== 0 && direction !== directions[directions.length - 1]) {
      directions.push(direction)
    }
  }

  if (directions.length === 1) {
    return directions[0] > 0 ? 'rising' : 'falling'
  }

  if (directions.length === 2) {
    return directions[0] > 0 ? 'peak' : 'dip'
  }

  return 'zigzag'
}

// 規則 9：數字階段。使用化簡後的數字，宮廷牌不計；沒有任何有數字的牌時回傳 null
function analyzeNumberStage(items) {
  // 只看小牌。大牌的編號是愚者旅程的位置、宮廷牌是人物階級，
  // 都不是「元素發展到第幾階段」，把它們和小牌的數字放進同一條尺度會算出假的走向。
  const numbered = items.filter((item) => item.profile.kind === 'pip' && item.profile.numerology !== null)
  if (numbered.length === 0) {
    return null
  }

  const stageOf = (item) => getNumberStage(item.profile.numerology)

  const stages = {}
  numbered.forEach((item) => {
    const stage = stageOf(item)
    stages[stage] = (stages[stage] || 0) + 1
  })

  // 主要階段：張數 ≥ 一半，且是唯一最多的階段；否則視為階段分散
  const maxCount = Math.max(...Object.values(stages))
  const topStages = Object.keys(stages).filter((stage) => stages[stage] === maxCount)
  const dominant = topStages.length === 1 && maxCount >= numbered.length / 2 ? topStages[0] : null

  let trend = null
  if (numbered.length >= 2) {
    const first = NUMBER_STAGES[stageOf(numbered[0])].order
    const last = NUMBER_STAGES[stageOf(numbered[numbered.length - 1])].order
    trend = last > first ? 'forward' : last < first ? 'backward' : 'same'
  }

  // v7：敘述改成依牌陣順序走一遍，sequence 是主軸，stages／dominant 只留著供判斷用
  const sequence = numbered.map((item) => ({
    index: item.index,
    number: item.profile.numerology,
    stage: stageOf(item),
    // 數字主題（「抉擇、平衡」之類），文字層要用它講重複強調
    themeLabel: item.profile.numberTheme,
  }))

  return {
    stages,
    dominant,
    trend,
    evidence: numbered.map((item) => item.index),
    sequence,
    shape: getShape(sequence),
    // 被排除的牌要在文字裡交代，否則使用者會以為漏算。
    // 尤其當被排除的正是最有份量的那張時，靜默剔除會讓「原地踏步」這種結論
    // 變成剔除規則的產物，而不是牌面的訊息。
    skipped: items.filter((item) => item.profile.kind !== 'pip').map((item) => item.index),
  }
}

module.exports = {
  analyzeNumberStage,
}
