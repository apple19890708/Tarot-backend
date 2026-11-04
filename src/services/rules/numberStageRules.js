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

// 宮廷牌沒有數字，依階級的成熟度對應階段（v11：使用者決定納入，不再排除）。
// 侍者學習起步、騎士行動推進、皇后成熟掌握、國王完成主導。
const COURT_STAGES = {
  page: { stage: 'start', theme: '學習、消息' },
  knight: { stage: 'develop', theme: '行動、推進' },
  queen: { stage: 'trial', theme: '成熟、內在掌握' },
  king: { stage: 'end', theme: '完成、主導' },
}

// 每張牌落在哪個階段。
// 小牌用牌面數字；大牌用化簡後的數字（13 死神 → 4），和小牌放在同一條 0～10 的尺度；
// 宮廷牌依階級對應。每張牌都有自己的號碼（匯入時 tarotParser 會檢查，缺號直接報錯），
// 所以每張牌都對得到階段；回 null 只是資料庫被手動改壞時的保護。
function stepOf(item) {
  const { profile } = item
  if (profile.kind === 'court') {
    const court = COURT_STAGES[profile.courtRank]
    if (!court) return null
    return { index: item.index, kind: 'court', number: null, stage: court.stage, themeLabel: court.theme }
  }
  if (profile.numerology === null || profile.numerology === undefined) return null
  return {
    index: item.index,
    kind: profile.kind,
    number: profile.numerology,
    // 大牌化簡前的編號，文字要寫出「13→4」，否則讀者會以為死神是 4 號
    majorNumber: profile.kind === 'major' ? profile.majorNumber : undefined,
    stage: getNumberStage(profile.numerology),
    // 數字主題（「抉擇、平衡」之類），文字層要用它講重複強調
    themeLabel: profile.numberTheme,
  }
}

// 有時間順序的位置與先後。走向只看這些格子：
// 「負面影響」「資源」這類位置不是時間點，串進箭頭裡會描述出不存在的推進。
// 近未來與未來同一級（不會同時出現在同一個牌陣）。
const TIME_ORDER = {
  past: 0,
  present: 1,
  'near-future': 2,
  future: 2,
  outcome: 3,
}

// 規則 9：數字階段。小牌、大牌、宮廷牌都納入；一張都對不上時回傳 null
// positionKeys：有牌陣時用來挑出時間線；手動選牌（null）時整組照抽牌順序當成時間線
function analyzeNumberStage(items, positionKeys = null) {
  const sequence = items.map(stepOf).filter(Boolean)
  if (sequence.length === 0) {
    return null
  }

  const stages = {}
  sequence.forEach((step) => {
    stages[step.stage] = (stages[step.stage] || 0) + 1
  })

  // 主要階段：張數 ≥ 一半，且是唯一最多的階段；否則視為階段分散
  const maxCount = Math.max(...Object.values(stages))
  const topStages = Object.keys(stages).filter((stage) => stages[stage] === maxCount)
  const dominant = topStages.length === 1 && maxCount >= sequence.length / 2 ? topStages[0] : null

  // 時間線：有牌陣時只取時間位置並依時間先後排；沒有牌陣時就是抽牌順序
  const timeline = positionKeys
    ? sequence
        .filter((step) => TIME_ORDER[positionKeys[step.index]] !== undefined)
        .sort((a, b) => TIME_ORDER[positionKeys[a.index]] - TIME_ORDER[positionKeys[b.index]])
    : sequence

  let trend = null
  if (timeline.length >= 2) {
    const first = NUMBER_STAGES[timeline[0].stage].order
    const last = NUMBER_STAGES[timeline[timeline.length - 1].stage].order
    trend = last > first ? 'forward' : last < first ? 'backward' : 'same'
  }

  const included = new Set(sequence.map((step) => step.index))

  return {
    stages,
    dominant,
    trend,
    evidence: sequence.map((step) => step.index),
    // 所有能對到階段的牌，依牌陣順序
    sequence,
    // 時間線上的牌（index），依時間先後；走向與形狀只看這條
    timeline: timeline.map((step) => step.index),
    // 時間線少於兩格就沒有走向可言
    shape: timeline.length >= 2 ? getShape(timeline) : null,
    // v11 起每張牌都納入，正常資料下一定是空陣列；保留欄位給舊版前端的型別
    skipped: items.filter((item) => !included.has(item.index)).map((item) => item.index),
  }
}

module.exports = {
  analyzeNumberStage,
}
