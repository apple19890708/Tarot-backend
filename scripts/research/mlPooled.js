// 研究五之二：把所有股票的資料合起來訓練一個模型（樣本多 50 倍），樣本外有沒有比較準？
// 依日期滾動：每半年重新訓練，只預測之後半年。用法：node scripts/research/mlPooled.js <日K目錄>
const { loadAll, table } = require('./lib')
const { FEATURES, train, standardize, alignDates } = require('../../src/services/market/prediction')

const EXTRA = [
  { key: 'ret60', get: (s, i) => (i >= 60 ? s.closes[i] / s.closes[i - 60] - 1 : NaN) },
  { key: 'atrPct', get: (s, i) => s.atr14[i] / s.closes[i] },
  { key: 'fromHigh60', get: (s, i) => s.closes[i] / s.high60[i] - 1 },
  { key: 'mktRet5', get: (s, i, c, j) => (j >= 5 ? c.closes[j] / c.closes[j - 5] - 1 : NaN) },
  { key: 'mktRet20', get: (s, i, c, j) => (j >= 20 ? c.closes[j] / c.closes[j - 20] - 1 : NaN) },
  { key: 'mktDistMa60', get: (s, i, c, j) => (c.ma60[j] ? c.closes[j] / c.ma60[j] - 1 : NaN) },
]

function main() {
  const all = loadAll(process.argv[2], { includeIndex: true })
  const index = { tw: all.find((i) => i.symbol === '^TWII'), us: all.find((i) => i.symbol === '^GSPC') }
  const items = all.filter((i) => !i.symbol.startsWith('^'))
  const feats = [...FEATURES, ...EXTRA]
  const rows = []
  for (const horizon of [5, 20]) {
    const samples = []
    for (const item of items) {
      const s = item.series
      const ctx = index[item.market].series
      const aligned = alignDates(s.dates, ctx.dates)
      for (let i = 60; i < s.closes.length - horizon; i += 1) {
        const row = feats.map((f) => f.get(s, i, ctx, aligned[i]))
        // 答案揭曉的日期：訓練時只能用「答案已經知道」的樣本
        if (row.every(Number.isFinite)) samples.push({ date: s.dates[i], known: s.dates[i + horizon], row, label: s.closes[i + horizon] > s.closes[i] ? 1 : 0 })
      }
    }
    const cuts = ['2023-07-01', '2024-01-01', '2024-07-01', '2025-01-01', '2025-07-01', '2026-01-01', '2026-07-01', '2027-01-01']
    const preds = []
    for (let c = 0; c < cuts.length - 1; c += 1) {
      const trainSet = samples.filter((x) => x.known < cuts[c])
      const testSet = samples.filter((x) => x.date >= cuts[c] && x.date < cuts[c + 1])
      if (!testSet.length) continue
      // 抽樣訓練（每 3 筆取 1 筆）：相鄰樣本幾乎一樣，全用只是慢
      const sub = trainSet.filter((_, k) => k % 3 === 0)
      const scaler = standardize(sub.map((x) => x.row))
      const model = train(sub.map((x) => scaler.apply(x.row)), sub.map((x) => x.label))
      const upRate = sub.reduce((sum, x) => sum + x.label, 0) / sub.length
      for (const x of testSet) preds.push({ p: model.predict(scaler.apply(x.row)), label: x.label, majority: upRate >= 0.5 ? 1 : 0 })
      if (c === cuts.length - 2 || c === 3) {
        console.log(`${horizon} 日，${cuts[c]} 的權重：`, feats.map((f, j) => `${f.key} ${model.weights[j].toFixed(3)}`).join('、'))
      }
    }
    const n = preds.length
    const bucket = (lo, hi) => {
      const list = preds.filter((x) => x.p >= lo && x.p < hi)
      return list.length ? `${((list.filter((x) => x.label === 1).length / list.length) * 100).toFixed(1)}(${list.length})` : '—'
    }
    rows.push({
      模型: `合併訓練，${horizon} 日`,
      樣本: n,
      '準確率%': ((preds.filter((x) => (x.p >= 0.5 ? 1 : 0) === x.label).length / n) * 100).toFixed(1),
      '猜多數%': ((preds.filter((x) => x.majority === x.label).length / n) * 100).toFixed(1),
      '一律猜漲%': ((preds.filter((x) => x.label === 1).length / n) * 100).toFixed(1),
      'p<45 實際漲%': bucket(0, 0.45),
      'p45-50': bucket(0.45, 0.5),
      'p50-55': bucket(0.5, 0.55),
      'p55-60': bucket(0.55, 0.6),
      'p>=60': bucket(0.6, 1.01),
    })
  }
  table(rows, Object.keys(rows[0]))
}

main()
