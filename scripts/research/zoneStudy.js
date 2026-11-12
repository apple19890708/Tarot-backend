// 研究二：好幾種價位疊在同一區（0.5 倍 ATR 內）會不會比較守得住？依成員的種類分組看守住率。
// 事件與對照組的定義和 levelStudy.js 相同。用法：node scripts/research/zoneStudy.js <日K目錄>
const { loadAll, pivots, table } = require('./lib')
const { candidates, outcomeFrom, WINDOW, TOUCH } = require('./levelStudy')

// 價位的「家族」：同一家族疊在一起不算多一個依據（例如 60 日與 120 日的成交密集區）
function family(type) {
  if (type.startsWith('成交')) return '量'
  if (type === '未回補缺口') return '缺口'
  if (type.startsWith('MA')) return type === 'MA5' || type === 'MA10' ? null : '均線'
  if (type.endsWith('日高低') || type === '上月高低' || type === '上週高低') return '極值'
  if (type.startsWith('突破後') || type.startsWith('跌破後')) return type.endsWith('k5') ? '換手' : null
  if (type.startsWith('波段')) return type.endsWith('k5') ? '波段' : null
  if (type === '整數關卡') return '整數'
  return null
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
    const cache = { pivots: { 3: pivots(s, 3), 5: pivots(s, 5), 10: pivots(s, 10) } }
    for (let u = 251; u < s.closes.length - WINDOW; u += 1) {
      const t = u - 1
      const close = s.closes[t]
      const atr = s.atr14[t]
      if (!atr) continue
      const list = candidates(item, t, cache).map((l) => ({ ...l, family: family(l.type) })).filter((l) => l.family)
      for (const side of [1, -1]) {
        const sideName = side > 0 ? '支撐' : '壓力'
        const reach = side > 0 ? (close - s.lows[u]) / atr : (s.highs[u] - close) / atr
        for (let d = 0.3; d < 1.5; d += 0.1) {
          if (reach >= d - TOUCH) bump(`${sideName}|（對照組）`, outcomeFrom(s, u, close - side * d * atr, atr, side))
        }
        // 由近到遠，把 0.5 倍 ATR 內的價位併成一區；只看最近的一區
        const ahead = list
          .map((l) => ({ ...l, d: ((close - l.price) / atr) * side }))
          .filter((l) => l.d >= 0.25 && l.d < 1.5)
          .sort((a, b) => a.d - b.d)
        if (!ahead.length) continue
        const zone = ahead.filter((l) => l.d - ahead[0].d <= 0.5)
        if (reach < ahead[0].d - TOUCH) continue
        const families = [...new Set(zone.map((l) => l.family))].sort()
        // 區的代表價位：最近的那一個（最先被碰到）
        const result = outcomeFrom(s, u, ahead[0].price, atr, side)
        bump(`${sideName}|家族數 ${Math.min(families.length, 4)}${families.length >= 4 ? '+' : ''}`, result)
        bump(`${sideName}|${families.includes('量') ? '含成交密集' : '不含成交密集'}`, result)
        bump(`${sideName}|${families.includes('極值') ? '含近期高低點' : '不含近期高低點'}`, result)
        if (families.length === 1) bump(`${sideName}|只有：${families[0]}`, result)
        if (families.includes('量') && !families.includes('極值')) bump(`${sideName}|含量、不含極值`, result)
        if (families.includes('極值') && !families.includes('量')) bump(`${sideName}|含極值、不含量`, result)
        if (families.includes('量') && families.includes('均線')) bump(`${sideName}|量＋均線`, result)
        if (families.includes('量') && families.includes('換手')) bump(`${sideName}|量＋換手`, result)
      }
    }
  }
  for (const sideName of ['支撐', '壓力']) {
    const base = stats.get(`${sideName}|（對照組）`)
    const baseRate = (base.hold / (base.hold + base.brk)) * 100
    console.log(`\n== ${sideName}（最近一區，0.25～1.5 倍 ATR；對照組 ${baseRate.toFixed(1)}%）==`)
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
