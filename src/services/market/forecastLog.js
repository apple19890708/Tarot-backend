// 股利預估的紀錄與驗證（v20，2026-11-10 使用者要求）：每次產生「股利獲利與預測」時，把每檔每月的推估記下來，
// 等證交所公告或實際除息後補上實際數字，畫面用長條圖比較「預估 vs 實際」驗證準不準。
// 純函式 forecastOps 組出 bulkWrite 的操作（好測），createForecastLog 負責寫入與查詢。

const { deductionsOf } = require('./income')

const CHECK_MONTHS = 24
// 推估的算法（v20 2.9.10）：latest＝最近一次配息。2026-11-11 以前記下的推估沒有 method，是舊算法（近 12 個月平均）
const ESTIMATE_METHOD = 'latest'

// report 是 buildIncomeReport 的結果 → bulkWrite 的操作
// - 推估：第一次推估只寫一次（$setOnInsert）；最後一次推估在 actual 出現前一直更新，之後凍結（filter 帶 actual: null）
// - 已公告／本月已除息／董事會已決議：寫入 actual
// - 過去的實際除息（pastEvents）：只補「有推估、還沒有實際」的紀錄（期間沒人開頁面也補得上）
function forecastOps(report, at) {
  const ops = []
  const months = new Set(report.months)
  for (const item of report.items) {
    const { target } = item
    if (target.kind !== 'stock' || !target.symbol || !item.projection) continue
    const key = { symbol: target.symbol }
    const base = { code: target.code ?? null, market: target.market }
    for (const entry of item.projection.months) {
      const cash = entry.cash
      if (!cash) continue
      if (cash.source === 'estimated') {
        const point = { perShare: cash.perShare, date: cash.estimatedDate ?? cash.exDate ?? null, at, source: null, method: ESTIMATE_METHOD }
        // 兩步（依序執行）：1. 沒有這筆就建立並記第一次推估；2. 還沒有實際數字的才更新最後一次推估（公布後凍結）。
        // 不用 aggregation pipeline 的條件更新：Mongoose 9 預設擋 pipeline（要開 updatePipeline），測試的假資料庫抓不到
        ops.push({
          updateOne: {
            filter: { ...key, month: entry.month },
            update: { $set: base, $setOnInsert: { firstEstimate: point } },
            upsert: true,
          },
        })
        ops.push({
          updateOne: {
            filter: { ...key, month: entry.month, actual: null },
            update: { $set: { lastEstimate: point } },
          },
        })
      } else {
        ops.push({
          updateOne: {
            filter: { ...key, month: entry.month },
            // 董事會決議（decided）也算實際：金額已經確定，只是除息日還沒訂，日期記決議日
            update: { $set: { ...base, actual: { perShare: cash.perShare, date: cash.exDate ?? cash.decidedAt ?? null, at, source: cash.source } } },
            upsert: true,
          },
        })
      }
    }
    // 過去的：每個月取最後一次除息（月配偶爾一個月兩次）
    const pastByMonth = new Map()
    for (const event of item.pastEvents ?? []) {
      if (event.type !== 'cash' || months.has(event.date.slice(0, 7))) continue
      pastByMonth.set(event.date.slice(0, 7), event)
    }
    for (const [month, event] of pastByMonth) {
      ops.push({
        updateOne: {
          filter: { ...key, month, actual: null, firstEstimate: { $ne: null } },
          update: { $set: { actual: { perShare: event.perShare, date: event.date, at, source: 'exDone' } } },
        },
      })
    }
  }
  return ops
}

const round2 = (value) => Math.round(value * 100) / 100

// 記錄當下的台北日期
const taipeiDay = (at) => new Date(new Date(at).getTime() + 8 * 3600000).toISOString().slice(0, 10)

// 推估的每股金額。舊算法（沒有 method）的，讀取時改用新算法重算：記錄當下「最近一次配息」
// （2026-11-11 使用者要求預估準不準也改成新的；資料庫不改，所以算法再換也能重算）。
// pastEvents：這檔近 2 年的實際除息（日期排序）；記錄前沒有配息可用的維持原值
function estimateOf(point, pastEvents) {
  if (!point) return null
  if (point.method === ESTIMATE_METHOD || !point.at) return point.perShare
  const day = taipeiDay(point.at)
  const prior = pastEvents.filter((e) => e.type === 'cash' && e.date <= day)
  return prior.length ? prior[prior.length - 1].perShare : point.perShare
}

// 一筆紀錄 → 畫面要的比較（預估用公布前最後一次）
function checkOf(doc, name, pastEvents = []) {
  const estimate = estimateOf(doc.lastEstimate, pastEvents) ?? estimateOf(doc.firstEstimate, pastEvents)
  const actual = doc.actual.perShare
  return {
    symbol: doc.symbol,
    code: doc.code,
    name,
    market: doc.market,
    month: doc.month,
    estimate,
    firstEstimate: estimateOf(doc.firstEstimate, pastEvents),
    actual,
    // 預估比實際高幾 %（正的＝高估）
    errorPct: actual > 0 ? round2(((estimate - actual) / actual) * 100) : null,
    estimateDate: doc.lastEstimate?.date ?? doc.firstEstimate?.date ?? null,
    actualDate: doc.actual.date ?? null,
  }
}

// 過去月份的「當時預估」合計：每一筆比較（有推估也有實際）× 當時持有的股數（應收股利裡那一次的 shares），
// 扣款和實際用同一個規則，所以兩邊可以直接比。沒有任何紀錄的月份是 null（圖上就不畫預估標記）
function attachPastEstimates(report, checks) {
  const pastMonths = report.pastMonths ?? []
  const series = { tw: pastMonths.map(() => null), us: pastMonths.map(() => null) }
  const bySymbol = new Map(report.items.map((item) => [item.target.symbol, item]))
  for (const check of checks ?? []) {
    const index = pastMonths.indexOf(check.month)
    const item = bySymbol.get(check.symbol)
    if (index < 0 || !item) continue
    const event = item.entitlement?.events?.find((e) => e.type === 'cash' && e.exDate.startsWith(check.month))
    if (!event) continue
    const gross = check.estimate * event.shares
    const net = gross - deductionsOf(item.target.market, gross, report.settings)
    const side = series[item.target.market]
    side[index] = (side[index] ?? 0) + net
  }
  const round = (value) => (value === null ? null : round2(value))
  report.totals.tw.pastEstimate = series.tw.map(round)
  report.totals.us.pastEstimate = series.us.map(round)
  const fx = report.usdTwd ?? 0
  report.totals.twd.pastEstimate = pastMonths.map((_, i) => {
    const tw = series.tw[i]
    const us = series.us[i]
    if (tw === null && us === null) return null
    return round2((tw ?? 0) + (us ?? 0) * fx)
  })
  return report
}

function createForecastLog({ DividendForecast, now = () => new Date() }) {
  // 寫入：不擋回應，失敗只記 log
  function record(report) {
    const ops = forecastOps(report, now())
    if (!ops.length) return Promise.resolve()
    // ordered：同一檔同一月的兩步（建立、更新最後一次推估）要依序執行
    return DividendForecast.bulkWrite(ops, { ordered: true }).catch((error) => console.error('股利預估紀錄失敗：', error.message))
  }

  // 這些股票近 24 個月「有推估、也有實際」的紀錄
  async function checks(items, today) {
    const names = new Map(items.filter((item) => item.target.symbol).map((item) => [item.target.symbol, item.target.name]))
    const events = new Map(items.filter((item) => item.target.symbol).map((item) => [item.target.symbol, item.pastEvents ?? []]))
    if (!names.size) return []
    const [year, month] = today.slice(0, 7).split('-').map(Number)
    const from = `${year - Math.floor(CHECK_MONTHS / 12)}-${String(month).padStart(2, '0')}`
    const docs = await DividendForecast.find({ symbol: { $in: [...names.keys()] }, month: { $gte: from }, actual: { $ne: null }, firstEstimate: { $ne: null } })
      .sort({ month: 1, symbol: 1 })
      .lean()
    return docs.map((doc) => checkOf(doc, names.get(doc.symbol) ?? doc.code ?? doc.symbol, events.get(doc.symbol) ?? []))
  }

  return { record, checks }
}

module.exports = { forecastOps, checkOf, attachPastEstimates, createForecastLog }
