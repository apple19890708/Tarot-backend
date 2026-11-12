// 研究三：出場點（停損）放多遠比較好？
// 每 5 個交易日假設以收盤買進，抱 20 個交易日；期間碰到出場點就出場。比較各種出場點規則：
//   出場率、被洗出場（出場後第 20 天其實高於買進價）、有幫到（第 20 天比出場價更低）、平均報酬、最差 5% 的報酬
// 兩種執行方式：盤中碰到就出（跳空以開盤價）、收盤跌破才出（以當天收盤價）。
// 用法：node scripts/research/stopStudy.js <日K目錄>
const { loadAll, volumeNodes, table } = require('./lib')
const { pointAt } = require('../../src/services/market/series')
const { keyLevels } = require('../../src/services/market/signals')

const HOLD = 20

function simulate(s, t, stop, mode) {
  const entry = s.closes[t]
  for (let i = t + 1; i <= t + HOLD; i += 1) {
    if (mode === 'intraday' && s.lows[i] <= stop) {
      const exit = Math.min(stop, s.opens[i])
      return { stopped: true, ret: (exit / entry - 1) * 100, exit }
    }
    if (mode === 'close' && s.closes[i] < stop) return { stopped: true, ret: (s.closes[i] / entry - 1) * 100, exit: s.closes[i] }
  }
  return { stopped: false, ret: (s.closes[t + HOLD] / entry - 1) * 100, exit: null }
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

const RULES = {
  不設出場點: () => 0,
  '1 倍 ATR': ({ close, atr }) => close - atr,
  '1.5 倍 ATR': ({ close, atr }) => close - 1.5 * atr,
  '2 倍 ATR': ({ close, atr }) => close - 2 * atr,
  '2.5 倍 ATR': ({ close, atr }) => close - 2.5 * atr,
  '3 倍 ATR': ({ close, atr }) => close - 3 * atr,
  '最近的支撐（最早的規則）': ({ close, supports, atr }) => supports[0]?.price ?? close - 2 * atr,
  '現行規則（太近就換）': ({ close, supports, atr }) => {
    const nearest = supports[0]
    if (!nearest) return Math.max(close - 2 * atr, close * 0.9)
    if (close - nearest.price >= atr) return nearest.price
    const next = supports.find((l) => close - l.price >= atr)
    const atrStop = close - 2 * atr
    const alt = next && next.price >= atrStop ? next.price : atrStop
    return (close - alt) / close <= 0.1 ? alt : nearest.price
  },
  '成交密集區下緣（1～3 倍 ATR 內，再讓 0.5 倍；沒有就 2 倍 ATR）': ({ close, atr, nodes }) => {
    const node = nodes.filter((n) => close - n.price >= atr && close - n.price <= 3 * atr).sort((a, b) => b.price - a.price)[0]
    return node ? node.price - 0.5 * atr : close - 2 * atr
  },
  '2 倍 ATR，範圍內有成交密集區就放在它下面 0.5 倍': ({ close, atr, nodes }) => {
    const node = nodes.filter((n) => close - n.price >= 1.5 * atr && close - n.price <= 2.5 * atr).sort((a, b) => b.price - a.price)[0]
    return node ? node.price - 0.5 * atr : close - 2 * atr
  },
}

function main() {
  const items = loadAll(process.argv[2])
  for (const filter of ['全部', '多頭排列時買', '空頭排列時買']) {
    for (const mode of ['intraday', 'close']) {
      const results = Object.fromEntries(Object.keys(RULES).map((name) => [name, []]))
      for (const item of items) {
        const s = item.series
        for (let t = 250; t < s.closes.length - HOLD; t += 5) {
          const close = s.closes[t]
          const atr = s.atr14[t]
          if (!atr) continue
          const bull = s.ma5[t] > s.ma20[t] && s.ma20[t] > s.ma60[t]
          const bear = s.ma5[t] < s.ma20[t] && s.ma20[t] < s.ma60[t]
          if ((filter === '多頭排列時買' && !bull) || (filter === '空頭排列時買' && !bear)) continue
          const { supports } = keyLevels(Math.round(close * 100) / 100, pointAt(s, t))
          const nodes = volumeNodes(s, t, 120, atr)
          const final = (s.closes[t + HOLD] / close - 1) * 100
          for (const [name, rule] of Object.entries(RULES)) {
            const stop = rule({ close, atr, supports, nodes })
            const sim = simulate(s, t, stop, mode)
            results[name].push({ ...sim, final, distance: ((close - stop) / atr) })
          }
        }
      }
      console.log(`\n== ${filter}｜${mode === 'intraday' ? '盤中碰到就出場' : '收盤跌破才出場'}（n=${results['不設出場點'].length}）==`)
      const rows = Object.entries(results).map(([name, list]) => {
        const stopped = list.filter((r) => r.stopped)
        const whipsaw = stopped.filter((r) => r.final > 0).length
        const helped = stopped.filter((r) => r.final < r.ret).length
        const rets = list.map((r) => r.ret).sort((a, b) => a - b)
        const avg = rets.reduce((sum, r) => sum + r, 0) / rets.length
        const distances = list.map((r) => r.distance).filter((d) => d < 50).sort((a, b) => a - b)
        return {
          規則: name,
          '距離中位(ATR)': name === '不設出場點' ? '—' : percentile(distances, 0.5).toFixed(2),
          '出場率%': ((stopped.length / list.length) * 100).toFixed(1),
          '被洗%': stopped.length ? ((whipsaw / stopped.length) * 100).toFixed(1) : '—',
          '有幫到%': stopped.length ? ((helped / stopped.length) * 100).toFixed(1) : '—',
          平均報酬: avg.toFixed(2),
          '最差5%': percentile(rets, 0.05).toFixed(1),
          '最差1%': percentile(rets, 0.01).toFixed(1),
        }
      })
      table(rows, ['規則', '距離中位(ATR)', '出場率%', '被洗%', '有幫到%', '平均報酬', '最差5%', '最差1%'])
    }
  }
}

main()
