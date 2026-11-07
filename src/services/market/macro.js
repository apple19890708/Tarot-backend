// 美國總經數據（大盤概況最上方）：CPI、核心 CPI、PCE、核心 PCE、非農就業。
// 來源是聖路易聯準銀行 FRED 的 CSV 下載（不用金鑰）；數據每月公布一次，所以在 marketService 快取 6 小時。
// 免費來源沒有「市場預期值」，只能顯示實際公布值和前一個月比較
const FRED_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv'

// kind：inflation 看年增率（和一年前比）與月增率；jobs 看當月新增人數（FRED 的 PAYEMS 單位是千人）
const SERIES = [
  { key: 'cpi', id: 'CPIAUCSL', name: 'CPI', kind: 'inflation' },
  { key: 'coreCpi', id: 'CPILFESL', name: '核心 CPI', kind: 'inflation' },
  { key: 'pce', id: 'PCEPI', name: 'PCE', kind: 'inflation' },
  { key: 'corePce', id: 'PCEPILFE', name: '核心 PCE', kind: 'inflation' },
  { key: 'nfp', id: 'PAYEMS', name: '非農就業', kind: 'jobs' },
]

const csvUrl = (id, from) => `${FRED_CSV}?id=${id}&cosd=${from}`

// observation_date,CPIAUCSL\n2026-09-01,336.298 → [{ date: '2026-09', value }]；缺值（'.'）跳過
function parseFredCsv(text) {
  return String(text || '')
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [date, raw] = line.split(',')
      const value = Number(raw)
      return /^\d{4}-\d{2}/.test(date || '') && raw !== '.' && Number.isFinite(value) ? { date: date.slice(0, 7), value } : null
    })
    .filter(Boolean)
}

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits

// 年增率需要 13 個月的資料（這個月與 12 個月前；前一個月的年增率要再往前一個月）
function summarize(series, rows) {
  const n = rows.length
  if (series.kind === 'jobs') {
    if (n < 3) return null
    return {
      key: series.key,
      name: series.name,
      kind: series.kind,
      month: rows[n - 1].date,
      // 千人
      change: Math.round(rows[n - 1].value - rows[n - 2].value),
      prevChange: Math.round(rows[n - 2].value - rows[n - 3].value),
    }
  }
  if (n < 14) return null
  const yoyAt = (i) => (rows[i].value / rows[i - 12].value - 1) * 100
  return {
    key: series.key,
    name: series.name,
    kind: series.kind,
    month: rows[n - 1].date,
    yoy: round(yoyAt(n - 1)),
    prevYoy: round(yoyAt(n - 2)),
    mom: round((rows[n - 1].value / rows[n - 2].value - 1) * 100),
  }
}

module.exports = { SERIES, csvUrl, parseFredCsv, summarize }
