// 操作建議：把技術面、歷史回測、策略狀態、機器學習整理成一份固定規則算出來的建議。
// 不靠 AI 臨場判斷——同一份資料每次得到同一個結論，畫面和 AI 分析都以這份為準。
// 文字在這裡產生，前端只負責排版與上色。
const { round } = require('./indicators')

// 訊號的歷史勝率至少要比基準高（或低）這麼多個百分點才算數
const EDGE_THRESHOLD = 5
// 沒有近期支撐時，停損用固定比例
const FALLBACK_STOP_PCT = 7

function fmt(value) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

// ---- 證據：每一項都有方向（+1 偏多、-1 偏空、0 中性）與權重 ----

function trendEvidence(signals) {
  const evidence = []
  const find = (key) => signals.find((signal) => signal.key === key)
  const trend = find('trend')
  if (trend) {
    const direction = trend.value === '多頭排列' ? 1 : trend.value === '空頭排列' ? -1 : 0
    // 「均線糾結」本身已含均線兩字
    const label = trend.value.startsWith('均線') ? trend.value : `均線${trend.value}`
    evidence.push({ group: '技術面', label, direction, weight: 2 })
  }
  for (const key of ['ma20', 'ma60']) {
    const signal = find(key)
    if (signal) {
      evidence.push({
        group: '技術面',
        label: `${signal.value}${signal.label}`,
        direction: signal.value === '站上' ? 1 : -1,
        weight: 1,
      })
    }
  }
  return evidence
}

// 訊號本身不直接決定方向，看它在這檔股票過去之後真的偏漲還是偏跌（10 日）
function backtestEvidence(backtest) {
  if (!backtest) return []
  const base = backtest.baseline.find((b) => b.days === 10)?.winRate
  if (base === null || base === undefined) return []
  return backtest.signals
    .filter((signal) => signal.key !== 'trend' && signal.key !== 'ma20' && signal.key !== 'ma60')
    .map((signal) => {
      const stat = signal.horizons.find((h) => h.days === 10)
      if (!signal.sufficient || stat?.winRate === null || stat?.winRate === undefined) {
        return {
          group: '歷史回測',
          label: `${signal.label} ${signal.value}`,
          detail: `過去只出現 ${signal.occurrences} 次，樣本太少不計入`,
          direction: 0,
          weight: 0,
        }
      }
      if (signal.consistent === false) {
        const { early, late } = signal.periods
        return {
          group: '歷史回測',
          label: `${signal.label} ${signal.value}`,
          detail: `前期 10 日上漲 ${early.winRate}%（當時平常 ${early.baseline}%）、後期 ${late.winRate}%（當時平常 ${late.baseline}%），前後方向相反，不計入`,
          direction: 0,
          weight: 0,
        }
      }
      const edge = stat.winRate - base
      const direction = edge >= EDGE_THRESHOLD ? 1 : edge <= -EDGE_THRESHOLD ? -1 : 0
      const verdict = direction === 1 ? '之後偏漲' : direction === -1 ? '之後偏跌' : '和平常差不多，沒有優勢'
      return {
        group: '歷史回測',
        label: `${signal.label} ${signal.value}`,
        detail: `過去 ${signal.occurrences} 次，10 日上漲 ${stat.winRate}%（平常 ${base}%），${verdict}`,
        direction,
        weight: 1,
      }
    })
}

// 過去表現最好的技術策略（不含買進持有）現在是持有還是空手
function strategyEvidence(strategies) {
  if (!strategies) return []
  const buyHold = strategies.strategies.find((s) => s.key === 'buyHold')
  const best = strategies.strategies
    .filter((s) => s.key !== 'buyHold' && s.totalReturn !== null)
    .sort((a, b) => b.totalReturn - a.totalReturn)[0]
  if (!best) return []
  const beatBuyHold = buyHold && best.totalReturn > buyHold.totalReturn
  const robustText = best.robust ? '；前後兩段都贏過同期的買進持有，表現穩定' : '；分段驗證沒有兩段都贏過買進持有'
  return [
    {
      group: '策略',
      label: `${best.label}策略${best.holdingNow ? '持有中' : '目前空手'}`,
      detail: `這是近 ${strategies.years} 年表現最好的技術策略（${best.totalReturn > 0 ? '+' : ''}${best.totalReturn}%）${
        beatBuyHold ? '，而且贏過買進持有' : `，但輸給買進持有（${buyHold.totalReturn > 0 ? '+' : ''}${buyHold.totalReturn}%）`
      }${robustText}`,
      direction: best.holdingNow ? 1 : -1,
      // 分段驗證都贏過買進持有的策略最值得參考
      weight: best.robust ? 1.5 : 1,
    },
  ]
}

// 籌碼：外資、投信的買賣超方向；融資與股價背離。上櫃只有最新一日，權重減半
function chipsEvidence(chips) {
  const summary = chips?.summary
  if (!summary) return []
  const weight = chips.latestOnly ? 0.5 : 1
  const evidence = []
  for (const key of ['foreign', 'trust']) {
    const part = summary[key]
    if (part && part.total !== 0) {
      evidence.push({ group: '籌碼', label: part.text, direction: Math.sign(part.total), weight })
    }
  }
  if (summary.margin) {
    evidence.push({
      group: '籌碼',
      label: summary.margin.text,
      direction: summary.margin.direction,
      weight: summary.margin.direction === 0 ? 0 : weight,
      detail: summary.margin.direction === 0 ? '融資變化不大或和股價同向，不列入' : null,
    })
  }
  return evidence
}

function predictionEvidence(prediction) {
  if (!prediction || prediction.probabilityUp === null) return []
  if (!prediction.reliable) {
    return [
      {
        group: '機器學習',
        label: `模型預測上漲機率 ${prediction.probabilityUp}%`,
        detail: `樣本外準確率 ${prediction.testAccuracy}% 沒有贏過基準 ${prediction.baselineAccuracy}%，不計入`,
        direction: 0,
        weight: 0,
      },
    ]
  }
  const p = prediction.probabilityUp
  const direction = p >= 55 ? 1 : p <= 45 ? -1 : 0
  return [
    {
      group: '機器學習',
      label: `模型預測上漲機率 ${p}%`,
      detail: `樣本外準確率 ${prediction.testAccuracy}%，比基準高 ${prediction.edge} 個百分點`,
      direction,
      weight: 1,
    },
  ]
}

// ---- 價位 ----

function pickLevels(price, analysis, indicators) {
  const supports = analysis?.supports ?? []
  const resistances = analysis?.resistances ?? []

  const stopLoss = supports[0]
    ? { price: supports[0].price, label: `跌破${supports[0].label}` }
    : { price: round(price * (1 - FALLBACK_STOP_PCT / 100)), label: `近期沒有支撐，用 −${FALLBACK_STOP_PCT}% 當停損` }

  // 目標：上方前兩個壓力；沒有壓力（創新高）時用近 20 日波動幅度往上估
  let targets = resistances.slice(0, 2).map((level) => ({ price: level.price, label: level.label }))
  if (targets.length === 0 && indicators?.high20 && indicators?.low20) {
    const range = indicators.high20 - indicators.low20
    targets = [{ price: round(price + range / 2), label: '上方沒有壓力，以近 20 日波動的一半估算' }]
  }

  const reward = targets[0] ? targets[0].price - price : null
  const risk = price - stopLoss.price
  const riskReward = reward !== null && risk > 0 ? round(reward / risk, 2) : null

  return { stopLoss, targets, riskReward, nearestSupport: supports[0] ?? null, nearestResistance: resistances[0] ?? null }
}

// ---- 主程式 ----

// item：marketService 的單一標的快照（需要 quote、analysis、indicators、research）
function buildAdvice(item) {
  if (!item?.analysis || !item.indicators) {
    return null
  }
  const price = item.quote.price
  const evidence = [
    ...trendEvidence(item.analysis.signals),
    ...backtestEvidence(item.research?.backtest),
    ...strategyEvidence(item.research?.strategies),
    ...chipsEvidence(item.chips),
    ...predictionEvidence(item.research?.prediction),
  ]

  const counted = evidence.filter((e) => e.weight > 0)
  const score = counted.reduce((sum, e) => sum + e.direction * e.weight, 0)
  const totalWeight = counted.reduce((sum, e) => sum + e.weight, 0)
  // 一致度：有方向的證據裡，同一邊的比例
  const agreement = totalWeight > 0 ? Math.abs(score) / totalWeight : 0

  const stance = score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : 'neutral'
  const confidence =
    stance === 'neutral' ? 'low' : agreement >= 0.6 ? 'high' : agreement >= 0.35 ? 'medium' : 'low'

  const levels = pickLevels(price, item.analysis, item.indicators)
  const { stopLoss, targets, nearestSupport, nearestResistance } = levels
  // 風險報酬比是「現在買進」的算法，偏空時不建議買進，算出來只會誤導
  const riskReward = stance === 'bearish' ? null : levels.riskReward
  const t1 = targets[0]
  const supportText = nearestSupport ? `${fmt(nearestSupport.price)}（${nearestSupport.label}）` : null
  const resistanceText = nearestResistance ? `${fmt(nearestResistance.price)}（${nearestResistance.label}）` : null

  let forNew
  let forHolders
  if (stance === 'bullish') {
    forNew = supportText
      ? `可以分批布局，第一筆不追高，等拉回 ${supportText} 附近再加；跌破 ${fmt(stopLoss.price)} 停損。`
      : `可以小量試單，跌破 ${fmt(stopLoss.price)} 停損。`
    forHolders = t1
      ? `續抱，到 ${fmt(t1.price)}（${t1.label}）附近先賣一部分鎖住獲利；停損上移到 ${fmt(stopLoss.price)}。`
      : `續抱，停損設在 ${fmt(stopLoss.price)}。`
  } else if (stance === 'bearish') {
    forNew = resistanceText
      ? `先不要進場。等重新站回 ${resistanceText} 之上、訊號轉強再評估。`
      : '先不要進場，等訊號轉強再評估。'
    forHolders = resistanceText
      ? `反彈到 ${resistanceText} 附近減碼；跌破 ${fmt(stopLoss.price)} 就出場，不要攤平。`
      : `跌破 ${fmt(stopLoss.price)} 就出場，不要攤平。`
  } else {
    forNew =
      supportText && resistanceText
        ? `方向不明，先觀望。要操作就做區間：靠近 ${supportText} 小量買、接近 ${resistanceText} 賣；帶量突破 ${fmt(nearestResistance.price)} 才追。`
        : '方向不明，先觀望，等訊號一致再進場。'
    forHolders = `部位不要再加。跌破 ${fmt(stopLoss.price)} 減碼或出場${resistanceText ? `，站上 ${resistanceText} 再考慮加碼` : ''}。`
  }

  const POSITION_SIZES = {
    bullish: { high: '正常部位，分 2～3 次進場', medium: '半個部位', low: '小部位試單' },
    bearish: { high: '空手為主；持有者降到三成以下', medium: '持有者降到一半', low: '持有者先減碼一部分' },
    neutral: { high: '小部位或空手', medium: '小部位或空手', low: '小部位或空手' },
  }
  const positionSize = POSITION_SIZES[stance][confidence]

  const risks = []
  const rsi = item.analysis.signals.find((s) => s.key === 'rsi')
  if (rsi?.value === '過熱') risks.push('RSI 過熱，短線容易拉回，不要追高。')
  if (rsi?.value === '超賣') risks.push('RSI 超賣，短線可能反彈，空方不要追殺。')
  if (riskReward !== null && riskReward < 1) {
    risks.push(`到第一目標的空間小於停損的距離（風險報酬比 ${riskReward}），現在進場不划算。`)
  }
  if (item.research?.prediction && !item.research.prediction.reliable) {
    risks.push('機器學習模型在這檔標的沒有贏過基準，預測機率不列入判斷。')
  }
  if (evidence.some((e) => e.group === '歷史回測' && e.weight === 0 && e.detail?.includes('樣本太少'))) {
    risks.push('部分訊號過去出現次數太少，沒有列入判斷。')
  }
  if (item.valuation?.summary?.expensive) {
    risks.push(`估值偏貴：本益比 ${item.valuation.pe} 倍，高於 ${item.valuation.pePercentile}% 的上市櫃公司，追高的風險大。`)
  }
  if (item.valuation && item.valuation.pe === null) risks.push('沒有本益比（近四季虧損或資料缺），基本面要另外確認。')
  if (evidence.some((e) => e.group === '歷史回測' && e.detail?.includes('前後方向相反'))) {
    risks.push('部分訊號前後期表現方向相反，可能只是剛好適合過去，沒有列入判斷。')
  }
  if (item.session === 'intraday') risks.push('目前是盤中資料，收盤前訊號可能改變。')

  const STANCE_LABELS = { bullish: '偏多', bearish: '偏空', neutral: '觀望' }
  const CONFIDENCE_LABELS = { high: '高', medium: '中', low: '低' }
  const bull = counted.filter((e) => e.direction > 0).length
  const bear = counted.filter((e) => e.direction < 0).length

  return {
    stance,
    stanceLabel: STANCE_LABELS[stance],
    confidence,
    confidenceLabel: CONFIDENCE_LABELS[confidence],
    score: round(score, 1),
    summary: `${counted.length} 項列入判斷的依據中，${bull} 項偏多、${bear} 項偏空，綜合判斷${STANCE_LABELS[stance]}（信心${CONFIDENCE_LABELS[confidence]}）。`,
    horizon: '5～20 個交易日',
    evidence: evidence.map(({ group, label, detail, direction, weight }) => ({
      group,
      label,
      detail: detail || null,
      direction,
      counted: weight > 0,
    })),
    // 偏空時，上方價位是「反彈減碼點」、停損是「持有者出場點」，不是做多的目標與停損
    levels: {
      stopLoss,
      stopLossLabel: stance === 'bearish' ? '持有者出場點' : '停損',
      targets,
      targetsLabel: stance === 'bearish' ? '反彈減碼點' : '目標價',
      riskReward,
    },
    forNew,
    forHolders,
    positionSize,
    risks,
  }
}

module.exports = { buildAdvice, EDGE_THRESHOLD }
