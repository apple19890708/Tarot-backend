// 台指期（期交所即時行情 mis.taifex.com.tw）：大盤概況最上方的「台指期夜盤」。
// 同一支 API 用 MarketType 分時段：'0' 一般交易時段（日盤）、'1' 盤後交易時段（夜盤，15:00～隔天 05:00）。
// 回傳的清單第一筆是現貨（SymbolID 結尾 -S／-P），之後是各月份合約，依到期月排序，第一個就是近月
const QUOTE_URL = 'https://mis.taifex.com.tw/futures/api/getQuoteList'
// 單一合約這一個交易時段的一分鐘 K（期交所行情網站畫走勢圖用的）：Ticks 每筆是 [時間 HHMMSS, 開, 高, 低, 收, 量]
const CHART_URL = 'https://mis.taifex.com.tw/futures/api/getChartData1M'

const SESSIONS = { day: '0', night: '1' }

function requestBody(session) {
  return JSON.stringify({
    MarketType: SESSIONS[session],
    SymbolType: 'F',
    KindID: '1',
    CID: 'TXF',
    ExpireMonth: '',
    RowSize: '全部',
    PageNo: '',
    SortColumn: '',
    AscDesc: 'A',
  })
}

const num = (value) => {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  return value === '' || value === null || value === undefined || !Number.isFinite(n) ? null : n
}

// 20261106 + 045959 → 2026-11-06、04:59:59
const dateOf = (raw) => (/^\d{8}$/.test(raw || '') ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}` : null)
const timeOf = (raw) => {
  const text = String(raw || '').padStart(6, '0')
  return /^\d{6}$/.test(text) && raw ? `${text.slice(0, 2)}:${text.slice(2, 4)}:${text.slice(4, 6)}` : null
}

// 近月合約的報價；沒有成交（夜盤還沒開、資料缺）回 null
function nearMonthQuote(payload, session) {
  const list = payload?.RtData?.QuoteList || []
  const suffix = session === 'night' ? '-M' : '-F'
  const row = list.find((q) => /^TXF[A-Z]\d/.test(q.SymbolID || '') && String(q.SymbolID).endsWith(suffix))
  if (!row) return null
  const price = num(row.CLastPrice)
  const ref = num(row.CRefPrice)
  if (price === null) return null
  const change = ref !== null ? Math.round((price - ref) * 100) / 100 : null
  return {
    session,
    // 期交所的合約代號（TXFK6-M），查分鐘走勢用
    symbolId: String(row.SymbolID),
    // 「臺指期116」：民國年＋月份的近月合約
    contract: String(row.DispCName || '').trim() || null,
    price,
    // 夜盤的參考價是當天日盤的結算價
    refPrice: ref,
    change,
    changePct: change !== null && ref ? Math.round((change / ref) * 10000) / 100 : null,
    open: num(row.COpenPrice),
    high: num(row.CHighPrice),
    low: num(row.CLowPrice),
    volume: num(row.CTotalVolume),
    date: dateOf(row.CDate),
    time: timeOf(row.CTime),
  }
}

// 分鐘走勢 → [{ t: ISO, close }]。Ticks 只有時間沒有日期：夜盤從 sessionDate 的 15:00 開始，
// 時間小於 15:00 的屬於隔天凌晨（台北時間 +08:00）
function chartPoints(payload, sessionDate) {
  const ticks = payload?.RtData?.Ticks || []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate || '')) return []
  const start = Date.parse(`${sessionDate}T00:00:00+08:00`)
  return ticks
    .map((tick) => {
      const time = String(tick[0] || '').padStart(6, '0')
      const close = num(tick[4])
      if (!/^\d{6}$/.test(time) || close === null) return null
      const seconds = Number(time.slice(0, 2)) * 3600 + Number(time.slice(2, 4)) * 60 + Number(time.slice(4, 6))
      const nextDay = Number(time.slice(0, 2)) < 15 ? 86400 : 0
      return { t: new Date(start + (seconds + nextDay) * 1000).toISOString(), close }
    })
    .filter(Boolean)
}

module.exports = { QUOTE_URL, CHART_URL, requestBody, nearMonthQuote, chartPoints }
