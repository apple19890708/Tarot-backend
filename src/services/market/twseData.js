// 台股的籌碼面（三大法人、融資融券）與估值（本益比、殖利率、股價淨值比）。
// 資料來源都是證交所與櫃買中心的免費資料：
// - 上市：證交所 T86（三大法人，可指定日期）、MI_MARGN（融資融券，可指定日期）、BWIBBU_ALL（估值，最新一日）
// - 上櫃：櫃買中心 OpenAPI（三大法人、融資融券、估值，都只有最新一日）
// - 大盤：證交所 BFI82U（三大法人買賣金額，可指定日期）
// fetchJson 與 cache 由 marketService 注入，共用逾時與快取設定。
const { round } = require('./indicators')

const URLS = {
  t86: 'https://www.twse.com.tw/rwd/zh/fund/T86',
  bfi82u: 'https://www.twse.com.tw/rwd/zh/fund/BFI82U',
  margin: 'https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN',
  twseValuation: 'https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL',
  tpexValuation: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis',
  tpexInsti: 'https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading',
  tpexMargin: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance',
}

// 過去日期的資料不會再變，快取久一點；當天的資料可能還沒公布或會更新
const TTL_PAST = 24 * 60 * 60 * 1000
const TTL_TODAY = 10 * 60 * 1000
const TTL_LATEST = 60 * 60 * 1000
const CHIP_DAYS = 5

function num(value) {
  if (value === null || value === undefined) return null
  const n = Number(String(value).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : null
}

const compact = (date) => date.replace(/-/g, '')
const diff = (a, b) => (a === null || b === null ? null : a - b)
const lots = (shares) => (shares === null ? null : round(shares / 1000, 0))

function createTwseData({ fetchJson, cache, today }) {
  async function cached(key, ttl, load) {
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const value = await load()
    cache.set(key, value, ttl)
    return value
  }

  const ttlFor = (date) => (date >= today() ? TTL_TODAY : TTL_PAST)

  // ---- 上市：依日期 ----

  // 某日全市場三大法人（股）：Map<code, { foreign, trust, dealer, total }>；當天還沒公布或休市時為 null
  function loadT86(date) {
    return cached(`t86:${date}`, ttlFor(date), async () => {
      const payload = await fetchJson(`${URLS.t86}?date=${compact(date)}&selectType=ALLBUT0999&response=json`)
      if (payload?.stat !== 'OK' || !Array.isArray(payload.data)) return null
      const map = new Map()
      for (const row of payload.data) {
        map.set(row[0].trim(), {
          // 外資含外資自營商；自營商含自行買賣與避險
          foreign: num(row[4]) + (num(row[7]) || 0),
          trust: num(row[10]),
          dealer: num(row[11]),
          total: num(row[18]),
        })
      }
      return map
    })
  }

  // 某日融資融券餘額（張）：Map<code, { margin, short }>
  function loadMargin(date) {
    return cached(`margin:${date}`, ttlFor(date), async () => {
      const payload = await fetchJson(`${URLS.margin}?date=${compact(date)}&selectType=ALL&response=json`)
      const table = payload?.stat === 'OK' ? payload.tables?.find((t) => t.fields?.[0] === '代號') : null
      if (!table) return null
      const map = new Map()
      for (const row of table.data) {
        map.set(row[0].trim(), { margin: num(row[6]), short: num(row[12]) })
      }
      return map
    })
  }

  // 某日大盤三大法人買賣差額（元）
  function loadMarketInsti(date) {
    return cached(`bfi82u:${date}`, ttlFor(date), async () => {
      const payload = await fetchJson(`${URLS.bfi82u}?type=day&dayDate=${compact(date)}&response=json`)
      if (payload?.stat !== 'OK' || !Array.isArray(payload.data)) return null
      const pick = (prefix) =>
        payload.data.filter((row) => row[0].startsWith(prefix)).reduce((sum, row) => sum + (num(row[3]) || 0), 0)
      return { foreign: pick('外資'), trust: pick('投信'), dealer: pick('自營商'), total: pick('合計') }
    })
  }

  // ---- 上櫃：只有最新一日 ----

  function loadTpexInsti() {
    return cached('tpexInsti', TTL_LATEST, async () => {
      const rows = await fetchJson(URLS.tpexInsti)
      const map = new Map()
      for (const row of rows || []) {
        map.set(row.SecuritiesCompanyCode, {
          date: row.Date,
          foreign: num(row['ForeignInvestorsInclude MainlandAreaInvestors-Difference']),
          trust: num(row['SecuritiesInvestmentTrustCompanies-Difference']),
          dealer: num(row['Dealers-Difference']),
          total: num(row.TotalDifference),
        })
      }
      return map
    })
  }

  function loadTpexMargin() {
    return cached('tpexMargin', TTL_LATEST, async () => {
      const rows = await fetchJson(URLS.tpexMargin)
      const map = new Map()
      for (const row of rows || []) {
        map.set(row.SecuritiesCompanyCode, {
          margin: num(row.MarginPurchaseBalance),
          marginPrev: num(row.MarginPurchaseBalancePreviousDay),
          short: num(row.ShortSaleBalance),
          shortPrev: num(row.ShortSaleBalancePreviousDay),
        })
      }
      return map
    })
  }

  // ---- 估值 ----

  function loadValuation() {
    return cached('valuation', TTL_LATEST, async () => {
      const [twse, tpex] = await Promise.allSettled([fetchJson(URLS.twseValuation), fetchJson(URLS.tpexValuation)])
      const map = new Map()
      if (twse.status === 'fulfilled') {
        for (const row of twse.value || []) {
          map.set(row.Code, { pe: num(row.PEratio) || null, dividendYield: num(row.DividendYield), pb: num(row.PBratio) })
        }
      }
      if (tpex.status === 'fulfilled') {
        for (const row of tpex.value || []) {
          map.set(row.SecuritiesCompanyCode, {
            pe: num(row.PriceEarningRatio) || null,
            dividendYield: num(row.YieldRatio),
            pb: num(row.PriceBookRatio),
          })
        }
      }
      return map
    })
  }

  // 這檔的估值，以及在全體上市櫃公司裡的百分位（本益比高於多少比例的公司）
  async function getValuation(code) {
    const map = await loadValuation()
    const own = map.get(code)
    if (!own) return null
    const percentile = (key, value) => {
      if (value === null || value === undefined) return null
      const all = [...map.values()].map((v) => v[key]).filter((v) => v !== null && v > 0)
      if (all.length < 50) return null
      return round((all.filter((v) => v < value).length / all.length) * 100, 0)
    }
    return {
      pe: own.pe,
      dividendYield: own.dividendYield,
      pb: own.pb,
      pePercentile: percentile('pe', own.pe),
      yieldPercentile: percentile('dividendYield', own.dividendYield),
      pbPercentile: percentile('pb', own.pb),
    }
  }

  // ---- 籌碼 ----

  // dates：由舊到新的交易日（YYYY-MM-DD），取最後幾天裡有公布資料的
  async function getChips(target, dates) {
    if (target.market !== 'tw') return null
    const recent = dates.slice(-(CHIP_DAYS + 2))

    if (target.kind === 'index') {
      if (target.exchange !== 'tse') return null
      const days = (await Promise.all(recent.map(async (date) => ({ date, data: await loadMarketInsti(date) }))))
        .filter((d) => d.data)
        .slice(-CHIP_DAYS)
      if (days.length === 0) return null
      const yi = (v) => round(v / 1e8, 1)
      return {
        unit: '億元',
        scope: 'market',
        dates: days.map((d) => d.date),
        foreign: days.map((d) => yi(d.data.foreign)),
        trust: days.map((d) => yi(d.data.trust)),
        dealer: days.map((d) => yi(d.data.dealer)),
        margin: null,
      }
    }

    if (target.exchange === 'otc') {
      const [insti, margin] = await Promise.all([loadTpexInsti(), loadTpexMargin()])
      const row = insti.get(target.code)
      const m = margin.get(target.code)
      if (!row && !m) return null
      return {
        unit: '張',
        scope: 'stock',
        // 櫃買中心的免費資料只有最新一日
        latestOnly: true,
        dates: row ? [`${Number(row.date.slice(0, 3)) + 1911}-${row.date.slice(3, 5)}-${row.date.slice(5, 7)}`] : [],
        foreign: row ? [lots(row.foreign)] : [],
        trust: row ? [lots(row.trust)] : [],
        dealer: row ? [lots(row.dealer)] : [],
        margin: m
          ? { balance: m.margin, change: diff(m.margin, m.marginPrev), days: 1, shortBalance: m.short, shortChange: diff(m.short, m.shortPrev) }
          : null,
      }
    }

    const days = (await Promise.all(recent.map(async (date) => ({ date, map: await loadT86(date) }))))
      .filter((d) => d.map)
      .slice(-CHIP_DAYS)
    const rows = days.map((d) => ({ date: d.date, row: d.map.get(target.code) })).filter((d) => d.row)

    // 融資：最近一個有資料的日子，和約 5 個交易日前比
    let margin = null
    if (days.length > 0) {
      const latestDate = days[days.length - 1].date
      const baseDate = dates[Math.max(0, dates.indexOf(latestDate) - CHIP_DAYS)]
      const [latest, base] = await Promise.all([loadMargin(latestDate), loadMargin(baseDate)])
      const now = latest?.get(target.code)
      const before = base?.get(target.code)
      if (now) {
        margin = {
          balance: now.margin,
          change: before ? now.margin - before.margin : null,
          days: before ? CHIP_DAYS : null,
          shortBalance: now.short,
          shortChange: before ? now.short - before.short : null,
        }
      }
    }

    if (rows.length === 0 && !margin) return null
    return {
      unit: '張',
      scope: 'stock',
      dates: rows.map((d) => d.date),
      foreign: rows.map((d) => lots(d.row.foreign)),
      trust: rows.map((d) => lots(d.row.trust)),
      dealer: rows.map((d) => lots(d.row.dealer)),
      margin,
    }
  }

  return { getChips, getValuation }
}

// ---- 判讀（純函式）----

const sum = (values) => values.reduce((total, v) => total + (v || 0), 0)

// 連續買超或賣超幾天（從最新一天往回數）
function streak(values) {
  if (values.length === 0) return 0
  const sign = Math.sign(values[values.length - 1])
  if (sign === 0) return 0
  let count = 0
  for (let i = values.length - 1; i >= 0 && Math.sign(values[i]) === sign; i -= 1) count += 1
  return sign * count
}

function describeChips(chips, priceChange5d) {
  if (!chips) return null
  const label = (name, values) => {
    const s = streak(values)
    const total = round(sum(values), 1)
    const dir = total > 0 ? '買超' : total < 0 ? '賣超' : '持平'
    const streakText = Math.abs(s) >= 2 ? `，連續 ${Math.abs(s)} 日${s > 0 ? '買超' : '賣超'}` : ''
    return { name, total, streak: s, text: `${name}${chips.dates.length > 1 ? ` ${chips.dates.length} 日` : ''}${dir} ${Math.abs(total).toLocaleString('en-US')} ${chips.unit}${streakText}` }
  }
  const foreign = label('外資', chips.foreign)
  const trust = label('投信', chips.trust)
  const dealer = label('自營商', chips.dealer)

  let marginNote = null
  if (chips.margin?.change !== null && chips.margin?.change !== undefined && chips.margin.balance) {
    const pct = (chips.margin.change / (chips.margin.balance - chips.margin.change)) * 100
    const span = chips.margin.days ? `${chips.margin.days} 日` : ''
    const base = `融資${span ? ` ${span}` : ''}${chips.margin.change >= 0 ? '增加' : '減少'} ${Math.abs(chips.margin.change).toLocaleString('en-US')} 張（${pct >= 0 ? '+' : ''}${round(pct, 1)}%）`
    let verdict = ''
    let direction = 0
    if (priceChange5d !== null && priceChange5d !== undefined && Math.abs(pct) >= 2) {
      if (pct > 0 && priceChange5d < 0) {
        verdict = '，股價跌、融資反而增加，散戶在接刀，籌碼偏亂'
        direction = -1
      } else if (pct < 0 && priceChange5d > 0) {
        verdict = '，股價漲、融資減少，籌碼轉向法人，偏乾淨'
        direction = 1
      }
    }
    marginNote = { text: base + verdict, direction, changePct: round(pct, 1) }
  }

  return { foreign, trust, dealer, margin: marginNote }
}

function describeValuation(valuation) {
  if (!valuation) return null
  const notes = []
  if (valuation.pe === null) notes.push('沒有本益比（近四季虧損或資料缺）')
  else if (valuation.pePercentile !== null && valuation.pePercentile >= 85)
    notes.push(`本益比 ${valuation.pe} 倍，高於 ${valuation.pePercentile}% 的上市櫃公司，估值偏貴`)
  else if (valuation.pePercentile !== null && valuation.pePercentile <= 20)
    notes.push(`本益比 ${valuation.pe} 倍，低於 ${100 - valuation.pePercentile}% 的上市櫃公司，估值偏便宜`)
  if (valuation.dividendYield !== null && valuation.yieldPercentile !== null && valuation.yieldPercentile >= 80)
    notes.push(`殖利率 ${valuation.dividendYield}%，屬於高殖利率`)
  return { notes, expensive: valuation.pePercentile !== null && valuation.pePercentile >= 85 }
}

module.exports = { createTwseData, describeChips, describeValuation, streak, CHIP_DAYS }
