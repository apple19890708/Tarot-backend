// 分析 walkForward.js 的輸出：操作建議、各類依據、原始特徵，之後 10／20 天實際怎麼走。
// 用法：node scripts/research/analyzeWf.js <wf.jsonl>
const fs = require('node:fs')
const { table } = require('./lib')

const rows = fs
  .readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
const mid = [...rows].map((r) => r.date).sort()[Math.floor(rows.length / 2)]

function summary(name, list) {
  const stat = (key, sub = list) => {
    const values = sub.map((r) => r[key]).filter((v) => v !== null)
    if (!values.length) return { up: '—', avg: '—' }
    return { up: ((values.filter((v) => v > 0).length / values.length) * 100).toFixed(1), avg: (values.reduce((s, v) => s + v, 0) / values.length).toFixed(2) }
  }
  const early = list.filter((r) => r.date < mid)
  const late = list.filter((r) => r.date >= mid)
  return {
    分組: name,
    次數: list.length,
    '10日漲%': stat('fwd10').up,
    '10日平均': stat('fwd10').avg,
    '20日漲%': stat('fwd20').up,
    '20日平均': stat('fwd20').avg,
    '前半20日': stat('fwd20', early).avg,
    '後半20日': stat('fwd20', late).avg,
  }
}
const COLS = ['分組', '次數', '10日漲%', '10日平均', '20日漲%', '20日平均', '前半20日', '後半20日']
const show = (title, groups) => {
  console.log(`\n== ${title} ==`)
  table(groups.filter(([, list]) => list.length > 0).map(([name, list]) => summary(name, list)), COLS)
}

show('全部（基準）', [['全部', rows], ['台股', rows.filter((r) => r.market === 'tw')], ['美股', rows.filter((r) => r.market === 'us')]])

show('操作建議的結論', [
  ...['bullish', 'neutral', 'bearish'].map((s) => [s, rows.filter((r) => r.stance === s)]),
  ...['bullish', 'bearish'].flatMap((s) => ['high', 'medium', 'low'].map((c) => [`${s}/${c}`, rows.filter((r) => r.stance === s && r.confidence === c)])),
])
show('分數', [
  ['<= -3', rows.filter((r) => r.score <= -3)],
  ['-3 ~ -2', rows.filter((r) => r.score > -3 && r.score <= -2)],
  ['-2 ~ 0', rows.filter((r) => r.score > -2 && r.score < 0)],
  ['0', rows.filter((r) => r.score === 0)],
  ['0 ~ 2', rows.filter((r) => r.score > 0 && r.score < 2)],
  ['2 ~ 3', rows.filter((r) => r.score >= 2 && r.score < 3)],
  ['>= 3', rows.filter((r) => r.score >= 3)],
])

// 各類依據：列入計分時，偏多／偏空之後的表現
const evidenceGroups = new Map()
for (const r of rows) {
  for (const [group, label, direction, counted] of r.evidence) {
    if (!counted && group !== '大盤') continue
    if (direction === 0) continue
    let key = group
    if (group === '技術面') key = label.includes('排列') ? '技術面：均線排列' : label.includes('月線') ? '技術面：月線' : '技術面：季線'
    if (group === '歷史回測') key = `回測：${label.split(' ')[0]}`
    const name = `${key} ${direction > 0 ? '偏多' : '偏空'}`
    if (!evidenceGroups.has(name)) evidenceGroups.set(name, [])
    evidenceGroups.get(name).push(r)
  }
}
show('各類依據（列入計分的）', [...evidenceGroups.entries()].sort((a, b) => a[0].localeCompare(b[0])))

// 回測訊號的結論（全部訊號，不只列入的）
const verdictGroups = new Map()
for (const r of rows) {
  for (const v of r.verdicts) {
    const name = `${v.reason}${v.dir > 0 ? ' 偏漲' : v.dir < 0 ? ' 偏跌' : ''}`
    if (!verdictGroups.has(name)) verdictGroups.set(name, [])
    verdictGroups.get(name).push(r)
  }
}
show('回測訊號的結論（每個訊號一筆）', [...verdictGroups.entries()].sort((a, b) => a[0].localeCompare(b[0])))

// 策略：最好的技術策略（不含買進持有）現在持有／空手；有沒有贏買進持有、穩不穩
const strat = { '最佳策略持有中': [], '最佳策略空手': [], '贏買進持有＋持有中': [], '贏買進持有＋空手': [], '穩定＋持有中': [], '穩定＋空手': [] }
for (const r of rows) {
  if (!r.strategies) continue
  const buyHold = r.strategies.find((s) => s.key === 'buyHold')
  const best = r.strategies.filter((s) => s.key !== 'buyHold').sort((a, b) => b.ret - a.ret)[0]
  strat[best.holding ? '最佳策略持有中' : '最佳策略空手'].push(r)
  if (best.ret > buyHold.ret) strat[best.holding ? '贏買進持有＋持有中' : '贏買進持有＋空手'].push(r)
  if (best.robust) strat[best.holding ? '穩定＋持有中' : '穩定＋空手'].push(r)
}
show('策略依據', Object.entries(strat))

show('機器學習', [
  ['可靠', rows.filter((r) => r.ml?.reliable)],
  ['可靠且機率 >= 55', rows.filter((r) => r.ml?.reliable && r.ml.p >= 55)],
  ['可靠且機率 <= 45', rows.filter((r) => r.ml?.reliable && r.ml.p <= 45)],
  ['不可靠且機率 >= 55', rows.filter((r) => r.ml && !r.ml.reliable && r.ml.p >= 55)],
  ['不可靠且機率 <= 45', rows.filter((r) => r.ml && !r.ml.reliable && r.ml.p <= 45)],
])

// 原始特徵分五等份
function quintiles(key, label) {
  const valid = rows.filter((r) => r.f[key] !== null && r.f[key] !== undefined)
  const sorted = [...valid].sort((a, b) => a.f[key] - b.f[key])
  const groups = []
  for (let q = 0; q < 5; q += 1) {
    const part = sorted.slice(Math.floor((q * sorted.length) / 5), Math.floor(((q + 1) * sorted.length) / 5))
    groups.push([`${label} Q${q + 1}（${part[0].f[key]} ~ ${part[part.length - 1].f[key]}）`, part])
  }
  show(`特徵：${label}`, groups)
}
quintiles('ret20', '近 20 日漲跌')
quintiles('ret60', '近 60 日漲跌')
quintiles('ret120', '近 120 日漲跌')
quintiles('ret250', '近 250 日漲跌')
quintiles('distMa60', '離季線')
quintiles('distMa240', '離年線')
quintiles('ma60Slope', '季線斜率')
quintiles('fromHigh250', '離一年高點')
quintiles('rsi', 'RSI')
quintiles('atrPct', '波動（ATR%）')
quintiles('mktRet20', '大盤近 20 日')
show('大盤在季線', [['之上', rows.filter((r) => r.f.mktAboveMa60 > 0)], ['之下', rows.filter((r) => r.f.mktAboveMa60 < 0)]])
show('個股在年線', [['之上', rows.filter((r) => r.f.distMa240 !== null && r.f.distMa240 >= 0)], ['之下', rows.filter((r) => r.f.distMa240 !== null && r.f.distMa240 < 0)]])
