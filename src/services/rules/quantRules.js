// 規則 11：量化指標（指向分數、四軸能量、動能與阻力、明朗度）
// 詳見 doc/v04-tarot-quant-analysis-plan.md
// 值域由建構保證：每張牌的投影值 v ∈ [-1,1]，加權平均後仍在 [-1,1]，故 DI ∈ [-100,100]，不需夾擠。
const { DIMENSION_KEYS, getCardVector } = require('../../data/cardDimensions')
const { getDomainConfig, QUANT } = require('../../data/ruleConfig')

const round2 = (value) => Math.round(value * 100) / 100
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

// 四軸能量的分散程度，用正規化熵：集中在單一軸為 0，四軸均等為 1
function spreadEntropy(energy) {
  const total = DIMENSION_KEYS.reduce((sum, key) => sum + energy[key], 0)
  if (total <= 0) {
    return 1
  }
  const entropy = DIMENSION_KEYS.reduce((sum, key) => {
    const p = energy[key] / total
    return p > 0 ? sum - p * Math.log(p) : sum
  }, 0)
  return entropy / Math.log(DIMENSION_KEYS.length)
}

function getDirection(di) {
  if (di >= QUANT.directionStrong) return 'strongPositive'
  if (di >= QUANT.directionMild) return 'positive'
  if (di > -QUANT.directionMild) return 'neutral'
  if (di > -QUANT.directionStrong) return 'negative'
  return 'strongNegative'
}

/**
 * @param items 規則引擎的牌（含 index / card / orientation / profile）
 * @param domain 已決定的領域 key
 * @param positionWeights 各位置權重，總和為 1；null 代表平均分配
 * @param conflictCount 規則 4 的矛盾點數量，用於明朗度
 * @param domainResolvedFrom 'user' | 'keyword' | 'none'，none 會扣明朗度
 */
function analyzeQuant({ items, domain, positionWeights, conflictCount = 0, domainResolvedFrom = 'none' }) {
  if (items.length === 0) {
    return null
  }

  const domainConfig = getDomainConfig(domain)
  const domainWeights = domainConfig.dimensions
  const evenWeight = 1 / items.length
  // relevance 取相對值：除以該領域最在意的那一軸，讓「完全對題」的牌等於 1。
  // 否則單一元素的牌在均等領域只拿到 0.25，整個 DI 值域被壓到 ±25。
  const maxDomainWeight = Math.max(...DIMENSION_KEYS.map((key) => domainWeights[key]))

  const rows = items.map((item, i) => {
    const vector = getCardVector(item.card, item.profile)
    const positionWeight = positionWeights?.[i] ?? evenWeight
    // 大小牌影響力放進加權平均的分母，而不是乘進分數，值域才不會爆開
    const weight = positionWeight * item.profile.weight
    const orientation = item.orientation === 'reversed' ? QUANT.reversedAttenuation : 1

    // 維度正規化成總和 1，relevance 才會由建構保證落在 [0,1]（證明：Σd=1 → Σ(d·w) ≤ max(w)）
    const dimensionSum = DIMENSION_KEYS.reduce((sum, key) => sum + vector.dimensions[key], 0)
    const dimensions = {}
    DIMENSION_KEYS.forEach((key) => {
      dimensions[key] = dimensionSum > 0 ? vector.dimensions[key] / dimensionSum : 0
    })

    // relevance ∈ [0,1]：這張牌的面向與問題在意的面向有多吻合
    const relevance =
      maxDomainWeight > 0
        ? DIMENSION_KEYS.reduce((sum, key) => sum + dimensions[key] * domainWeights[key], 0) / maxDomainWeight
        : 0
    // v ∈ [-1,1]
    const v = vector.polarity * relevance * orientation * vector.intensity

    return { item, vector, dimensions, weight, orientation, relevance, v }
  })

  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0)
  if (totalWeight <= 0) {
    return null
  }

  const di = (rows.reduce((sum, row) => sum + row.weight * row.v, 0) / totalWeight) * 100

  // 四軸能量：力氣花在哪個面向，不乘極性（好壞由 DI 表達）
  const energy = {}
  DIMENSION_KEYS.forEach((key) => {
    energy[key] = round2(
      rows.reduce((sum, row) => sum + row.weight * row.dimensions[key] * row.orientation, 0) / totalWeight,
    )
  })

  // 動能與阻力要看「牌本身是好是壞」，不是只看正逆位（v9 P1）。
  // 舊的算法只數正位／逆位的權重，於是一副全是正位的寶劍三、九、十
  // 會算出動能高、阻力零，被講成「使得上力、大致順利」—— 與牌義完全相反。
  //
  // polarity 已經逐張標注（寶劍三 −0.9、聖杯十 +0.9、權杖七 0），直接用它。
  // 逆位不翻轉正負，只把力道打到 reversedAttenuation 倍。
  const momentum =
    rows.reduce((sum, row) => sum + row.weight * Math.max(0, row.vector.polarity) * row.orientation, 0) /
    totalWeight

  // 阻力拆成兩個來源，文字才講得出「卡在哪裡」：
  // 牌義本身就負面，和正向的牌因為逆位而沒使出來，是兩件不同的事。
  const resistanceFromMeaning =
    rows.reduce((sum, row) => sum + row.weight * Math.max(0, -row.vector.polarity) * row.orientation, 0) /
    totalWeight

  const resistanceFromReversal =
    rows.reduce((sum, row) => sum + row.weight * Math.max(0, row.vector.polarity) * (1 - row.orientation), 0) /
    totalWeight

  const resistance = resistanceFromMeaning + resistanceFromReversal

  // 焦點集中度：力氣是壓在少數面向還是平均攤開。熵越低越集中。
  // 雷達圖看得出形狀，但看不出「這算集中還是分散」，所以另外給一個數字。
  const focus = 1 - spreadEntropy(energy)

  const unknownRatio =
    rows.reduce((sum, row) => sum + (row.vector.polarityKnown && row.item.profile.element ? 0 : row.weight), 0) /
    totalWeight
  const penalty = QUANT.confidencePenalty
  const confidence = clamp(
    1 -
      penalty.unknownElement * unknownRatio -
      penalty.spread * spreadEntropy(energy) -
      penalty.conflicts * Math.min(1, conflictCount / items.length) -
      (domainResolvedFrom === 'none' ? penalty.noDomain : 0),
    0,
    1,
  )

  // 每張牌對 DI 的貢獻佔比（含正負），讓前端標出誰推高、誰拉低
  const totalAbs = rows.reduce((sum, row) => sum + Math.abs(row.weight * row.v), 0)
  const contributions = rows
    .map((row) => ({
      index: row.item.index,
      v: round2(row.v),
      weight: round2(row.weight / totalWeight),
      share: totalAbs > 0 ? round2((row.weight * row.v) / totalAbs) : 0,
    }))
    .sort((a, b) => Math.abs(b.share) - Math.abs(a.share))

  return {
    domain,
    domainLabel: domainConfig.label,
    domainResolvedFrom,
    domainWeights,
    di: round2(di),
    direction: getDirection(di),
    energy,
    momentum: round2(momentum),
    resistance: round2(resistance),
    focus: round2(focus),
    // 阻力的兩個來源，供文字判斷要講「牌義本身偏滯」還是「逆位使不出來」
    resistanceFromMeaning: round2(resistanceFromMeaning),
    resistanceFromReversal: round2(resistanceFromReversal),
    confidence: round2(confidence),
    confidenceLow: confidence < QUANT.confidenceLowThreshold,
    contributions,
  }
}

module.exports = {
  analyzeQuant,
  spreadEntropy,
  getDirection,
}
