// 長期操作建議（v17 規格 H）：給長期持有、存股的人，看「長期趨勢還在不在、現在算貴還是便宜、公司生意有沒有在成長」。
// 和短中期建議（advice.js）一樣是固定規則：同一份資料每次得到同一個結論；文字在這裡產生，前端只排版。
// 只用已經抓到的資料：5 年日 K（年線、半年線）、大盤序列、買進持有的年化報酬、估值排名、月營收。
const { round } = require('./indicators')
const { smaSeries } = require('./series')

// 年線、半年線（交易日）
const YEAR_DAYS = 240
const HALF_YEAR_DAYS = 120
// 年線方向：和這麼多個交易日前比，變動超過 SLOPE_PCT 才算上升／下降
const SLOPE_LOOKBACK = 20
const SLOPE_PCT = 0.5
// 近一年相對大盤：差這麼多個百分點才算贏／輸
const RELATIVE_DAYS = 250
const RELATIVE_EDGE = 10
// 買進持有的年化報酬門檻（%）
const GOOD_ANNUAL = 8
// 估值排名門檻（百分位）：本益比低於八成公司、殖利率高於八成公司算便宜；本益比高於 85% 算貴（和 describeValuation 一致）
const CHEAP_PE_PCT = 20
const HIGH_YIELD_PCT = 80
const EXPENSIVE_PE_PCT = 85
// 月營收今年累計年增率門檻（%）
const REVENUE_EDGE = 10
// 算得出年線方向需要的最少 K 棒
const MIN_BARS = YEAR_DAYS + SLOPE_LOOKBACK

function fmt(value) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
const signed = (value) => `${value > 0 ? '+' : ''}${fmt(value)}`

// 大盤在 date 當天或之前最近一天的收盤
function contextCloseAt(context, date) {
  const { dates, closes } = context
  for (let j = dates.length - 1; j >= 0; j -= 1) {
    if (dates[j] <= date) return closes[j]
  }
  return null
}

function trendEvidence(series, price) {
  const last = series.closes.length - 1
  const ma240 = smaSeries(series.closes, YEAR_DAYS)
  const ma120 = smaSeries(series.closes, HALF_YEAR_DAYS)
  const year = ma240[last]
  const yearBefore = ma240[last - SLOPE_LOOKBACK]
  const half = ma120[last]
  const evidence = []

  evidence.push({
    group: '長期趨勢',
    label: price >= year ? '股價站在年線之上' : '股價跌破年線',
    detail: `年線（近 240 個交易日平均價）${fmt(round(year))}，現價 ${fmt(price)}`,
    direction: price >= year ? 1 : -1,
    weight: 2,
  })

  const slope = ((year / yearBefore) - 1) * 100
  const slopeDirection = slope >= SLOPE_PCT ? 1 : slope <= -SLOPE_PCT ? -1 : 0
  evidence.push({
    group: '長期趨勢',
    label: slopeDirection > 0 ? '年線往上' : slopeDirection < 0 ? '年線往下' : '年線走平',
    detail: `年線和 ${SLOPE_LOOKBACK} 個交易日前比 ${signed(round(slope))}%${slopeDirection === 0 ? '，變化不大，不列入' : ''}`,
    direction: slopeDirection,
    weight: slopeDirection === 0 ? 0 : 1,
  })

  evidence.push({
    group: '長期趨勢',
    label: half >= year ? '半年線在年線之上' : '半年線在年線之下',
    detail: `半年線（近 120 個交易日平均價）${fmt(round(half))}，年線 ${fmt(round(year))}`,
    direction: half >= year ? 1 : -1,
    weight: 1,
  })

  return { evidence, yearLine: round(year) }
}

function relativeEvidence(series, context) {
  if (!context?.series) return []
  const last = series.closes.length - 1
  const from = last - RELATIVE_DAYS
  if (from < 0) return []
  const stockReturn = (series.closes[last] / series.closes[from] - 1) * 100
  const indexNow = contextCloseAt(context.series, series.dates[last])
  const indexThen = contextCloseAt(context.series, series.dates[from])
  if (!indexNow || !indexThen) return []
  const indexReturn = (indexNow / indexThen - 1) * 100
  const gap = stockReturn - indexReturn
  const direction = gap >= RELATIVE_EDGE ? 1 : gap <= -RELATIVE_EDGE ? -1 : 0
  return [
    {
      group: '和大盤比',
      label: direction > 0 ? `近一年贏過${context.label}` : direction < 0 ? `近一年輸給${context.label}` : `近一年和${context.label}差不多`,
      detail: `近一年 ${signed(round(stockReturn))}%，${context.label} ${signed(round(indexReturn))}%${direction === 0 ? `，差距不到 ${RELATIVE_EDGE} 個百分點，不列入` : ''}`,
      direction,
      weight: direction === 0 ? 0 : 1,
    },
  ]
}

function holdReturnEvidence(strategies) {
  const buyHold = strategies?.strategies.find((s) => s.key === 'buyHold')
  if (!buyHold || buyHold.annualReturn === null) return []
  const annual = buyHold.annualReturn
  const direction = annual >= GOOD_ANNUAL ? 1 : annual < 0 ? -1 : 0
  return [
    {
      group: '長期報酬',
      label: `過去約 ${strategies.years} 年一直抱著，平均每年 ${signed(annual)}%`,
      detail:
        direction > 0
          ? `每年 ${GOOD_ANNUAL}% 以上，長期持有的回報不錯`
          : direction < 0
            ? '長期持有是虧錢的'
            : `每年 0～${GOOD_ANNUAL}%，回報普通，不列入`,
      direction,
      weight: direction === 0 ? 0 : 1,
    },
  ]
}

function valuationEvidence(valuation) {
  if (!valuation) return []
  const { pe, pePercentile, dividendYield, yieldPercentile } = valuation
  if (pe !== null && pePercentile !== null && pePercentile >= EXPENSIVE_PE_PCT) {
    return [
      {
        group: '估值',
        label: `本益比 ${pe} 倍，偏貴`,
        detail: `比 ${pePercentile}% 的上市櫃公司貴`,
        direction: -1,
        weight: 1,
      },
    ]
  }
  const cheapPe = pe !== null && pePercentile !== null && pePercentile <= CHEAP_PE_PCT
  const highYield = dividendYield !== null && yieldPercentile !== null && yieldPercentile >= HIGH_YIELD_PCT
  if (cheapPe || highYield) {
    return [
      {
        group: '估值',
        label: cheapPe ? `本益比 ${pe} 倍，偏便宜` : `殖利率 ${dividendYield}%，屬於高殖利率`,
        detail: cheapPe ? `比 ${100 - pePercentile}% 的上市櫃公司便宜` : `高於 ${yieldPercentile}% 的上市櫃公司`,
        direction: 1,
        weight: 1,
      },
    ]
  }
  if (pe === null) {
    return [{ group: '估值', label: '沒有本益比', detail: '近四季虧損或資料缺，不列入', direction: 0, weight: 0 }]
  }
  return [{ group: '估值', label: `本益比 ${pe} 倍，在中間`, detail: '不算貴也不算便宜，不列入', direction: 0, weight: 0 }]
}

function revenueEvidence(revenue) {
  if (!revenue || revenue.cumYoy === null || revenue.cumYoy === undefined) return []
  const growth = revenue.cumYoy
  const direction = growth >= REVENUE_EDGE ? 1 : growth <= -REVENUE_EDGE ? -1 : 0
  const month = revenue.month ? `（到 ${revenue.month.replace('-', ' 年 ')} 月）` : ''
  return [
    {
      group: '營收成長',
      label: direction > 0 ? '今年營收成長' : direction < 0 ? '今年營收衰退' : '今年營收持平',
      detail: `今年累計營收比去年同期 ${signed(growth)}%${month}${direction === 0 ? `，變化在 ±${REVENUE_EDGE}% 內，不列入` : ''}`,
      direction,
      weight: direction === 0 ? 0 : 1,
    },
  ]
}

// series：computeSeries 的結果；context：{ label, series }（大盤）；revenue：corporateEvents 的月營收
function buildLongTermAdvice({ series, price, context = null, strategies = null, valuation = null, revenue = null }) {
  if (!series || series.closes.length < MIN_BARS || price === null || price === undefined) return null

  const trend = trendEvidence(series, price)
  const evidence = [
    ...trend.evidence,
    ...relativeEvidence(series, context),
    ...holdReturnEvidence(strategies),
    ...valuationEvidence(valuation),
    ...revenueEvidence(revenue),
  ]

  const counted = evidence.filter((e) => e.weight > 0)
  const score = counted.reduce((sum, e) => sum + e.direction * e.weight, 0)
  const totalWeight = counted.reduce((sum, e) => sum + e.weight, 0)
  const agreement = totalWeight > 0 ? Math.abs(score) / totalWeight : 0
  const stance = score >= 2 ? 'bullish' : score <= -2 ? 'bearish' : 'neutral'
  const confidence = stance === 'neutral' ? 'low' : agreement >= 0.6 ? 'high' : agreement >= 0.35 ? 'medium' : 'low'

  const yearLine = trend.yearLine
  const yearText = `${fmt(yearLine)}（年線）`
  const aboveYear = price >= yearLine
  let forNew
  let forHolders
  if (stance === 'bullish') {
    forNew = aboveYear
      ? `可以分批買進、長期持有；不要一次買滿，股價拉回 ${yearText} 附近是比較好的加碼位置。`
      : `長期條件不錯，但股價還在年線下面，等重新站回 ${yearText} 之上再分批買進。`
    forHolders = `可以續抱。只要沒有跌破 ${yearText} 而且年線還往上，長期趨勢就還在；跌破年線再重新評估。`
  } else if (stance === 'bearish') {
    forNew = `現在不適合長期持有或存股。至少等股價重新站回 ${yearText} 之上、年線不再往下，再考慮。`
    forHolders = aboveYear
      ? `長期條件轉弱，不要再加碼；股價跌破 ${yearText} 就減碼。`
      : `股價在年線下面、長期條件偏弱，反彈接近 ${yearText} 時可以減碼，不要攤平。`
  } else {
    forNew = `長期方向還不明確，先觀察。真的想買就小量分批，並以 ${yearText} 當作要不要繼續買的分界。`
    forHolders = `可以先抱著但不要加碼；股價${aboveYear ? '跌破' : '一直站不回'} ${yearText} 的話，考慮降低部位。`
  }

  const POSITION_SIZES = {
    bullish: { high: '可以當長期核心持股，分批買到正常部位', medium: '分批買到半個部位', low: '小部位分批試著存' },
    bearish: { high: '不建議長期持有，持有者逐步降低部位', medium: '持有者不要加碼，視情況減碼', low: '持有者不要加碼' },
    neutral: { high: '小部位或先觀察', medium: '小部位或先觀察', low: '小部位或先觀察' },
  }

  const risks = []
  if (!valuation && !revenue) risks.push('這檔沒有估值與營收資料（指數、ETF 或美股），長期判斷只看價格趨勢與報酬。')
  if (valuation?.pe === null) risks.push('沒有本益比（近四季虧損或資料缺），公司獲利要另外確認。')
  risks.push('長期建議只看年線、估值與營收，不包含財報細項（毛利率、負債、現金流）與產業前景，存股前請再確認公司基本面。')

  const STANCE_LABELS = { bullish: '適合長期持有', bearish: '不適合長期持有', neutral: '中性，先觀察' }
  const CONFIDENCE_LABELS = { high: '高', medium: '中', low: '低' }
  const bull = counted.filter((e) => e.direction > 0).length
  const bear = counted.filter((e) => e.direction < 0).length

  return {
    stance,
    stanceLabel: STANCE_LABELS[stance],
    confidence,
    confidenceLabel: CONFIDENCE_LABELS[confidence],
    score: round(score, 1),
    summary: `${counted.length} 項列入判斷的長期依據中，${bull} 項偏多、${bear} 項偏空，綜合判斷${STANCE_LABELS[stance]}（信心${CONFIDENCE_LABELS[confidence]}）。`,
    horizon: '半年以上',
    keyLevel: { price: yearLine, label: '年線（近 240 個交易日平均價）' },
    evidence: evidence.map(({ group, label, detail, direction, weight }) => ({
      group,
      label,
      detail: detail || null,
      direction,
      counted: weight > 0,
    })),
    forNew,
    forHolders,
    positionSize: POSITION_SIZES[stance][confidence],
    risks,
  }
}

module.exports = { buildLongTermAdvice, MIN_BARS }
