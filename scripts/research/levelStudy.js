// 研究一：哪一種「支撐／壓力」在歷史上真的比較守得住？
// 作法：每隔 2 個交易日取樣，算出各種候選價位（只用當天以前的資料）。之後 20 天內價格第一次碰到這個價位時：
//   守住＝之後 10 天內，收盤先離開價位 1 倍 ATR（支撐是往上、壓力是往下）
//   失守＝收盤先穿過價位 1 倍 ATR
// 對照組是「同樣距離、但沒有任何意義的價位」（現價 ± 固定倍數的 ATR）。比對照組高，才代表這種價位有用。
// 用法：node scripts/research/levelStudy.js <日K目錄>
const { loadAll, pivots, rolling, volumeNodes, gaps, roundStep, table } = require('./lib')

const HORIZON = 20
const WINDOW = 10
const TOUCH = 0.1
const MOVE = 1
const BUCKETS = [
  { name: '0.25~1', min: 0.25, max: 1, synthetic: 0.6 },
  { name: '1~2', min: 1, max: 2, synthetic: 1.5 },
  { name: '2~3.5', min: 2, max: 3.5, synthetic: 2.75 },
]

// side：1 支撐（價位在現價下方）、-1 壓力
function outcome(series, t, level, atr, side) {
  const { highs, lows, closes } = series
  const end = Math.min(closes.length - 1, t + HORIZON)
  for (let u = t + 1; u <= end; u += 1) {
    const touched = side > 0 ? lows[u] <= level + TOUCH * atr : highs[u] >= level - TOUCH * atr
    if (!touched) continue
    for (let v = u; v <= Math.min(closes.length - 1, u + WINDOW); v += 1) {
      const diff = ((closes[v] - level) / atr) * side
      if (diff <= -MOVE) return { result: 'break', u }
      if (diff >= MOVE) return { result: 'hold', u }
    }
    return { result: 'none', u }
  }
  return null
}

function weekOf(date) {
  const t = Date.parse(`${date}T00:00:00Z`)
  return Math.floor((t / 86400000 + 3) / 7)
}

// 第 t 天的候選價位：[{ type, price }]，支撐與壓力都放在一起，之後依位置分
function candidates(item, t, cache) {
  const s = item.series
  const close = s.closes[t]
  const atr = s.atr14[t]
  const list = []
  const add = (type, price) => {
    if (Number.isFinite(price) && price > 0) list.push({ type, price })
  }
  for (const n of [5, 10, 20, 60, 120, 240]) add(`MA${n}`, s[`ma${n}`][t])
  for (const n of [20, 60, 120, 240]) {
    add(`${n}日高低`, rolling(s.highs, t, n, Math.max))
    add(`${n}日高低`, rolling(s.lows, t, n, Math.min))
  }
  // 上一週、上個月的高低
  const week = weekOf(s.dates[t])
  let i = t
  while (i >= 0 && weekOf(s.dates[i]) === week) i -= 1
  if (i >= 0) {
    const w = weekOf(s.dates[i])
    let hi = -Infinity
    let lo = Infinity
    for (; i >= 0 && weekOf(s.dates[i]) === w; i -= 1) {
      hi = Math.max(hi, s.highs[i])
      lo = Math.min(lo, s.lows[i])
    }
    add('上週高低', hi)
    add('上週高低', lo)
  }
  const month = s.dates[t].slice(0, 7)
  i = t
  while (i >= 0 && s.dates[i].slice(0, 7) === month) i -= 1
  if (i >= 0) {
    const m = s.dates[i].slice(0, 7)
    let hi = -Infinity
    let lo = Infinity
    for (; i >= 0 && s.dates[i].slice(0, 7) === m; i -= 1) {
      hi = Math.max(hi, s.highs[i])
      lo = Math.min(lo, s.lows[i])
    }
    add('上月高低', hi)
    add('上月高低', lo)
  }

  // 轉折點：k = 3、5、10；近 250 天、已確認
  for (const k of [3, 5, 10]) {
    const { highs, lows } = cache.pivots[k]
    const recentHighs = highs.filter((p) => p.index <= t - k && p.index >= t - 250)
    const recentLows = lows.filter((p) => p.index <= t - k && p.index >= t - 250)
    // 同向：下方的波段低點當支撐、上方的波段高點當壓力
    for (const p of recentLows) if (p.price < close) add(`波段低點k${k}`, p.price)
    for (const p of recentHighs) if (p.price > close) add(`波段高點k${k}`, p.price)
    // 換手：被突破的高點變支撐、被跌破的低點變壓力
    for (const p of recentHighs) if (p.price < close) add(`突破後的前高k${k}`, p.price)
    for (const p of recentLows) if (p.price > close) add(`跌破後的前低k${k}`, p.price)
    if (k === 5) {
      // 轉折點群聚：0.5 倍 ATR 內有 3 個以上（不分高低點）
      const all = [...recentHighs, ...recentLows].map((p) => p.price).sort((a, b) => a - b)
      for (let a = 0; a < all.length; a += 1) {
        let b = a
        while (b + 1 < all.length && all[b + 1] - all[a] <= atr * 0.5) b += 1
        const count = b - a + 1
        if (count >= 2) {
          const mid = all.slice(a, b + 1).reduce((sum, v) => sum + v, 0) / count
          add(count >= 3 ? '轉折群聚3+' : '轉折群聚2', mid)
          a = b
        }
      }
    }
  }
  for (const n of [60, 120, 250]) {
    const nodes = volumeNodes(s, t, n, atr)
    nodes.forEach((node, rank) => add(rank === 0 ? `成交最密集${n}` : `成交密集${n}`, node.price))
  }
  for (const gap of gaps(s, t, 120, atr)) add('未回補缺口', gap.price)
  const step = roundStep(close)
  add('整數關卡', Math.floor(close / step) * step)
  add('整數關卡', Math.ceil(close / step) * step)
  return list
}

// 事件：第 u 天「第一次碰到」價位（前一天收盤還離價位 0.25 倍 ATR 以上）。價位用 u-1 天收盤前的資料算。
// 對照組：同一天、同樣的接近幅度，但價位是「前一天收盤 ± 固定倍數 ATR」這種沒有意義的位置。
// 這樣每個（標的、日期、類型）只有一個事件，不會重複計算，也不會因為取樣方式偏向某種走勢。
function outcomeFrom(series, u, level, atr, side) {
  const { closes } = series
  for (let v = u; v <= Math.min(closes.length - 1, u + WINDOW); v += 1) {
    const diff = ((closes[v] - level) / atr) * side
    if (diff <= -MOVE) return 'break'
    if (diff >= MOVE) return 'hold'
  }
  return 'none'
}

const APPROACH = [
  { name: '小跌碰到(0.25~0.75)', min: 0.25, max: 0.75 },
  { name: '中(0.75~1.5)', min: 0.75, max: 1.5 },
  { name: '急(1.5~3)', min: 1.5, max: 3 },
]
const GRID = []
for (let d = 0.3; d < 3; d += 0.1) GRID.push(d)

function main() {
  const items = loadAll(process.argv[2])
  const only = process.argv[3] || null
  const stats = new Map()
  const bump = (key, result, half) => {
    const row = stats.get(key) ?? { hold: 0, brk: 0, none: 0, h: [0, 0], b: [0, 0] }
    if (result === 'hold') {
      row.hold += 1
      row.h[half] += 1
    } else if (result === 'break') {
      row.brk += 1
      row.b[half] += 1
    } else row.none += 1
    stats.set(key, row)
  }

  for (const item of items) {
    if (only && item.market !== only) continue
    const s = item.series
    const cache = { pivots: { 3: pivots(s, 3), 5: pivots(s, 5), 10: pivots(s, 10) } }
    const mid = Math.floor((251 + s.closes.length) / 2)
    for (let u = 251; u < s.closes.length - WINDOW; u += 1) {
      const t = u - 1
      const close = s.closes[t]
      const atr = s.atr14[t]
      if (!atr) continue
      const half = u < mid ? 0 : 1
      const list = candidates(item, t, cache)
      for (const side of [1, -1]) {
        const sideName = side > 0 ? '支撐' : '壓力'
        const reach = side > 0 ? (close - s.lows[u]) / atr : (s.highs[u] - close) / atr
        const touched = (d) => reach >= d - TOUCH
        for (const d of GRID) {
          if (!touched(d)) continue
          const bucket = APPROACH.find((b) => d >= b.min && d < b.max)
          if (bucket) bump(`${sideName}|${bucket.name}|（對照組）`, outcomeFrom(s, u, close - side * d * atr, atr, side), half)
        }
        // 每一種只取最近的一個（就是今天第一個會碰到的）
        const nearest = new Map()
        for (const level of list) {
          const d = ((close - level.price) / atr) * side
          if (d < 0.25 || d >= 3) continue
          const kept = nearest.get(level.type)
          if (!kept || d < kept.d) nearest.set(level.type, { d, price: level.price })
        }
        for (const [type, level] of nearest) {
          if (!touched(level.d)) continue
          const bucket = APPROACH.find((b) => level.d >= b.min && level.d < b.max)
          bump(`${sideName}|${bucket.name}|${type}`, outcomeFrom(s, u, level.price, atr, side), half)
          bump(`${sideName}|全部|${type}`, outcomeFrom(s, u, level.price, atr, side), half)
        }
      }
    }
  }

  for (const sideName of ['支撐', '壓力']) {
    for (const bucket of APPROACH) {
      const prefix = `${sideName}|${bucket.name}|`
      const base = stats.get(`${prefix}（對照組）`)
      const baseRate = (base.hold / (base.hold + base.brk)) * 100
      const baseHalf = [0, 1].map((h) => (base.h[h] / (base.h[h] + base.b[h])) * 100)
      console.log(`\n== ${sideName}，${bucket.name} 倍 ATR（對照組守住 ${baseRate.toFixed(1)}%）==`)
      const rows = [...stats.entries()]
        .filter(([key]) => key.startsWith(prefix) && !key.endsWith('（對照組）'))
        .map(([key, r]) => {
          const decided = r.hold + r.brk
          const rate = decided ? (r.hold / decided) * 100 : 0
          // 對照組的事件很多（同一天多個格點），誤差主要來自這一種價位自己的次數
          const se = Math.sqrt((rate * (100 - rate)) / Math.max(1, decided))
          const halfDiff = [0, 1].map((h) => ((r.h[h] / Math.max(1, r.h[h] + r.b[h])) * 100 - baseHalf[h]).toFixed(1))
          return { 類型: key.slice(prefix.length), 次數: decided, 守住率: rate.toFixed(1), 比對照: (rate - baseRate).toFixed(1), z: ((rate - baseRate) / se).toFixed(1), 前半: halfDiff[0], 後半: halfDiff[1] }
        })
        .filter((row) => row.次數 >= 100)
        .sort((a, b) => b.比對照 - a.比對照)
      table(rows, ['類型', '次數', '守住率', '比對照', 'z', '前半', '後半'])
    }
  }
}

if (require.main === module) main()

module.exports = { candidates, outcomeFrom, WINDOW, TOUCH }
