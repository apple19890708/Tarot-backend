// 研究四：把操作建議放回過去重算（walk-forward）。每隔 STEP 個交易日，只用當天以前的日 K 重算
// 技術判讀、訊號回測、策略回測、機器學習、操作建議，再記下之後 5／10／20 天的實際報酬。
// 籌碼與估值沒有歷史資料，不在這裡面（線上的建議會多這兩類依據）。
// 用法：node scripts/research/walkForward.js <日K目錄> <輸出.jsonl> [STEP] [--no-ml]
// --no-ml：不訓練機器學習模型（最花時間；規則版本 4 起不計分，驗證計分時可以跳過）
const fs = require('node:fs')
const { loadAll } = require('./lib')
const { computeIndicators } = require('../../src/services/market/indicators')
const { buildSignals } = require('../../src/services/market/signals')
const { computeSeries } = require('../../src/services/market/series')
const { backtestSignals, backtestStrategies } = require('../../src/services/market/backtest')
const { predictDirection } = require('../../src/services/market/prediction')
const { buildAdvice } = require('../../src/services/market/advice')

const START = 500
const round = (v, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null)

function main() {
  const noMl = process.argv.includes('--no-ml')
  const [dir, out, stepArg] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
  const step = Number(stepArg) || 10
  const all = loadAll(dir, { includeIndex: true })
  const index = { tw: all.find((i) => i.symbol === '^TWII'), us: all.find((i) => i.symbol === '^GSPC') }
  const stream = fs.createWriteStream(out)
  const started = Date.now()
  for (const item of all) {
    if (item.symbol.startsWith('^')) continue
    const { bars } = item
    const full = item.series
    const ctx = index[item.market]
    for (let t = START; t < bars.length - 20; t += step) {
      const slice = bars.slice(0, t + 1)
      const price = round(slice[t].close)
      const indicators = computeIndicators(slice)
      const analysis = buildSignals({ price, indicators })
      const series = computeSeries(slice)
      const date = slice[t].date
      const ctxBars = ctx.bars.filter((bar) => bar.date <= date)
      const context = { label: item.market === 'tw' ? '大盤' : '標普 500', series: computeSeries(ctxBars) }
      const research = {
        backtest: backtestSignals(series, analysis.signals),
        strategies: backtestStrategies(series, item.market, { etf: /^00/.test(item.symbol) }),
        prediction: noMl ? null : predictDirection(series, { context }),
      }
      const advice = buildAdvice({ quote: { price }, analysis, indicators, research, chips: null, valuation: null, session: 'closed' }, { context })
      const c = full.closes
      const fwd = (n) => round((c[t + n] / c[t] - 1) * 100)
      const back = (n) => (t - n >= 0 ? round((c[t] / c[t - n] - 1) * 100) : null)
      let high250 = -Infinity
      for (let i = Math.max(0, t - 249); i <= t; i += 1) high250 = Math.max(high250, full.highs[i])
      const cc = context.series.closes
      const cl = cc.length - 1
      const p = research.prediction
      stream.write(
        `${JSON.stringify({
          symbol: item.symbol,
          market: item.market,
          date,
          t,
          price,
          fwd5: fwd(5),
          fwd10: fwd(10),
          fwd20: fwd(20),
          stance: advice.stance,
          confidence: advice.confidence,
          score: advice.score,
          evidence: advice.evidence.map((e) => [e.group, e.label, e.direction, e.counted ? 1 : 0]),
          signals: Object.fromEntries(analysis.signals.map((sig) => [sig.key, sig.value])),
          verdicts: research.backtest.signals.map((sig) => ({ key: sig.key, value: sig.value, n: sig.occurrences, dir: sig.verdict.direction, reason: sig.verdict.reason, win10: sig.horizons[1].winRate })),
          base10: research.backtest.baseline[1].winRate,
          strategies: research.strategies?.strategies.map((st) => ({ key: st.key, ret: st.totalReturn, holding: st.holdingNow, robust: st.robust })) ?? null,
          ml: p ? { p: p.probabilityUp, reliable: p.reliable, acc: p.testAccuracy, base: p.baselineAccuracy } : null,
          f: {
            atrPct: round((indicators.atr14 / price) * 100),
            rsi: indicators.rsi14,
            ret5: back(5),
            ret20: back(20),
            ret60: back(60),
            ret120: back(120),
            ret250: back(250),
            distMa20: round((price / indicators.ma20 - 1) * 100),
            distMa60: round((price / indicators.ma60 - 1) * 100),
            distMa120: full.ma120[t] ? round((price / full.ma120[t] - 1) * 100) : null,
            distMa240: full.ma240[t] ? round((price / full.ma240[t] - 1) * 100) : null,
            ma60Slope: series.ma60[t - 20] ? round((series.ma60[t] / series.ma60[t - 20] - 1) * 100) : null,
            fromHigh250: round((price / high250 - 1) * 100),
            volRatio: indicators.volumeRatio,
            mktAboveMa60: context.series.ma60[cl] ? (cc[cl] >= context.series.ma60[cl] ? 1 : -1) : 0,
            mktRet20: cl >= 20 ? round((cc[cl] / cc[cl - 20] - 1) * 100) : null,
          },
        })}\n`,
      )
    }
    console.log(item.symbol, `${Math.round((Date.now() - started) / 1000)}s`)
  }
  stream.end()
}

main()
