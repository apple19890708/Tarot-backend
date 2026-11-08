// 選股（v17 階段 5）：把全市場的價量、估值、月營收、籌碼合併成一張表，再依條件篩選。純函式，方便測試。
// 技術面條件（站上季線、多頭排列、RSI）需要逐檔抓歷史 K 線，只對前面條件篩出的前 TECH_LIMIT 檔計算。

// 技術面要逐檔抓歷史 K 線，只對前這麼多檔計算
const TECH_LIMIT = 30
const RESULT_LIMIT = 100

const SORT_KEYS = {
  dividendYield: { label: '殖利率', desc: true },
  pe: { label: '本益比', desc: false },
  pb: { label: '股價淨值比', desc: false },
  revenueYoy: { label: '營收年增', desc: true },
  volume: { label: '成交量', desc: true },
  changePct: { label: '漲跌幅', desc: true },
  foreignStreak: { label: '外資連買', desc: true },
}

const isEtf = (code) => /^00/.test(code)

// quotes：Map<代號, { name, exchange, close, changePct, volume, date }>；其他都是 Map<代號, ...>
function buildUniverse({ quotes, valuation, revenue, streaks }) {
  const rows = []
  for (const [code, q] of quotes) {
    const v = valuation?.get(code)
    const r = revenue?.get(code)
    const s = streaks?.get(code)
    rows.push({
      code,
      name: q.name,
      exchange: q.exchange,
      etf: isEtf(code),
      open: q.open ?? null,
      high: q.high ?? null,
      low: q.low ?? null,
      close: q.close,
      change: q.change ?? null,
      changePct: q.changePct,
      volume: q.volume,
      pe: v?.pe ?? null,
      dividendYield: v?.dividendYield ?? null,
      pb: v?.pb ?? null,
      revenueMonth: r?.month ?? null,
      revenueYoy: r?.yoy ?? null,
      revenueCumYoy: r?.cumYoy ?? null,
      foreignStreak: s?.foreign ?? null,
      trustStreak: s?.trust ?? null,
    })
  }
  return rows
}

const NUMBER_FIELDS = ['peMax', 'yieldMin', 'pbMax', 'revenueYoyMin', 'revenueCumYoyMin', 'foreignStreakMin', 'trustStreakMin', 'priceMin', 'priceMax', 'volumeMin', 'rsiMin', 'rsiMax']

// 前端送來的條件：只留認得的欄位；數字不合理就回錯誤。空白的條件忽略
function parseFilters(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const filters = { includeEtf: input.includeEtf === true, aboveMa60: input.aboveMa60 === true, bullishMa: input.bullishMa === true }
  for (const key of NUMBER_FIELDS) {
    const value = input[key]
    if (value === undefined || value === null || value === '') continue
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return { error: '篩選條件的數字不正確。' }
    filters[key] = n
  }
  if (filters.rsiMax !== undefined && filters.rsiMax > 100) return { error: 'RSI 要在 0～100 之間。' }
  filters.sort = typeof input.sort === 'string' && Object.hasOwn(SORT_KEYS, input.sort) ? input.sort : 'dividendYield'
  return { filters }
}

const technicalNeeded = (f) => f.aboveMa60 || f.bullishMa || f.rsiMin !== undefined || f.rsiMax !== undefined

// 沒有資料的欄位：有設這個條件就不符合
function passes(row, f) {
  const min = (value, limit) => limit === undefined || (value !== null && value >= limit)
  const max = (value, limit) => limit === undefined || (value !== null && value <= limit)
  if (!f.includeEtf && row.etf) return false
  // 本益比要大於 0（虧損公司沒有本益比）
  if (f.peMax !== undefined && !(row.pe !== null && row.pe > 0 && row.pe <= f.peMax)) return false
  return (
    min(row.dividendYield, f.yieldMin) &&
    max(row.pb, f.pbMax) &&
    min(row.revenueYoy, f.revenueYoyMin) &&
    min(row.revenueCumYoy, f.revenueCumYoyMin) &&
    min(row.foreignStreak, f.foreignStreakMin) &&
    min(row.trustStreak, f.trustStreakMin) &&
    min(row.close, f.priceMin) &&
    max(row.close, f.priceMax) &&
    min(row.volume, f.volumeMin)
  )
}

function sortRows(rows, key) {
  const { desc } = SORT_KEYS[key]
  return [...rows].sort((a, b) => {
    const va = a[key]
    const vb = b[key]
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    return desc ? vb - va : va - vb
  })
}

// 技術面：signals 是 { price, ma5, ma20, ma60, rsi }
function passesTechnical(signals, f) {
  if (!signals) return false
  const { price, ma5, ma20, ma60, rsi } = signals
  if (f.aboveMa60 && !(price !== null && ma60 !== null && price >= ma60)) return false
  if (f.bullishMa && !(ma5 !== null && ma20 !== null && ma60 !== null && ma5 > ma20 && ma20 > ma60)) return false
  if (f.rsiMin !== undefined && !(rsi !== null && rsi >= f.rsiMin)) return false
  if (f.rsiMax !== undefined && !(rsi !== null && rsi <= f.rsiMax)) return false
  return true
}

module.exports = { TECH_LIMIT, RESULT_LIMIT, SORT_KEYS, buildUniverse, parseFilters, passes, sortRows, passesTechnical, technicalNeeded }
