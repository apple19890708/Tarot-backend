// 機器學習預測：邏輯迴歸，預測「N 個交易日後的收盤是否高於今天」。
//
// 為什麼是邏輯迴歸而不是 LSTM：資料只有幾年的日 K（一千多筆），複雜模型很容易過度擬合；
// 邏輯迴歸夠簡單、每個特徵的影響方向看得懂，也比較不會騙人。
// 最重要的是誠實評估：依時間切開，前段訓練、後段測試（不能打亂，否則等於偷看未來），
// 並和「一律猜多數那一邊」的基準比較。沒贏過基準就標示不可靠。
//
// 個股常跟著大盤走，所以可以傳入大盤的序列（context），多加兩個大盤特徵；
// 同時也會算一次「不加大盤」的準確率，讓人看得出大盤特徵到底有沒有幫助。
const { round } = require('./indicators')

const HORIZON = 5
const TRAIN_RATIO = 0.8
const ITERATIONS = 600
const LEARNING_RATE = 0.1
const L2 = 0.01
// 樣本外準確率至少要比基準高這麼多（百分點），而且測試樣本夠多，才算有參考價值
const MIN_EDGE = 3
const MIN_TEST_SAMPLES = 100

// 特徵：全部是相對值（比率、指標），不同價位的股票可以用同一套
const FEATURES = [
  { key: 'ret1', label: '昨日漲跌', get: (s, i) => s.closes[i] / s.closes[i - 1] - 1 },
  { key: 'ret5', label: '近 5 日漲跌', get: (s, i) => s.closes[i] / s.closes[i - 5] - 1 },
  { key: 'ret20', label: '近 20 日漲跌', get: (s, i) => s.closes[i] / s.closes[i - 20] - 1 },
  { key: 'distMa20', label: '與月線的距離', get: (s, i) => s.closes[i] / s.ma20[i] - 1 },
  { key: 'distMa60', label: '與季線的距離', get: (s, i) => s.closes[i] / s.ma60[i] - 1 },
  { key: 'ma5Ma20', label: '短中均線差', get: (s, i) => s.ma5[i] / s.ma20[i] - 1 },
  { key: 'rsi', label: 'RSI', get: (s, i) => s.rsi14[i] / 100 },
  { key: 'k', label: 'K 值', get: (s, i) => s.k[i] / 100 },
  { key: 'kMinusD', label: 'K 減 D', get: (s, i) => (s.k[i] - s.d[i]) / 100 },
  { key: 'macd', label: 'MACD 柱體', get: (s, i) => s.macdHist[i] / s.closes[i] },
  { key: 'volume', label: '量比', get: (s, i) => Math.log(s.volumeRatio[i] ?? 1) },
]

// 大盤特徵：用「同一天或之前最近的一天」的大盤資料（兩邊休市日可能不同）
function contextFeatures(label) {
  return [
    { key: 'mktRet5', label: `${label}近 5 日漲跌`, get: (s, i, c, j) => (j >= 5 ? c.closes[j] / c.closes[j - 5] - 1 : NaN) },
    { key: 'mktDistMa20', label: `${label}與月線的距離`, get: (s, i, c, j) => (c.ma20[j] ? c.closes[j] / c.ma20[j] - 1 : NaN) },
  ]
}

// series 每一天對應到 context 的哪一天（同一天或之前最近的交易日），找不到為 -1
function alignDates(dates, contextDates) {
  const result = new Array(dates.length).fill(-1)
  let j = -1
  for (let i = 0; i < dates.length; i += 1) {
    while (j + 1 < contextDates.length && contextDates[j + 1] <= dates[i]) j += 1
    result[i] = j
  }
  return result
}

const sigmoid = (z) => 1 / (1 + Math.exp(-z))

function standardize(rows) {
  const n = rows.length
  const dims = rows[0].length
  const mean = new Array(dims).fill(0)
  const std = new Array(dims).fill(0)
  for (const row of rows) row.forEach((v, j) => (mean[j] += v / n))
  for (const row of rows) row.forEach((v, j) => (std[j] += (v - mean[j]) ** 2 / n))
  for (let j = 0; j < dims; j += 1) std[j] = Math.sqrt(std[j]) || 1
  return { mean, std, apply: (row) => row.map((v, j) => (v - mean[j]) / std[j]) }
}

// 批次梯度下降，含 L2 正則。固定初始值與迭代次數，同一份資料每次結果都一樣
function train(rows, labels) {
  const dims = rows[0].length
  const weights = new Array(dims).fill(0)
  let bias = 0
  const n = rows.length
  for (let iter = 0; iter < ITERATIONS; iter += 1) {
    const grad = new Array(dims).fill(0)
    let gradBias = 0
    for (let i = 0; i < n; i += 1) {
      const z = rows[i].reduce((sum, v, j) => sum + v * weights[j], bias)
      const error = sigmoid(z) - labels[i]
      for (let j = 0; j < dims; j += 1) grad[j] += error * rows[i][j]
      gradBias += error
    }
    for (let j = 0; j < dims; j += 1) {
      weights[j] -= LEARNING_RATE * (grad[j] / n + L2 * weights[j])
    }
    bias -= LEARNING_RATE * (gradBias / n)
  }
  return { weights, bias, predict: (row) => sigmoid(row.reduce((sum, v, j) => sum + v * weights[j], bias)) }
}

// 用指定的特徵組訓練、評估，再用全部資料重新訓練預測今天
function evaluate(series, features, { horizon, context, aligned }) {
  const { closes } = series
  const rowAt = (i) => {
    const j = aligned ? aligned[i] : -1
    const row = features.map((f) => f.get(series, i, context, j))
    return row.every(Number.isFinite) ? row : null
  }

  const samples = []
  for (let i = 60; i < closes.length - horizon; i += 1) {
    const row = rowAt(i)
    if (row) samples.push({ i, row, label: closes[i + horizon] > closes[i] ? 1 : 0 })
  }
  if (samples.length < 300) return null

  // 依時間切開；中間空出 horizon 天，避免訓練集最後幾筆的答案和測試集重疊
  const split = Math.floor(samples.length * TRAIN_RATIO)
  const trainSet = samples.slice(0, split - horizon)
  const testSet = samples.slice(split)

  const scaler = standardize(trainSet.map((s) => s.row))
  const model = train(trainSet.map((s) => scaler.apply(s.row)), trainSet.map((s) => s.label))

  const trainUpRate = trainSet.reduce((sum, s) => sum + s.label, 0) / trainSet.length
  const majority = trainUpRate >= 0.5 ? 1 : 0
  let correct = 0
  let baselineCorrect = 0
  for (const sample of testSet) {
    const guess = model.predict(scaler.apply(sample.row)) >= 0.5 ? 1 : 0
    if (guess === sample.label) correct += 1
    if (majority === sample.label) baselineCorrect += 1
  }

  const allScaler = standardize(samples.map((s) => s.row))
  const finalModel = train(samples.map((s) => allScaler.apply(s.row)), samples.map((s) => s.label))
  const todayRow = rowAt(closes.length - 1)

  return {
    accuracy: (correct / testSet.length) * 100,
    // 基準至少 50%：測試期間漲跌比例和訓練期間不同時，「猜多數」可能低於 50%，
    // 這時準確率 50% 的模型看起來贏過基準，其實只是丟銅板
    baselineAccuracy: Math.max((baselineCorrect / testSet.length) * 100, 50),
    testUpRate: (testSet.reduce((sum, s) => sum + s.label, 0) / testSet.length) * 100,
    trainSamples: trainSet.length,
    testSamples: testSet.length,
    testFrom: series.dates[testSet[0].i],
    testTo: series.dates[testSet[testSet.length - 1].i],
    probability: todayRow ? finalModel.predict(allScaler.apply(todayRow)) * 100 : null,
    // 標準化後的權重可以互相比較：正值代表這個特徵越大越偏向上漲
    factors: features
      .map((feature, j) => ({
        key: feature.key,
        label: feature.label,
        weight: round(finalModel.weights[j], 3),
        // 今天這個特徵把機率往哪邊推（標準化後的值 × 權重）
        contribution: todayRow ? round(allScaler.apply(todayRow)[j] * finalModel.weights[j], 3) : null,
      }))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)),
  }
}

// series：computeSeries 的結果。context：{ label, series } 大盤序列（可省略）。
// 資料不足（樣本太少）時回傳 null
function predictDirection(series, { horizon = HORIZON, context = null } = {}) {
  const base = evaluate(series, FEATURES, { horizon })
  if (!base) return null

  let result = base
  let withoutMarket = null
  if (context?.series) {
    const aligned = alignDates(series.dates, context.series.dates)
    const withContext = evaluate(series, [...FEATURES, ...contextFeatures(context.label)], {
      horizon,
      context: context.series,
      aligned,
    })
    if (withContext) {
      result = withContext
      withoutMarket = round(base.accuracy, 1)
    }
  }

  const edge = result.accuracy - result.baselineAccuracy
  return {
    model: '邏輯迴歸',
    horizon,
    probabilityUp: result.probability === null ? null : round(result.probability, 1),
    testAccuracy: round(result.accuracy, 1),
    baselineAccuracy: round(result.baselineAccuracy, 1),
    edge: round(edge, 1),
    testUpRate: round(result.testUpRate, 1),
    trainSamples: result.trainSamples,
    testSamples: result.testSamples,
    testFrom: result.testFrom,
    testTo: result.testTo,
    reliable: edge >= MIN_EDGE && result.testSamples >= MIN_TEST_SAMPLES,
    // 有加大盤特徵時：大盤的名稱，以及不加大盤時的準確率（比較大盤特徵有沒有幫助）
    marketContext: withoutMarket === null ? null : { label: context.label, accuracyWithoutMarket: withoutMarket },
    factors: result.factors,
  }
}

module.exports = { FEATURES, HORIZON, MIN_EDGE, predictDirection, train, standardize, alignDates }
