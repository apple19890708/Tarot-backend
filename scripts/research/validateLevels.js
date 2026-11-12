// 驗證新的支撐壓力（signals.keyLevels，規則版本 4）：和舊規則（MA5/20/60＋近 20/60 日高低，取最近的）比，
// 選出來的價位被碰到之後守住的比例。事件與對照組的定義同 levelStudy.js。
// 用法：node scripts/research/validateLevels.js <日K目錄>
const { loadAll, table } = require('./lib')
const { outcomeFrom, WINDOW, TOUCH } = require('./levelStudy')
const { computeIndicators } = require('../../src/services/market/indicators')
const { keyLevels } = require('../../src/services/market/signals')

// 舊規則（規則版本 3 以前）
function legacyLevels(price, ind) {
  const candidates = [
    { price: ind.ma5, label: 'MA5' },
    { price: ind.ma20, label: 'MA20' },
    { price: ind.ma60, label: 'MA60' },
    { price: ind.high20, label: '近 20 日高點' },
    { price: ind.low20, label: '近 20 日低點' },
    { price: ind.high60, label: '近 60 日高點' },
    { price: ind.low60, label: '近 60 日低點' },
  ].filter((l) => l.price !== null && l.price !== price)
  const pick = (levels) => {
    const result = []
    for (const level of levels) {
      const near = result.find((kept) => Math.abs(kept.price - level.price) / level.price <= 0.003)
      if (!near && result.length < 3) result.push({ ...level })
    }
    return result
  }
  return {
    supports: pick(candidates.filter((l) => l.price < price).sort((a, b) => b.price - a.price)),
    resistances: pick(candidates.filter((l) => l.price > price).sort((a, b) => a.price - b.price)),
  }
}

function main() {
  const items = loadAll(process.argv[2])
  const stats = new Map()
  const bump = (key, result) => {
    const row = stats.get(key) ?? { hold: 0, brk: 0 }
    if (result === 'hold') row.hold += 1
    else if (result === 'break') row.brk += 1
    stats.set(key, row)
  }
  for (const item of items) {
    const s = item.series
    for (let u = 301; u < s.closes.length - WINDOW; u += 1) {
      const t = u - 1
      const close = Math.round(s.closes[t] * 100) / 100
      const ind = computeIndicators(item.bars.slice(t - 299, t + 1))
      const atr = ind.atr14
      if (!atr) continue
      const engines = { 舊規則: legacyLevels(close, ind), 新規則: keyLevels(close, ind) }
      for (const side of [1, -1]) {
        const sideName = side > 0 ? '支撐' : '壓力'
        const reach = side > 0 ? (close - s.lows[u]) / atr : (s.highs[u] - close) / atr
        for (let d = 0.3; d < 3; d += 0.1) {
          if (reach >= d - TOUCH) bump(`${sideName}|（對照組）`, outcomeFrom(s, u, close - side * d * atr, atr, side))
        }
        for (const [name, levels] of Object.entries(engines)) {
          const list = (side > 0 ? levels.supports : levels.resistances).filter((l) => Math.abs(close - l.price) / atr >= 0.25)
          list.forEach((level, rank) => {
            const d = Math.abs(close - level.price) / atr
            if (d >= 3 || reach < d - TOUCH) return
            const result = outcomeFrom(s, u, level.price, atr, side)
            if (rank === 0) bump(`${sideName}|${name}：最近的一個`, result)
            bump(`${sideName}|${name}：全部列出的`, result)
            if (level.strength) bump(`${sideName}|${name}：標示「${level.strength}」`, result)
          })
        }
      }
    }
  }
  for (const sideName of ['支撐', '壓力']) {
    const base = stats.get(`${sideName}|（對照組）`)
    const baseRate = (base.hold / (base.hold + base.brk)) * 100
    console.log(`\n== ${sideName}（對照組 ${baseRate.toFixed(1)}%）==`)
    const rows = [...stats.entries()]
      .filter(([key]) => key.startsWith(`${sideName}|`) && !key.endsWith('（對照組）'))
      .map(([key, r]) => {
        const n = r.hold + r.brk
        const rate = (r.hold / n) * 100
        return { 分組: key.split('|')[1], 次數: n, 守住率: rate.toFixed(1), 比對照: (rate - baseRate).toFixed(1), z: ((rate - baseRate) / Math.sqrt((rate * (100 - rate)) / n)).toFixed(1) }
      })
      .sort((a, b) => a.分組.localeCompare(b.分組))
    table(rows, ['分組', '次數', '守住率', '比對照', 'z'])
  }
}

main()
