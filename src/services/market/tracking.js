// 自動對答案：把過去的操作建議和之後的實際走勢對照，統計命中率。純函式（除了 recordCalls 寫資料庫）。
//
// 命中的定義：偏多之後上漲、偏空之後下跌。觀望不算命中率，另外看它之後的波動大小。
// 進場價用建議當下的價格（盤中查詢時就是盤中價），報酬以之後第 N 個交易日的收盤計算。
const { round } = require('./indicators')

const HORIZONS = [5, 10, 20]

// 從市場快照記下每個標的的建議（同一天同一標的覆蓋成最新的一次）
async function recordCalls(MarketCall, userId, snapshot) {
  if (!userId || !snapshot?.items?.length) return
  const ops = snapshot.items
    .filter((item) => item.advice && item.symbol && item.quote?.date)
    .map((item) => ({
      updateOne: {
        filter: { user: userId, symbol: item.symbol, date: item.quote.date },
        update: {
          $set: {
            code: item.code,
            exchange: item.exchange,
            market: item.market,
            kind: item.kind,
            name: item.name,
            price: item.quote.price,
            stance: item.advice.stance,
            confidence: item.advice.confidence,
            stopLoss: item.advice.levels.stopLoss?.price ?? null,
            targets: item.advice.levels.targets.map((t) => t.price),
            ruleVersion: item.advice.ruleVersion ?? 1,
          },
        },
        upsert: true,
      },
    }))
  if (ops.length > 0) {
    await MarketCall.bulkWrite(ops, { ordered: false })
  }
}

// 單一建議的後續表現。bars：該標的的日 K（由舊到新）
function evaluateCall(call, bars) {
  // 建議當天在 K 棒裡的位置（同一天，或之前最近的一天）
  let index = -1
  for (let i = 0; i < bars.length && bars[i].date <= call.date; i += 1) index = i
  const outcomes = HORIZONS.map((days) => {
    const future = index >= 0 ? bars[index + days] : undefined
    if (!future) return { days, ready: false, return: null, hit: null }
    const ret = (future.close / call.price - 1) * 100
    const hit = call.stance === 'bullish' ? ret > 0 : call.stance === 'bearish' ? ret < 0 : null
    return { days, ready: true, return: round(ret), hit }
  })

  // 偏多的建議：20 個交易日內先碰到停損還是先碰到第一目標
  let path = null
  if (call.stance === 'bullish' && index >= 0 && call.stopLoss && call.targets?.[0]) {
    path = 'open'
    for (let i = index + 1; i <= index + 20 && i < bars.length; i += 1) {
      if (bars[i].low <= call.stopLoss) {
        path = 'stop'
        break
      }
      if (bars[i].high >= call.targets[0]) {
        path = 'target'
        break
      }
    }
  }
  return { outcomes, path }
}

function rate(hits, total) {
  return total > 0 ? round((hits / total) * 100, 1) : null
}

function average(values) {
  return values.length > 0 ? round(values.reduce((sum, v) => sum + v, 0) / values.length) : null
}

const versionOf = (call) => call.ruleVersion ?? 1

// calls：MarketCall 文件（plain object）；barsBySymbol：Map<symbol, bars>
// ruleVersion：目前的規則版本；onlyCurrent 為 true 時只統計目前版本的紀錄（規則改過，新舊混在一起看不出新規則準不準）
function summarizeCalls(allCalls, barsBySymbol, { ruleVersion = null, onlyCurrent = false } = {}) {
  const currentCount = ruleVersion === null ? allCalls.length : allCalls.filter((call) => versionOf(call) === ruleVersion).length
  const calls = onlyCurrent && ruleVersion !== null ? allCalls.filter((call) => versionOf(call) === ruleVersion) : allCalls
  const evaluated = calls.map((call) => {
    const bars = barsBySymbol.get(call.symbol) || []
    return { call, ...evaluateCall(call, bars) }
  })

  const byHorizon = HORIZONS.map((days, h) => {
    const ready = evaluated.filter((e) => e.outcomes[h].ready)
    const directional = ready.filter((e) => e.call.stance !== 'neutral')
    const stance = (name) => {
      const list = ready.filter((e) => e.call.stance === name)
      return {
        count: list.length,
        hitRate: name === 'neutral' ? null : rate(list.filter((e) => e.outcomes[h].hit).length, list.length),
        avgReturn: average(list.map((e) => e.outcomes[h].return)),
        // 觀望之後的平均波動（取絕對值）：越小代表「觀望」越合理
        avgMove: name === 'neutral' ? average(list.map((e) => Math.abs(e.outcomes[h].return))) : null,
      }
    }
    const confidence = (name) => {
      const list = directional.filter((e) => e.call.confidence === name)
      return { count: list.length, hitRate: rate(list.filter((e) => e.outcomes[h].hit).length, list.length) }
    }
    return {
      days,
      evaluated: directional.length,
      hitRate: rate(directional.filter((e) => e.outcomes[h].hit).length, directional.length),
      // 對照組：同一批偏多／偏空的建議，如果每次都猜「會漲」的命中率。大盤在漲的期間這個數字本來就高，
      // 規則的命中率要贏過它才代表有判斷力
      alwaysUpRate: rate(directional.filter((e) => e.outcomes[h].return > 0).length, directional.length),
      bullish: stance('bullish'),
      bearish: stance('bearish'),
      neutral: stance('neutral'),
      byConfidence: { high: confidence('high'), medium: confidence('medium'), low: confidence('low') },
    }
  })

  const paths = evaluated.filter((e) => e.path && e.path !== 'open')
  return {
    total: calls.length,
    ruleVersion,
    onlyCurrent: onlyCurrent && ruleVersion !== null,
    // 全部紀錄裡，目前規則版本與舊版本各幾筆（不受 onlyCurrent 影響，畫面用來決定要不要顯示切換）
    versionCounts: { current: currentCount, older: allCalls.length - currentCount },
    pending: evaluated.filter((e) => !e.outcomes[0].ready).length,
    horizons: byHorizon,
    // 偏多建議 20 日內先到目標的比例
    targetFirstRate: rate(paths.filter((e) => e.path === 'target').length, paths.length),
    targetPathCount: paths.length,
    calls: evaluated.map(({ call, outcomes, path }) => ({
      id: String(call._id),
      symbol: call.symbol,
      code: call.code,
      name: call.name,
      market: call.market,
      date: call.date,
      price: call.price,
      stance: call.stance,
      confidence: call.confidence,
      ruleVersion: versionOf(call),
      stopLoss: call.stopLoss,
      targets: call.targets,
      outcomes,
      path,
    })),
  }
}

module.exports = { HORIZONS, recordCalls, evaluateCall, summarizeCalls }
