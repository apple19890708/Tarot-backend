// 回測：用這檔股票自己的歷史資料，驗證訊號與策略過去的表現。
// 全部是純函式，輸入 computeSeries 的結果。報酬一律以收盤價計，單位是 %。
const { round } = require('./indicators')
const { buildSignals } = require('./signals')
const { pointAt } = require('./series')

const HORIZONS = [5, 10, 20]
// 少於這個次數的統計標示樣本不足
const MIN_SAMPLES = 5

// 分段驗證：前 60% 當「樣本內」、後 40% 當「樣本外」。只在前段有效、後段失靈的訊號或策略，多半只是剛好適合過去
const SPLIT_RATIO = 0.6
// 前後兩段各至少要有這麼多次，才判斷一致性
const MIN_SPLIT_SAMPLES = 3
// 策略的停損版本：收盤跌破進場價這麼多 % 就出場
const STOP_LOSS_PCT = 8

// 交易成本（一買一賣合計，%）：台股手續費 0.1425% × 2 ＋ 證交稅 0.3%；美股券商多半免手續費，只算一點滑價
const ROUND_TRIP_COST = { tw: 0.585, us: 0.05 }

function stats(returns) {
  if (returns.length === 0) {
    return { count: 0, winRate: null, avgReturn: null, medianReturn: null, worst: null, best: null }
  }
  const sorted = [...returns].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  return {
    count: returns.length,
    winRate: round((returns.filter((r) => r > 0).length / returns.length) * 100, 1),
    avgReturn: round(returns.reduce((sum, r) => sum + r, 0) / returns.length),
    medianReturn: round(median),
    worst: round(sorted[0]),
    best: round(sorted[sorted.length - 1]),
  }
}

function forwardReturn(closes, i, days) {
  return i + days < closes.length ? (closes[i + days] / closes[i] - 1) * 100 : null
}

// 每一天亮了哪些訊號：[{ key: value }]
function signalTimeline(series) {
  return series.closes.map((close, i) => {
    const result = buildSignals({ price: close, indicators: pointAt(series, i) })
    const map = {}
    for (const signal of result?.signals || []) {
      // 量能的「盤中」字樣只出現在最後一天，回測一律用收盤的說法
      map[signal.key] = signal.value
    }
    return map
  })
}

// 目前亮著的訊號，過去在這檔股票「首次出現」（前一天不是這個狀態）之後的表現。
// 只算首次出現，否則「空頭排列」這種一待好幾週的狀態會把同一段行情重複計算幾十次
function backtestSignals(series, currentSignals) {
  const timeline = signalTimeline(series)
  const { closes } = series

  const baseline = HORIZONS.map((days) => {
    const returns = []
    for (let i = 60; i < closes.length; i += 1) {
      const r = forwardReturn(closes, i, days)
      if (r !== null) returns.push(r)
    }
    const { winRate, avgReturn, count } = stats(returns)
    return { days, winRate, avgReturn, count }
  })

  const signals = currentSignals
    .filter((signal) => signal.key !== 'volume')
    .map((signal) => {
      const value = signal.value.replace('（盤中）', '')
      const events = []
      for (let i = 61; i < closes.length - 1; i += 1) {
        if (timeline[i][signal.key] === value && timeline[i - 1][signal.key] !== value) {
          events.push(i)
        }
      }
      const horizons = HORIZONS.map((days) => {
        const returns = events.map((i) => forwardReturn(closes, i, days)).filter((r) => r !== null)
        return { days, ...stats(returns) }
      })

      // 前後兩段各自的 10 日勝率，和各段自己的基準比；方向相反就是不穩定
      const splitIndex = Math.floor(60 + (closes.length - 60) * SPLIT_RATIO)
      const periodStats = (from, to) => {
        const returns = events
          .filter((i) => i >= from && i < to)
          .map((i) => forwardReturn(closes, i, 10))
          .filter((r) => r !== null)
        const baseReturns = []
        for (let i = from; i < to; i += 1) {
          const r = forwardReturn(closes, i, 10)
          if (r !== null) baseReturns.push(r)
        }
        const own = stats(returns)
        const base = stats(baseReturns)
        return { count: own.count, winRate: own.winRate, baseline: base.winRate }
      }
      const early = periodStats(60, splitIndex)
      const late = periodStats(splitIndex, closes.length)
      const edgeSign = (p) => (p.winRate === null || p.baseline === null ? 0 : Math.sign(p.winRate - p.baseline))
      const comparable = early.count >= MIN_SPLIT_SAMPLES && late.count >= MIN_SPLIT_SAMPLES
      return {
        key: signal.key,
        label: signal.label,
        value,
        occurrences: events.length,
        lastSeen: events.length > 0 ? series.dates[events[events.length - 1]] : null,
        sufficient: horizons[1].count >= MIN_SAMPLES,
        horizons,
        // 前段（樣本內）與後段（樣本外）的 10 日勝率；consistent 為 false 代表前後期方向相反
        periods: { early, late, splitDate: series.dates[splitIndex] },
        consistent: comparable ? edgeSign(early) === edgeSign(late) || edgeSign(early) === 0 || edgeSign(late) === 0 : null,
      }
    })

  return { horizons: HORIZONS, baseline, signals, minSamples: MIN_SAMPLES }
}

// ---- 策略回測 ----

// 每種策略回傳每一天收盤時「要不要持有」：true 持有、false 空手、null 維持前一天
const STRATEGIES = [
  {
    key: 'buyHold',
    label: '買進持有',
    description: '第一天買進後一直抱著',
    plain: '一開始買進，之後不管漲跌都不賣。',
    decide: () => true,
  },
  {
    key: 'maCross',
    label: '均線交叉',
    description: 'MA5 向上穿過 MA20 買進，向下穿過賣出',
    plain: '近 5 天的平均價漲過近 20 天的平均價就買，跌回下面就賣；也就是股價轉強時上車、轉弱時下車。',
    decide: (s, i) => {
      if ([s.ma5[i], s.ma20[i], s.ma5[i - 1], s.ma20[i - 1]].some((v) => v === null)) return null
      if (s.ma5[i - 1] <= s.ma20[i - 1] && s.ma5[i] > s.ma20[i]) return true
      if (s.ma5[i - 1] >= s.ma20[i - 1] && s.ma5[i] < s.ma20[i]) return false
      return null
    },
  },
  {
    key: 'kd',
    label: 'KD 交叉',
    description: 'K 在 30 以下黃金交叉買進，70 以上死亡交叉賣出',
    plain: '股價跌到近期的相對低點、開始往上彈時買；漲到相對高點、開始往下掉時賣。',
    decide: (s, i) => {
      if ([s.k[i], s.d[i], s.k[i - 1], s.d[i - 1]].some((v) => v === null)) return null
      if (s.k[i - 1] <= s.d[i - 1] && s.k[i] > s.d[i] && s.k[i] < 30) return true
      if (s.k[i - 1] >= s.d[i - 1] && s.k[i] < s.d[i] && s.k[i] > 70) return false
      return null
    },
  },
  {
    key: 'rsi',
    label: 'RSI 反轉',
    description: 'RSI 低於 30 買進，高於 70 賣出',
    plain: '短時間跌太多就買、漲太多就賣，賭它會反彈或拉回。',
    decide: (s, i) => {
      if (s.rsi14[i] === null) return null
      if (s.rsi14[i] < 30) return true
      if (s.rsi14[i] > 70) return false
      return null
    },
  },
  {
    key: 'macd',
    label: 'MACD 翻紅',
    description: 'MACD 柱體由負翻正買進，由正翻負賣出',
    plain: '上漲的力道由弱轉強時買，由強轉弱時賣。',
    decide: (s, i) => {
      if (s.macdHist[i] === null || s.macdHist[i - 1] === null) return null
      if (s.macdHist[i - 1] <= 0 && s.macdHist[i] > 0) return true
      if (s.macdHist[i - 1] >= 0 && s.macdHist[i] < 0) return false
      return null
    },
  },
]

// 收盤時決定，隔天起的報酬才算進去；進出各扣一半的來回成本
function runStrategy(series, strategy, { start, end = series.closes.length, cost, sampleEvery = 1, stopLossPct = null }) {
  const { closes, dates } = series
  let entryPrice = null
  let stops = 0
  let equity = 100
  let peak = 100
  let maxDrawdown = 0
  let holding = false
  let entryEquity = null
  let daysHeld = 0
  const trades = []
  const curve = []

  for (let i = start; i < end; i += 1) {
    if (holding && i > start) {
      equity *= closes[i] / closes[i - 1]
      daysHeld += 1
    }
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, (equity / peak - 1) * 100)

    // 停損優先於策略訊號：收盤跌破進場價一定比例就出場
    const stopped = holding && stopLossPct !== null && closes[i] <= entryPrice * (1 - stopLossPct / 100)
    const decision = stopped ? false : strategy.decide(series, i)
    if (decision === true && !holding) {
      holding = true
      equity *= 1 - cost / 200
      entryEquity = equity
      entryPrice = closes[i]
    } else if (decision === false && holding) {
      holding = false
      equity *= 1 - cost / 200
      trades.push((equity / entryEquity - 1) * 100)
      if (stopped) stops += 1
    }

    if ((i - start) % sampleEvery === 0 || i === end - 1) {
      curve.push({ date: dates[i], value: round(equity) })
    }
  }

  // 期末還抱著的那筆，以最後一天收盤計算（不扣賣出成本，因為還沒賣）
  if (holding && entryEquity !== null) {
    trades.push((equity / entryEquity - 1) * 100)
  }

  const days = end - start
  const years = days / 252
  const totalReturn = equity - 100
  return {
    key: strategy.key,
    label: strategy.label,
    description: strategy.description,
    plain: strategy.plain,
    totalReturn: round(totalReturn),
    annualReturn: years > 0 ? round(((equity / 100) ** (1 / years) - 1) * 100) : null,
    maxDrawdown: round(maxDrawdown),
    trades: trades.length,
    tradeWinRate: trades.length > 0 ? round((trades.filter((t) => t > 0).length / trades.length) * 100, 1) : null,
    exposure: days > 0 ? round((daysHeld / days) * 100, 1) : null,
    holdingNow: holding,
    stops,
    curve,
  }
}

// 只要報酬與回落，不要曲線（停損版本、分段驗證用）
function summaryOf(result) {
  return {
    totalReturn: result.totalReturn,
    maxDrawdown: result.maxDrawdown,
    trades: result.trades,
    tradeWinRate: result.tradeWinRate,
    stops: result.stops,
  }
}

function backtestStrategies(series, market) {
  // 前 60 天用來暖機（MA60 才算得出來）
  const start = 60
  if (series.closes.length - start < 120) {
    return null
  }
  const cost = ROUND_TRIP_COST[market] ?? ROUND_TRIP_COST.tw
  const sampleEvery = Math.max(1, Math.round((series.closes.length - start) / 150))
  const splitIndex = Math.floor(start + (series.closes.length - start) * SPLIT_RATIO)
  const buyHold = STRATEGIES[0]
  const early = (strategy) => runStrategy(series, strategy, { start, end: splitIndex, cost })
  const late = (strategy) => runStrategy(series, strategy, { start: splitIndex, cost })
  const buyHoldEarly = early(buyHold).totalReturn
  const buyHoldLate = late(buyHold).totalReturn

  return {
    from: series.dates[start],
    to: series.dates[series.dates.length - 1],
    splitDate: series.dates[splitIndex],
    years: round((series.closes.length - start) / 252, 1),
    roundTripCost: cost,
    stopLossPct: STOP_LOSS_PCT,
    strategies: STRATEGIES.map((strategy) => {
      const result = runStrategy(series, strategy, { start, cost, sampleEvery })
      const earlyResult = early(strategy)
      const lateResult = late(strategy)
      return {
        ...result,
        // 加上停損的版本（買進持有不適用）
        withStop:
          strategy.key === 'buyHold' ? null : summaryOf(runStrategy(series, strategy, { start, cost, stopLossPct: STOP_LOSS_PCT })),
        // 分段驗證：前段與後段各自的報酬，和同期間的買進持有比
        periods: {
          early: { ...summaryOf(earlyResult), buyHold: buyHoldEarly },
          late: { ...summaryOf(lateResult), buyHold: buyHoldLate },
        },
        // 前後兩段都贏過買進持有，才算穩定有效（買進持有本身不適用）
        robust:
          strategy.key === 'buyHold'
            ? null
            : earlyResult.totalReturn > buyHoldEarly && lateResult.totalReturn > buyHoldLate,
      }
    }),
  }
}

module.exports = { HORIZONS, MIN_SAMPLES, STOP_LOSS_PCT, backtestSignals, backtestStrategies, runStrategy, STRATEGIES, stats }
