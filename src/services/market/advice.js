// 操作建議：把技術面、歷史回測、策略狀態、機器學習整理成一份固定規則算出來的建議。
// 不靠 AI 臨場判斷——同一份資料每次得到同一個結論，畫面和 AI 分析都以這份為準。
// 文字在這裡產生，前端只負責排版與上色。
const { round } = require('./indicators')
const { valuationBasis } = require('./twseData')

// 規則版本：判斷方法改了就加一，命中率統計才能分開新舊規則的紀錄（tracking.js）
// 2：技術面三項合計上限 2 分、回測改用信賴區間、輸給買進持有的策略不列入、出場點跳過 1 倍 ATR 內的支撐、大盤方向調整信心
// 3：籌碼要佔成交量 1% 以上或連 3 天才計分；機器學習的「可以參考」改用信賴區間
// 4：依歷史重算的結果重訂計分（doc/v22-market-rules-research-plan.md）。55 檔、每 5 個交易日用當時的資料重算一次（7,765 次）：
//    版本 3 的偏多之後 10 天上漲 56.1%、偏空之後 56.4%，沒有分辨力。逐項看，只有長趨勢（年線、離一年高點）有：
//    新計分的偏多 57.5%、偏空 48.8%，前後兩段都成立（台股明顯、美股大型股沒有差別）。
//    所以：年線與離一年高點各 1 分、均線排列 0.5 分、回測訊號各 0.5 分；月線、季線、最佳策略、機器學習、大盤只列出不計分。
//    出場點改用 2 倍 ATR（收盤跌破），不再拿支撐當出場點；目標價至少離現價 1 倍 ATR
const RULE_VERSION = 4
// 離一年高點：不到這麼多 % 算接近高點（偏多）；低這麼多 % 以上算弱勢（偏空）
const NEAR_HIGH_PCT = 8
const FAR_FROM_HIGH_PCT = 20
// 回測訊號的權重：歷史重算裡「有優勢」的訊號之後並沒有比較準，加進來不好不壞，只給半分
const BACKTEST_WEIGHT = 0.5
// 只列出、不計分的說明（畫面的依據清單會顯示）
const NOT_SCORED = '歷史驗證：照它判斷方向沒有比較準，只列出來參考，不計分'
// 出場點（規則版本 4）：現價 − 這麼多倍 ATR，「收盤」跌破才算。不再拿支撐當出場點：
// 實測（doc/v22-market-rules-research-plan.md）用最近的支撐當出場點，20 天內 75% 會碰到、其中近一半之後是漲的；2 倍 ATR 收盤跌破是 36%、被洗 19%。
// 和策略回測的停損同一個倍數
const STOP_ATR_MULTIPLE = 2
// 出場點最遠離現價這麼多 %（波動極大時 2 倍 ATR 會遠到沒有意義）；碰到上限時另外提醒部位放小
const MAX_STOP_PCT = 10
// 沒有 ATR 時，停損用固定比例
const FALLBACK_STOP_PCT = 7
// 目標價／減碼點至少要離現價這麼多倍 ATR（更近的一天就會碰到，當目標沒有意義）
const MIN_TARGET_ATR = 1
// 上方沒有夠遠的壓力時，目標用現價 ＋ 這麼多倍 ATR 估
const FALLBACK_TARGET_ATR = 3
// 文字裡「等拉回到哪裡」「反彈到哪裡」用的支撐壓力，至少離現價這麼多倍 ATR
const MIN_REFERENCE_ATR = 0.5

function fmt(value) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

// ---- 證據：每一項都有方向（+1 偏多、-1 偏空、0 中性）與權重 ----

// 長期趨勢（規則版本 4）：年線位置、離一年高點。歷史重算裡唯一有分辨力的兩項。資料不到一年時沒有
function longTrendEvidence(price, indicators) {
  const evidence = []
  const year = indicators?.ma240 ?? null
  if (year !== null) {
    evidence.push({
      group: '長期趨勢',
      label: price >= year ? '股價在年線之上' : '股價在年線之下',
      detail: `年線（近 240 個交易日的平均價）${fmt(year)}`,
      direction: price >= year ? 1 : -1,
      weight: 1,
    })
  }
  const high = indicators?.high250 ?? null
  if (high !== null && high > 0) {
    const gap = round((1 - price / high) * 100, 1)
    const direction = gap <= NEAR_HIGH_PCT ? 1 : gap >= FAR_FROM_HIGH_PCT ? -1 : 0
    evidence.push({
      group: '長期趨勢',
      label: direction > 0 ? '接近一年高點' : direction < 0 ? '離一年高點很遠' : '離一年高點有一段距離',
      detail:
        `一年高點 ${fmt(high)}，現價低 ${Math.max(gap, 0)}%` +
        (direction > 0 ? `（${NEAR_HIGH_PCT}% 以內算強勢）` : direction < 0 ? `（${FAR_FROM_HIGH_PCT}% 以上算弱勢）` : `，介於 ${NEAR_HIGH_PCT}%～${FAR_FROM_HIGH_PCT}% 之間，不列入`),
      direction,
      weight: direction === 0 ? 0 : 1,
    })
  }
  return evidence
}

// 均線排列 0.5 分；站上／跌破月線、季線和排列講的是同一件事，歷史重算裡加進來反而比較不準，只列出不計分
function trendEvidence(signals) {
  const evidence = []
  const find = (key) => signals.find((signal) => signal.key === key)
  const trend = find('trend')
  if (trend) {
    const direction = trend.value === '多頭排列' ? 1 : trend.value === '空頭排列' ? -1 : 0
    // 「均線糾結」本身已含均線兩字
    const label = trend.value.startsWith('均線') ? trend.value : `均線${trend.value}`
    evidence.push({ group: '技術面', label, detail: direction === 0 ? '沒有方向，不列入' : null, direction, weight: direction === 0 ? 0 : 0.5 })
  }
  for (const key of ['ma20', 'ma60']) {
    const signal = find(key)
    if (signal) {
      evidence.push({
        group: '技術面',
        label: `${signal.value}${signal.label}`,
        detail: '和均線排列講的是同一件事，只列出來參考，不計分',
        direction: signal.value === '站上' ? 1 : -1,
        weight: 0,
      })
    }
  }
  return evidence
}

// 訊號本身不直接決定方向，看它在這檔股票過去之後真的偏漲還是偏跌（10 日）。
// 結論由 backtest.js 的 judgeSignal 算好（信賴區間），這裡只轉成依據與說明文字
function backtestEvidence(backtest) {
  if (!backtest) return []
  const base = (days) => backtest.baseline.find((b) => b.days === days)?.winRate
  return backtest.signals
    .filter((signal) => signal.key !== 'trend' && signal.key !== 'ma20' && signal.key !== 'ma60')
    .map((signal) => {
      const label = `${signal.label} ${signal.value}`
      const stat = signal.horizons.find((h) => h.days === 10)
      const verdict = signal.verdict
      if (!verdict || verdict.reason === 'few') {
        return { group: '歷史回測', label, detail: `過去只出現 ${signal.occurrences} 次，樣本太少不計入`, direction: 0, weight: 0 }
      }
      if (verdict.reason === 'inconsistent') {
        const { early, late } = signal.periods
        return {
          group: '歷史回測',
          label,
          detail: `前期 10 日上漲 ${early.winRate}%（當時平常 ${early.baseline}%）、後期 ${late.winRate}%（當時平常 ${late.baseline}%），前後方向相反，不計入`,
          direction: 0,
          weight: 0,
        }
      }
      const head = `過去 ${signal.occurrences} 次，10 日上漲 ${stat.winRate}%（平常 ${base(10)}%），合理範圍 ${verdict.interval.low}～${verdict.interval.high}%`
      const tail = {
        edge: verdict.direction > 0 ? '整個範圍都高於平常，之後偏漲' : '整個範圍都低於平常，之後偏跌',
        noEdge: '範圍包含平常的比例，看不出優勢',
        horizonConflict: '10 日看起來有差，但 5 日或 20 日方向相反，不算有優勢',
      }[verdict.reason]
      return { group: '歷史回測', label, detail: `${head}；${tail}`, direction: verdict.direction, weight: verdict.direction === 0 ? 0 : BACKTEST_WEIGHT }
    })
}

// 過去表現最好的技術策略（不含買進持有）現在是持有還是空手。
// 規則版本 4 起只列出不計分：歷史重算裡，最佳策略「持有中」之後 10 天上漲 54.2%、「空手」之後 56.4%，方向反而相反
function strategyEvidence(strategies) {
  if (!strategies) return []
  const buyHold = strategies.strategies.find((s) => s.key === 'buyHold')
  const best = strategies.strategies
    .filter((s) => s.key !== 'buyHold' && s.totalReturn !== null)
    .sort((a, b) => b.totalReturn - a.totalReturn)[0]
  if (!best) return []
  const pct = (value) => `${value > 0 ? '+' : ''}${value}%`
  const versus = !buyHold
    ? ''
    : best.totalReturn > buyHold.totalReturn
      ? `，贏過買進持有（${pct(buyHold.totalReturn)}）`
      : `，輸給買進持有（${pct(buyHold.totalReturn)}）`
  return [
    {
      group: '策略',
      label: `${best.label}策略${best.holdingNow ? '持有中' : '目前空手'}`,
      detail: `近 ${strategies.years} 年表現最好的技術策略（${pct(best.totalReturn)}）${versus}。${NOT_SCORED}`,
      direction: best.holdingNow ? 1 : -1,
      weight: 0,
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
      // 淨買賣超太小（佔同期成交量不到 CHIP_MIN_VOLUME_PCT）又沒有連續 CHIP_MIN_STREAK 天同方向，是雜訊不計分。
      // 沒有成交量資料（volumePct 為 null）時照舊計分
      const small = part.volumePct !== null && part.volumePct !== undefined && Math.abs(part.volumePct) < CHIP_MIN_VOLUME_PCT
      const noise = small && Math.abs(part.streak ?? 0) < CHIP_MIN_STREAK
      evidence.push({
        group: '籌碼',
        label: part.text,
        detail: noise
          ? `只佔同期成交量 ${Math.abs(part.volumePct)}%，也沒有連續 ${CHIP_MIN_STREAK} 天同方向，量太小不計入`
          : part.volumePct !== null && part.volumePct !== undefined
            ? `佔同期成交量 ${Math.abs(part.volumePct)}%`
            : null,
        direction: noise ? 0 : Math.sign(part.total),
        weight: noise ? 0 : weight,
      })
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

// 機器學習：規則版本 4 起只列出不計分。55 檔滾動驗證（4 萬多筆樣本外預測）準確率 51%，低於一律猜漲的 53%；
// 單一檔「樣本外有贏過基準」多半只是運氣（歷史重算裡標示可靠的 38 次，之後 10 天上漲 42%）
function predictionEvidence(prediction) {
  if (!prediction || prediction.probabilityUp === null) return []
  const p = prediction.probabilityUp
  return [
    {
      group: '機器學習',
      label: `模型預測上漲機率 ${p}%`,
      detail: `樣本外準確率 ${prediction.testAccuracy}%（基準 ${prediction.baselineAccuracy}%）。${NOT_SCORED}`,
      direction: p >= 55 ? 1 : p <= 45 ? -1 : 0,
      weight: 0,
    },
  ]
}

// ---- 價位 ----

function pickLevels(price, analysis, indicators) {
  const supports = analysis?.supports ?? []
  const resistances = analysis?.resistances ?? []
  const atr = indicators?.atr14 ?? null
  const distancePct = (level) => ((price - level) / price) * 100

  // 出場點：2 倍 ATR，最遠 −10%
  let stopLoss
  let noisyStop = false
  const atrStop = atr !== null ? round(price - atr * STOP_ATR_MULTIPLE) : null
  if (atrStop !== null && atrStop > 0) {
    const floor = round(price * (1 - MAX_STOP_PCT / 100))
    if (atrStop >= floor) {
      stopLoss = { price: atrStop, label: `一天平均波動的 ${STOP_ATR_MULTIPLE} 倍（約 −${round(distancePct(atrStop), 1)}%），收盤跌破才算` }
    } else {
      // 波動極大（例如重挫後一天動 6%）：2 倍會超過 −10%，設在上限，風險提醒部位要放小
      stopLoss = { price: floor, label: `最遠設到 −${MAX_STOP_PCT}%（波動很大，${STOP_ATR_MULTIPLE} 倍的一天平均波動會更遠），收盤跌破才算` }
      noisyStop = true
    }
  } else {
    stopLoss = { price: round(price * (1 - FALLBACK_STOP_PCT / 100)), label: `歷史資料不足，用 −${FALLBACK_STOP_PCT}% 當停損` }
  }

  // 目標：上方離現價至少 1 倍 ATR 的前兩個壓力；沒有（創新高、或壓力都貼著現價）時用 3 倍 ATR 估
  const farEnough = (level) => atr === null || level.price - price >= atr * MIN_TARGET_ATR
  let targets = resistances.filter(farEnough).slice(0, 2).map((level) => ({ price: level.price, label: level.label }))
  if (targets.length === 0) {
    if (atr !== null) {
      targets = [{ price: round(price + atr * FALLBACK_TARGET_ATR), label: `上方沒有明顯的壓力，以一天平均波動的 ${FALLBACK_TARGET_ATR} 倍估算` }]
    } else if (indicators?.high20 && indicators?.low20) {
      targets = [{ price: round(price + (indicators.high20 - indicators.low20) / 2), label: '上方沒有壓力，以近 20 日波動的一半估算' }]
    }
  }

  const reward = targets[0] ? targets[0].price - price : null
  const risk = price - stopLoss.price
  const riskReward = reward !== null && risk > 0 ? round(reward / risk, 2) : null

  // 文字用的參考價位。支撐：離現價至少 0.5 倍 ATR、而且在出場點之上（「拉回到這裡加碼」不能比出場點還低），
  // 優先用不是「容易跌破」的；沒有就不提。壓力：和目標價同一個（離現價至少 1 倍 ATR），沒有才用最近的
  const usable = (level) => level.price > stopLoss.price && (atr === null || price - level.price >= atr * MIN_REFERENCE_ATR)
  const referenceSupport = supports.find((level) => usable(level) && level.strength !== 'weak') ?? supports.find(usable) ?? null
  const referenceResistance = resistances.find(farEnough) ?? resistances[0] ?? null

  return {
    stopLoss,
    targets,
    riskReward,
    nearestSupport: referenceSupport,
    nearestResistance: referenceResistance,
    // 出場點被上限卡住（波動極大），風險提醒要說
    noisyStop,
    atrPct: atr !== null ? round((atr / price) * 100, 1) : null,
  }
}

// ---- 主程式 ----

// 大盤在季線（MA60）之上還是之下。context：{ label, series }（computeSeries 的結果），個股才有
function marketRegime(context) {
  const series = context?.series
  if (!series) return null
  const last = series.closes.length - 1
  const close = series.closes[last]
  const ma60 = series.ma60?.[last]
  if (close === null || close === undefined || ma60 === null || ma60 === undefined) return null
  return { label: context.label, direction: close >= ma60 ? 1 : -1 }
}

// 籌碼：淨買賣超佔同期成交量至少這麼多 %，或連續這麼多天同方向，才算數（規則版本 3）
const CHIP_MIN_VOLUME_PCT = 1
const CHIP_MIN_STREAK = 3

// item：marketService 的單一標的快照（需要 quote、analysis、indicators、research）；context：大盤（可省略）
function buildAdvice(item, { context = null } = {}) {
  if (!item?.analysis || !item.indicators) {
    return null
  }
  const price = item.quote.price
  const evidence = [
    ...longTrendEvidence(price, item.indicators),
    ...trendEvidence(item.analysis.signals),
    ...backtestEvidence(item.research?.backtest),
    ...strategyEvidence(item.research?.strategies),
    ...chipsEvidence(item.chips),
    ...predictionEvidence(item.research?.prediction),
  ]

  // 大盤方向只列出不計分。規則版本 2、3 會在大盤和結論相反時把信心降一級；歷史重算裡大盤在季線之上或之下，
  // 個股之後 10 天上漲的比例是 55.0% 對 57.2%，沒有差別，版本 4 拿掉降級
  const regime = marketRegime(context)
  if (regime) {
    evidence.push({
      group: '大盤',
      label: `${regime.label}${regime.direction > 0 ? '站上' : '跌破'}季線`,
      detail: NOT_SCORED,
      direction: regime.direction,
      weight: 0,
    })
  }

  const counted = evidence.filter((e) => e.weight > 0)
  const score = counted.reduce((sum, e) => sum + e.direction * e.weight, 0)
  const totalWeight = counted.reduce((sum, e) => sum + e.weight, 0)
  // 一致度：有方向的證據裡，同一邊的比例
  const agreement = totalWeight > 0 ? Math.abs(score) / totalWeight : 0

  const stance = score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : 'neutral'
  // 信心高：依據夠一致，而且不只有趨勢類（長期趨勢、均線）同方向，籌碼或回測訊號也有一項站同一邊。
  // 只有趨勢類時最多到中：趨勢幾項本來就常常同方向，一致不代表比較有把握
  const direction = stance === 'bullish' ? 1 : -1
  const otherSupport = counted.some((e) => e.direction === direction && e.group !== '長期趨勢' && e.group !== '技術面')
  const confidence =
    stance === 'neutral' ? 'low' : agreement >= 0.6 ? (otherSupport ? 'high' : 'medium') : agreement >= 0.35 ? 'medium' : 'low'

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
      ? `可以分批布局，第一筆不追高，等拉回 ${supportText}附近再加；收盤跌破 ${fmt(stopLoss.price)} 停損。`
      : `可以小量試單，收盤跌破 ${fmt(stopLoss.price)} 停損。`
    forHolders = t1
      ? `續抱，到 ${fmt(t1.price)}（${t1.label}）附近先賣一部分鎖住獲利；收盤跌破 ${fmt(stopLoss.price)} 出場。`
      : `續抱，收盤跌破 ${fmt(stopLoss.price)} 出場。`
  } else if (stance === 'bearish') {
    forNew = resistanceText
      ? `先不要進場。等重新站回 ${resistanceText}之上、長期趨勢轉強再評估。`
      : '先不要進場，等長期趨勢轉強再評估。'
    forHolders = resistanceText
      ? `反彈到 ${resistanceText}附近減碼；收盤跌破 ${fmt(stopLoss.price)} 就出場，不要攤平。`
      : `收盤跌破 ${fmt(stopLoss.price)} 就出場，不要攤平。`
  } else {
    forNew =
      supportText && resistanceText
        ? `方向不明，先觀望。要操作就做區間：靠近 ${supportText}小量買、接近 ${resistanceText}賣；帶量突破 ${fmt(nearestResistance.price)} 才追。`
        : '方向不明，先觀望，等訊號一致再進場。'
    forHolders = `部位不要再加。收盤跌破 ${fmt(stopLoss.price)} 減碼或出場${resistanceText ? `，站上 ${resistanceText}再考慮加碼` : ''}。`
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
  if (item.indicators.ma240 === null || item.indicators.ma240 === undefined) {
    risks.push('歷史資料不到一年，沒有年線與一年高點可以看，判斷的依據比較少。')
  }
  if (evidence.some((e) => e.group === '歷史回測' && e.weight === 0 && e.detail?.includes('樣本太少'))) {
    risks.push('部分訊號過去出現次數太少，沒有列入判斷。')
  }
  if (item.valuation?.summary?.expensive) {
    const basis = valuationBasis(item.valuation)
    risks.push(`估值偏貴：本益比 ${item.valuation.pe} 倍，高於 ${basis.pePercentile}% 的${basis.scope}公司，追高的風險大。`)
  }
  if (item.valuation && item.valuation.pe === null) risks.push('沒有本益比（近四季虧損或資料缺），基本面要另外確認。')
  if (evidence.some((e) => e.group === '歷史回測' && e.detail?.includes('前後方向相反'))) {
    risks.push('部分訊號前後期表現方向相反，可能只是剛好適合過去，沒有列入判斷。')
  }
  if (levels.noisyStop) {
    risks.push(`波動很大（一天約 ${levels.atrPct}%），出場點設在最遠的 −${MAX_STOP_PCT}%，還在兩天的震盪範圍內，容易被洗出場；部位要放小。`)
  }
  if (item.session === 'intraday') risks.push('目前是盤中資料，收盤前訊號可能改變。')

  const STANCE_LABELS = { bullish: '偏多', bearish: '偏空', neutral: '觀望' }
  const CONFIDENCE_LABELS = { high: '高', medium: '中', low: '低' }
  const bull = counted.filter((e) => e.direction > 0).length
  const bear = counted.filter((e) => e.direction < 0).length

  return {
    ruleVersion: RULE_VERSION,
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

module.exports = { buildAdvice, RULE_VERSION, STOP_ATR_MULTIPLE }
