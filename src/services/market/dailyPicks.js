// 當日推薦／熱門股票（v19 計畫書 2.5 與決議紀錄）：用固定規則從全市場收盤資料挑幾檔台股，附上白話的入選理由。
// 不是投資建議，畫面上要寫清楚。資料用選股的全市場表（screener.buildUniverse 的 rows），純函式方便測試。
// 每種類型一筆設定：前面的條件（不用抓 K 線）、排序、要不要再看站上 20 日均線、理由怎麼寫
const PICK_LIMIT = 8
// 要看 20 日均線的類型，只檢查依排序的前這麼多檔（要逐檔抓 K 線）
const TECH_CANDIDATES = 24
const MIN_STREAK = 3

// 只看一般股票：四位數代號、不是 ETF（00 開頭）；權證、特別股等代號格式不同，自然排除。
// 名稱帶 *（上櫃特殊交易狀態）也不推薦（2026-11-08 真實資料：「世紀*」排在高殖利率第一）
const isPlainStock = (row) => /^\d{4}$/.test(row.code) && !row.etf && !String(row.name || '').includes('*')
// 殖利率、本益比的合理範圍：殖利率超過 15%、本益比低於 5 倍，多半是一次性的處分利益或特別股利，明年不會再有（殖利率陷阱）。
// 2026-11-08 真實資料：殖利率 151.7%、23.5%（本益比 2.3 倍）排在最前面
const MAX_YIELD = 15
const MIN_PE = 5
const has = (value) => value !== null && value !== undefined
const round1 = (value) => Math.round(value * 10) / 10
const monthText = (row) => (row.revenueMonth ? `${Number(String(row.revenueMonth).slice(-2))} 月` : '最新')

// chipDays：籌碼資料只抓最近幾個交易日，連買天數最多就是這麼多；剛好到頂時實際可能更久，說成「最近 N 天都買超」
const streakText = (who, days, chipDays) => (chipDays && days >= chipDays ? `${who}最近 ${chipDays} 天都買超` : `${who}連續買超 ${days} 天`)

const PRESETS = {
  growth: {
    label: '法人連買成長股',
    rule: '外資或投信連續買超 3 天以上、最新月營收比去年同月成長、收盤價在 20 日均線之上，成交量 1000 張以上；外資連買天數多的排前面',
    needsMa20: true,
    filter: (row) =>
      has(row.volume) &&
      row.volume >= 1000 &&
      ((row.foreignStreak ?? 0) >= MIN_STREAK || (row.trustStreak ?? 0) >= MIN_STREAK) &&
      has(row.revenueYoy) &&
      row.revenueYoy > 0,
    sort: (a, b) =>
      (b.foreignStreak ?? 0) - (a.foreignStreak ?? 0) || (b.trustStreak ?? 0) - (a.trustStreak ?? 0) || b.revenueYoy - a.revenueYoy,
    reasons: (row, chipDays) => [
      ...((row.foreignStreak ?? 0) >= MIN_STREAK ? [streakText('外資', row.foreignStreak, chipDays)] : []),
      ...((row.trustStreak ?? 0) >= MIN_STREAK ? [streakText('投信', row.trustStreak, chipDays)] : []),
      `${monthText(row)}營收比去年同月多 ${round1(row.revenueYoy)}%`,
      '收盤價在 20 日均線之上',
    ],
  },
  dividend: {
    label: '高殖利率存股',
    rule: '殖利率 5%～15%、本益比 5～20 倍（太高的殖利率、太低的本益比多半是一次性收入，不列入）、成交量 500 張以上；殖利率高的排前面',
    needsMa20: false,
    filter: (row) =>
      has(row.volume) &&
      row.volume >= 500 &&
      has(row.dividendYield) &&
      row.dividendYield >= 5 &&
      row.dividendYield <= MAX_YIELD &&
      has(row.pe) &&
      row.pe >= MIN_PE &&
      row.pe <= 20,
    sort: (a, b) => b.dividendYield - a.dividendYield,
    reasons: (row) => [`殖利率 ${round1(row.dividendYield)}%`, `本益比 ${round1(row.pe)} 倍`],
  },
  revenue: {
    label: '營收爆發股',
    rule: '最新月營收比去年同月多 30% 以上、今年累計營收比去年多 10% 以上、收盤價在 20 日均線之上，成交量 500 張以上；營收成長多的排前面',
    needsMa20: true,
    filter: (row) =>
      has(row.volume) && row.volume >= 500 && has(row.revenueYoy) && row.revenueYoy >= 30 && has(row.revenueCumYoy) && row.revenueCumYoy >= 10,
    sort: (a, b) => b.revenueYoy - a.revenueYoy,
    reasons: (row) => [
      `${monthText(row)}營收比去年同月多 ${round1(row.revenueYoy)}%`,
      `今年累計營收比去年多 ${round1(row.revenueCumYoy)}%`,
      '收盤價在 20 日均線之上',
    ],
  },
  value: {
    label: '低本益比價值股',
    rule: '本益比 5～12 倍（太低的多半是一次性收入，不列入）、股價淨值比 1.5 倍以下、殖利率 3%～15%，成交量 500 張以上；本益比低的排前面',
    needsMa20: false,
    filter: (row) =>
      has(row.volume) &&
      row.volume >= 500 &&
      has(row.pe) &&
      row.pe >= MIN_PE &&
      row.pe <= 12 &&
      has(row.pb) &&
      row.pb < 1.5 &&
      has(row.dividendYield) &&
      row.dividendYield >= 3 &&
      row.dividendYield <= MAX_YIELD,
    sort: (a, b) => a.pe - b.pe,
    reasons: (row) => [`本益比 ${round1(row.pe)} 倍`, `股價淨值比 ${round1(row.pb)} 倍`, `殖利率 ${round1(row.dividendYield)}%`],
  },
  hot: {
    label: '熱門股（漲幅最大）',
    rule: '當天漲幅最大的股票，成交量 1000 張以上',
    needsMa20: false,
    filter: (row) => has(row.volume) && row.volume >= 1000 && has(row.changePct) && row.changePct > 0,
    sort: (a, b) => b.changePct - a.changePct,
    reasons: (row) => [`今天漲 ${round1(row.changePct)}%`, `成交 ${row.volume.toLocaleString('en-US')} 張`],
  },
}
const PICK_TYPES = Object.keys(PRESETS)
const DEFAULT_PICK_TYPE = 'growth'

// 不用抓 K 線就能判斷的條件，照這個類型的排序
function baseCandidates(rows, type = DEFAULT_PICK_TYPE) {
  const preset = PRESETS[type]
  return rows.filter((row) => isPlainStock(row) && preset.filter(row)).sort(preset.sort)
}

function reasonsOf(row, chipDays = 0, type = DEFAULT_PICK_TYPE) {
  return PRESETS[type].reasons(row, chipDays)
}

// candidates：baseCandidates 的前幾檔；signals：同順序的 { price, ma20 }（不看均線的類型傳空陣列）。
// 要看均線的：站上 20 日均線的才留（抓不到 K 線的跳過）；照原本的順序取前 PICK_LIMIT 檔
function selectPicks(candidates, signals, chipDays = 0, type = DEFAULT_PICK_TYPE) {
  const preset = PRESETS[type]
  const picks = []
  for (const [i, row] of candidates.entries()) {
    if (picks.length >= PICK_LIMIT) break
    if (preset.needsMa20) {
      const s = signals[i]
      if (!s || s.ma20 === null || s.price === null || s.price < s.ma20) continue
    }
    picks.push({
      code: row.code,
      name: row.name,
      exchange: row.exchange,
      // 開高低（股市總覽的表格檢視）
      open: row.open ?? null,
      high: row.high ?? null,
      low: row.low ?? null,
      close: row.close,
      change: row.change ?? null,
      changePct: row.changePct,
      // 張（股市總覽的表格檢視）
      volume: row.volume ?? null,
      reasons: reasonsOf(row, chipDays, type),
    })
  }
  return picks
}

module.exports = { PICK_LIMIT, TECH_CANDIDATES, MIN_STREAK, PRESETS, PICK_TYPES, DEFAULT_PICK_TYPE, baseCandidates, reasonsOf, selectPicks }
