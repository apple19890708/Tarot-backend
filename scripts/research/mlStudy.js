// 研究五：機器學習模型（邏輯迴歸）在樣本外到底準不準？
// 線上只切一次（前 80% 訓練、後 20% 測試）。這裡用滾動驗證：每 120 個交易日重新訓練一次，只預測之後的 120 天，
// 把所有樣本外預測合起來看，樣本多很多。對照組：一律猜漲、以及「訓練期間多數那一邊」。
// 用法：node scripts/research/mlStudy.js <日K目錄>
const { loadAll, table } = require('./lib')
const { FEATURES, train, standardize, alignDates } = require('../../src/services/market/prediction')

const BLOCK = 120
const FIRST_TRAIN = 400

function contextFeatures() {
  return [
    { key: 'mktRet5', get: (s, i, c, j) => (j >= 5 ? c.closes[j] / c.closes[j - 5] - 1 : NaN) },
    { key: 'mktDistMa20', get: (s, i, c, j) => (c.ma20[j] ? c.closes[j] / c.ma20[j] - 1 : NaN) },
  ]
}

const EXTRA = [
  { key: 'ret60', get: (s, i) => (i >= 60 ? s.closes[i] / s.closes[i - 60] - 1 : NaN) },
  { key: 'atrPct', get: (s, i) => s.atr14[i] / s.closes[i] },
  { key: 'fromHigh60', get: (s, i) => s.closes[i] / s.high60[i] - 1 },
]

function run(items, index, { horizon, features, useContext, l2Scale = 1 }) {
  const out = []
  for (const item of items) {
    const s = item.series
    const ctx = index[item.market].series
    const aligned = alignDates(s.dates, ctx.dates)
    const feats = useContext ? [...features, ...contextFeatures()] : features
    const samples = []
    for (let i = 60; i < s.closes.length - horizon; i += 1) {
      const row = feats.map((f) => f.get(s, i, ctx, aligned[i]))
      if (row.every(Number.isFinite)) samples.push({ i, row, label: s.closes[i + horizon] > s.closes[i] ? 1 : 0 })
    }
    for (let start = FIRST_TRAIN; start < samples.length; start += BLOCK) {
      const trainSet = samples.slice(0, start - horizon)
      const testSet = samples.slice(start, start + BLOCK)
      const scaler = standardize(trainSet.map((x) => x.row))
      const model = train(trainSet.map((x) => scaler.apply(x.row)), trainSet.map((x) => x.label))
      const upRate = trainSet.reduce((sum, x) => sum + x.label, 0) / trainSet.length
      for (const sample of testSet) {
        out.push({ p: model.predict(scaler.apply(sample.row)), label: sample.label, majority: upRate >= 0.5 ? 1 : 0, symbol: item.symbol })
      }
    }
  }
  return out
}

function summarize(name, preds, horizon) {
  const n = preds.length
  const acc = preds.filter((x) => (x.p >= 0.5 ? 1 : 0) === x.label).length / n
  const up = preds.filter((x) => x.label === 1).length / n
  const maj = preds.filter((x) => x.majority === x.label).length / n
  const bucket = (lo, hi) => {
    const list = preds.filter((x) => x.p >= lo && x.p < hi)
    return list.length ? `${((list.filter((x) => x.label === 1).length / list.length) * 100).toFixed(1)}(${list.length})` : '—'
  }
  // 相鄰樣本的答案重疊，獨立樣本數約是 n ÷ 天數
  const se = Math.sqrt((acc * (1 - acc)) / (n / horizon)) * 100
  // 每一檔各自有沒有贏過「猜多數」
  const bySymbol = new Map()
  for (const x of preds) {
    const row = bySymbol.get(x.symbol) ?? { ok: 0, maj: 0, n: 0 }
    row.n += 1
    if ((x.p >= 0.5 ? 1 : 0) === x.label) row.ok += 1
    if (x.majority === x.label) row.maj += 1
    bySymbol.set(x.symbol, row)
  }
  const wins = [...bySymbol.values()].filter((r) => r.ok > r.maj).length
  return {
    模型: name,
    樣本: n,
    '準確率%': (acc * 100).toFixed(1),
    '猜多數%': (maj * 100).toFixed(1),
    '一律猜漲%': (up * 100).toFixed(1),
    '±誤差': se.toFixed(1),
    贏過猜多數的檔數: `${wins}/${bySymbol.size}`,
    'p<40 實際漲%': bucket(0, 0.4),
    'p40-50': bucket(0.4, 0.5),
    'p50-60': bucket(0.5, 0.6),
    'p60-70': bucket(0.6, 0.7),
    'p>=70': bucket(0.7, 1.01),
  }
}

function main() {
  const all = loadAll(process.argv[2], { includeIndex: true })
  const index = { tw: all.find((i) => i.symbol === '^TWII'), us: all.find((i) => i.symbol === '^GSPC') }
  const items = all.filter((i) => !i.symbol.startsWith('^'))
  const rows = []
  for (const horizon of [5, 10, 20]) {
    rows.push(summarize(`現行特徵＋大盤，${horizon} 日`, run(items, index, { horizon, features: FEATURES, useContext: true }), horizon))
    rows.push(summarize(`現行特徵（不加大盤），${horizon} 日`, run(items, index, { horizon, features: FEATURES, useContext: false }), horizon))
  }
  rows.push(summarize('多加 3 個特徵（60 日漲跌、波動、離 60 日高點），5 日', run(items, index, { horizon: 5, features: [...FEATURES, ...EXTRA], useContext: true }), 5))
  const few = FEATURES.filter((f) => ['ret5', 'ret20', 'distMa60', 'rsi'].includes(f.key))
  rows.push(summarize('只留 4 個特徵，5 日', run(items, index, { horizon: 5, features: few, useContext: false }), 5))
  rows.push(summarize('只留 4 個特徵，20 日', run(items, index, { horizon: 20, features: few, useContext: false }), 20))
  table(rows, Object.keys(rows[0]))
}

main()
