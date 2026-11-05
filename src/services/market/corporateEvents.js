// 台股的除權息預告與月營收（v16 階段 5）。資料都來自證交所、櫃買中心的免費 OpenAPI：
// - 除權息預告表：上市 TWT48U_ALL、上櫃 tpex_exright_prepost（只列即將除權息的，日期過了就不在表上）
// - 每月營業收入彙總表：上市 t187ap05_L、上櫃 mopsfin_t187ap05_O（最新一個月）
// 純函式的轉換放在這裡，抓取與快取由 marketService 負責。

const URLS = {
  twseExDividend: 'https://openapi.twse.com.tw/v1/exchangeReport/TWT48U_ALL',
  tpexExDividend: 'https://www.tpex.org.tw/openapi/v1/tpex_exright_prepost',
  twseRevenue: 'https://openapi.twse.com.tw/v1/opendata/t187ap05_L',
  tpexRevenue: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O',
}

const num = (value) => {
  const n = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}
const round = (value, digits = 2) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits)

// 民國日期 1151106 → 2026-11-06；民國年月 11509 → 2026-09
function rocDate(raw) {
  const m = /^(\d{3})(\d{2})(\d{2})$/.exec(String(raw || '').trim())
  return m ? `${Number(m[1]) + 1911}-${m[2]}-${m[3]}` : null
}
function rocMonth(raw) {
  const m = /^(\d{3})(\d{2})$/.exec(String(raw || '').trim())
  return m ? `${Number(m[1]) + 1911}-${m[2]}` : null
}

// 除權息預告：Map<代號, [{ date, type, cashDividend（每股元）, stockRatio }]>，依日期排序
function parseExDividends(twseRows, tpexRows) {
  const map = new Map()
  const add = (code, event) => {
    if (!code || !event.date) return
    if (!map.has(code)) map.set(code, [])
    map.get(code).push(event)
  }
  for (const row of twseRows || []) {
    const cash = num(row.CashDividend)
    const stock = num(row.StockDividendRatio)
    add(String(row.Code || '').trim(), {
      date: rocDate(row.Date),
      type: String(row.Exdividend || '').trim() || '息',
      cashDividend: cash && cash > 0 ? round(cash, 4) : null,
      stockRatio: stock && stock > 0 ? round(stock, 6) : null,
    })
  }
  for (const row of tpexRows || []) {
    const cash = num(row.CashDividend)
    const stock = num(row.StockDividendRatio)
    add(String(row.SecuritiesCompanyCode || '').trim(), {
      date: rocDate(row.ExRrightsExDividendDate),
      type: String(row.ExRrightsExDividend || '').replace(/^除/, '').trim() || '息',
      cashDividend: cash && cash > 0 ? round(cash, 4) : null,
      stockRatio: stock && stock > 0 ? round(stock, 6) : null,
    })
  }
  for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date))
  return map
}

// 月營收：Map<代號, { month, revenue（千元）, mom（%）, yoy（%）, cumYoy（%）, note }>
function parseRevenue(twseRows, tpexRows) {
  const map = new Map()
  for (const row of [...(twseRows || []), ...(tpexRows || [])]) {
    const code = String(row['公司代號'] || '').trim()
    const month = rocMonth(row['資料年月'])
    if (!code || !month) continue
    const note = String(row['備註'] || '').trim()
    map.set(code, {
      month,
      revenue: num(row['營業收入-當月營收']),
      mom: round(num(row['營業收入-上月比較增減(%)'])),
      yoy: round(num(row['營業收入-去年同月增減(%)'])),
      cumYoy: round(num(row['累計營業收入-前期比較增減(%)'])),
      note: note && note !== '-' ? note.slice(0, 120) : '',
    })
  }
  return map
}

// 公司要在每月 10 日前公布上個月營收：回傳下一次公布的截止日與月份
function nextRevenueDeadline(today) {
  const [y, m, d] = today.split('-').map(Number)
  let year = y
  let month = m
  if (d > 10) {
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  const prev = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 }
  return {
    deadline: `${year}-${String(month).padStart(2, '0')}-10`,
    forMonth: `${prev.y}-${String(prev.m).padStart(2, '0')}`,
  }
}

// 單檔的事件：今天（含）以後最近一次除權息、最新月營收
function eventsFor(code, { exDividends, revenue }, today) {
  const upcoming = (exDividends.get(code) || []).filter((e) => e.date >= today)
  return {
    exDividend: upcoming[0] || null,
    revenue: revenue.get(code) || null,
  }
}

module.exports = { URLS, rocDate, rocMonth, parseExDividends, parseRevenue, nextRevenueDeadline, eventsFor }
