// 研究六：用歷史重算的資料（walkForward.js 的輸出）試幾種計分方式，看偏多／偏空之後實際怎麼走。
// 候選只用常見、門檻是整數的長趨勢因子（年線、離一年高點、均線排列），並分前後兩段、台美股檢查，避免只是湊數字。
// 用法：node scripts/research/scoreStudy.js <wf.jsonl>
const fs = require('node:fs')
const { table } = require('./lib')

const rows = fs.readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
const mid = [...rows].map((r) => r.date).sort()[Math.floor(rows.length / 2)]

const yearLine = (r) => (r.f.distMa240 === null ? 0 : r.f.distMa240 >= 0 ? 1 : -1)
const nearHigh = (r) => (r.f.fromHigh250 >= -8 ? 1 : r.f.fromHigh250 <= -20 ? -1 : 0)
const trend = (r) => (r.signals.trend === '多頭排列' ? 1 : r.signals.trend === '空頭排列' ? -1 : 0)
const ma60 = (r) => (r.signals.ma60 === '站上' ? 1 : -1)

// 現行規則裡列入計分的回測訊號、策略依據（各 1 分；策略穩定的 1.5 分在這裡當 1 分）
const groupScore = (r, group) => r.evidence.filter((e) => e[0] === group && e[3] === 1).reduce((sum, e) => sum + e[2], 0)
const longTrend = (r) => yearLine(r) + nearHigh(r) + trend(r) * 0.5

const SCHEMES = {
  '長趨勢＋回測訊號（各 1 分）': (r) => longTrend(r) + groupScore(r, '歷史回測'),
  '長趨勢＋回測訊號（各 0.5 分）': (r) => longTrend(r) + groupScore(r, '歷史回測') * 0.5,
  '長趨勢＋策略（1 分）': (r) => longTrend(r) + groupScore(r, '策略'),
  '長趨勢＋回測＋策略（各 0.5 分）': (r) => longTrend(r) + (groupScore(r, '歷史回測') + groupScore(r, '策略')) * 0.5,
  '現行規則（版本 3，不含籌碼）': (r) => r.score,
  '年線＋離一年高點': (r) => yearLine(r) + nearHigh(r),
  '年線＋離一年高點＋均線排列×0.5': (r) => yearLine(r) + nearHigh(r) + trend(r) * 0.5,
  '年線＋離一年高點＋均線排列': (r) => yearLine(r) + nearHigh(r) + trend(r),
  '年線＋離一年高點＋季線': (r) => yearLine(r) + nearHigh(r) + ma60(r),
  '只看年線×2': (r) => yearLine(r) * 2,
}

function stat(list, key) {
  const values = list.map((r) => r[key]).filter((v) => v !== null)
  if (!values.length) return { up: '—', avg: '—' }
  return { up: ((values.filter((v) => v > 0).length / values.length) * 100).toFixed(1), avg: (values.reduce((s, v) => s + v, 0) / values.length).toFixed(2) }
}

for (const [name, score] of Object.entries(SCHEMES)) {
  console.log(`\n== ${name} ==`)
  const out = []
  for (const [label, test] of [['偏多（>= 2）', (s) => s >= 2], ['中間', (s) => s > -2 && s < 2], ['偏空（<= -2）', (s) => s <= -2]]) {
    const list = rows.filter((r) => test(score(r)))
    const part = (filter) => stat(list.filter(filter), 'fwd10').up
    out.push({
      結論: label,
      次數: list.length,
      '10日漲%': stat(list, 'fwd10').up,
      '10日平均': stat(list, 'fwd10').avg,
      '20日漲%': stat(list, 'fwd20').up,
      '20日平均': stat(list, 'fwd20').avg,
      '前半10日漲%': part((r) => r.date < mid),
      '後半10日漲%': part((r) => r.date >= mid),
      '台股10日漲%': part((r) => r.market === 'tw'),
      '美股10日漲%': part((r) => r.market === 'us'),
    })
  }
  table(out, Object.keys(out[0]))
}
