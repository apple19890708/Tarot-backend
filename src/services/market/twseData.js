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
  // 備援：同一份資料的網站版。2026-11-10 實測 OpenAPI 回「因為安全性考量，您所執行的頁面無法呈現」（HTML），上市股票的估值全部消失
  twseValuationDaily: 'https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d',
  tpexValuation: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis',
  tpexInsti: 'https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading',
  tpexMargin: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance',
  // 上市／上櫃公司基本資料（只取產業別）
  twseCompanies: 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
  tpexCompanies: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O',
}

// 證交所產業別代碼（上市、上櫃共用）
const INDUSTRY_LABELS = {
  '01': '水泥', '02': '食品', '03': '塑膠', '04': '紡織纖維', '05': '電機機械', '06': '電器電纜', '08': '玻璃陶瓷',
  '09': '造紙', '10': '鋼鐵', '11': '橡膠', '12': '汽車', '14': '建材營造', '15': '航運', '16': '觀光餐旅',
  '17': '金融保險', '18': '貿易百貨', '19': '綜合', '20': '其他', '21': '化學', '22': '生技醫療', '23': '油電燃氣',
  '24': '半導體', '25': '電腦及週邊設備', '26': '光電', '27': '通信網路', '28': '電子零組件', '29': '電子通路',
  '30': '資訊服務', '31': '其他電子', '32': '文化創意', '33': '農業科技', '34': '電子商務', '35': '綠能環保',
  '36': '數位雲端', '37': '運動休閒', '38': '居家生活',
}
// 同產業至少要有這麼多家有數字的公司，百分位才有意義；不夠就用全市場
const MIN_INDUSTRY_PEERS = 8
// 產業別幾乎不會變，一天抓一次
const TTL_INDUSTRY = 24 * 60 * 60 * 1000

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
  // 同一份資料正在下載時，後來的呼叫直接等同一個結果。
  // 以前快取要等第一次下載完才寫入，自選清單 N 檔股票同時查籌碼，就會把同一天的全市場三大法人
  // 下載 N 次（8 檔 × 7 天 = 56 次，應該只要 7 次）：記憶體瞬間衝過 512MB 被 Cloud Run 砍掉，也可能被證交所限流
  const pending = new Map()
  function cached(key, ttl, load) {
    const hit = cache.get(key)
    if (hit !== undefined) return Promise.resolve(hit)
    if (pending.has(key)) return pending.get(key)
    const promise = load()
      .then((value) => {
        cache.set(key, value, ttl)
        return value
      })
      .finally(() => pending.delete(key))
    pending.set(key, promise)
    return promise
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
      if (twse.status === 'fulfilled' && Array.isArray(twse.value) && twse.value.length > 0) {
        for (const row of twse.value) {
          map.set(row.Code, { pe: num(row.PEratio) || null, dividendYield: num(row.DividendYield), pb: num(row.PBratio) })
        }
      } else {
        // OpenAPI 失敗（被擋、回 HTML）改抓網站版；欄位：代號、名稱、收盤價、殖利率、股利年度、本益比、股價淨值比、財報年/季
        if (twse.status === 'rejected') console.error('上市估值（OpenAPI）失敗，改用網站版：', twse.reason?.message)
        try {
          const payload = await fetchJson(`${URLS.twseValuationDaily}?response=json&selectType=ALL`)
          for (const row of payload?.stat === 'OK' ? payload.data || [] : []) {
            map.set(row[0], { pe: num(row[5]) || null, dividendYield: num(row[3]), pb: num(row[6]) })
          }
        } catch (error) {
          console.error('上市估值（網站版）也失敗：', error.message)
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

  // 代號 → 產業別代碼。原始資料約 1.7MB（含地址、董事長等），只留產業別，記憶體裡是一張小對照表。
  // 抓不到就是空的 Map：估值退回全市場比較，不影響其他功能
  function loadIndustries() {
    return cached('industries', TTL_INDUSTRY, async () => {
      const [twse, tpex] = await Promise.allSettled([fetchJson(URLS.twseCompanies), fetchJson(URLS.tpexCompanies)])
      const map = new Map()
      if (twse.status === 'fulfilled') {
        for (const row of twse.value || []) if (row['公司代號'] && row['產業別']) map.set(row['公司代號'], String(row['產業別']).trim())
      }
      if (tpex.status === 'fulfilled') {
        for (const row of tpex.value || []) {
          if (row.SecuritiesCompanyCode && row.SecuritiesIndustryCode) map.set(row.SecuritiesCompanyCode, String(row.SecuritiesIndustryCode).trim())
        }
      }
      return map
    })
  }

  // 這檔的估值，以及在全體上市櫃公司裡的百分位（本益比高於多少比例的公司）。
  // industry：同產業的百分位。金融股本益比天生低、科技股天生高，和全市場比會一直被判便宜或偏貴，判讀以同產業為準
  async function getValuation(code) {
    const [map, industries] = await Promise.all([loadValuation(), loadIndustries().catch(() => new Map())])
    const own = map.get(code)
    if (!own) return null
    const percentileIn = (codes, key, value, minCount) => {
      if (value === null || value === undefined) return null
      const all = codes.map((c) => map.get(c)?.[key]).filter((v) => v !== null && v !== undefined && v > 0)
      if (all.length < minCount) return null
      return round((all.filter((v) => v < value).length / all.length) * 100, 0)
    }
    const allCodes = [...map.keys()]
    const industryCode = industries.get(code) ?? null
    const peers = industryCode ? allCodes.filter((c) => industries.get(c) === industryCode) : []
    const peerCount = peers.filter((c) => (map.get(c)?.pe ?? 0) > 0).length
    const industry =
      industryCode && INDUSTRY_LABELS[industryCode] && peerCount >= MIN_INDUSTRY_PEERS
        ? {
            code: industryCode,
            label: INDUSTRY_LABELS[industryCode],
            // 有本益比（獲利）的同產業公司數
            count: peerCount,
            pePercentile: percentileIn(peers, 'pe', own.pe, MIN_INDUSTRY_PEERS),
            yieldPercentile: percentileIn(peers, 'dividendYield', own.dividendYield, MIN_INDUSTRY_PEERS),
            pbPercentile: percentileIn(peers, 'pb', own.pb, MIN_INDUSTRY_PEERS),
          }
        : null
    return {
      pe: own.pe,
      dividendYield: own.dividendYield,
      pb: own.pb,
      pePercentile: percentileIn(allCodes, 'pe', own.pe, 50),
      yieldPercentile: percentileIn(allCodes, 'dividendYield', own.dividendYield, 50),
      pbPercentile: percentileIn(allCodes, 'pb', own.pb, 50),
      industry,
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

  // 選股用：全市場的估值 Map<代號, { pe, dividendYield, pb }>
  function getValuationMap() {
    return loadValuation()
  }

  // 選股用：全市場三大法人的連買／連賣天數 Map<代號, { foreign, trust }>（正數連買、負數連賣）。
  // 上市用最近幾個交易日的 T86；上櫃免費資料只有最新一日，最多算 1 日
  async function getChipStreaks(dates) {
    const recent = dates.slice(-(CHIP_DAYS + 2))
    const days = (await Promise.all(recent.map(async (date) => loadT86(date).catch(() => null)))).filter(Boolean).slice(-CHIP_DAYS)
    const result = new Map()
    const codes = new Set(days.flatMap((day) => [...day.keys()]))
    for (const code of codes) {
      const series = (key) => days.map((day) => day.get(code)?.[key] ?? 0)
      result.set(code, { foreign: streak(series('foreign')), trust: streak(series('trust')) })
    }
    try {
      for (const [code, row] of await loadTpexInsti()) {
        if (!result.has(code)) result.set(code, { foreign: Math.sign(row.foreign || 0), trust: Math.sign(row.trust || 0) })
      }
    } catch (error) {
      console.error('上櫃三大法人失敗：', error.message)
    }
    return { streaks: result, days: days.length }
  }

  return { getChips, getValuation, getValuationMap, getChipStreaks }
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

// volumeLots：同一段日子的總成交量（張，個股才有）。用來算淨買賣超佔成交量幾 %（volumePct），
// 讓操作建議分得出「真的在買」和雜訊（台積電一天幾萬張，外資淨買幾百張不算數）
function describeChips(chips, priceChange5d, { volumeLots = null } = {}) {
  if (!chips) return null
  const label = (name, values) => {
    const s = streak(values)
    const total = round(sum(values), 1)
    const volumePct = chips.unit === '張' && volumeLots > 0 ? round((total / volumeLots) * 100, 2) : null
    const dir = total > 0 ? '買超' : total < 0 ? '賣超' : '持平'
    // 連買賣方向和合計相反時（例如 5 日合計賣超、最近 2 天買超）寫成「最近連續」，免得一句話前後看起來矛盾
    const against = Math.sign(s) !== 0 && Math.sign(s) !== Math.sign(total)
    const streakText = Math.abs(s) >= 2 ? `，${against ? '最近' : ''}連續 ${Math.abs(s)} 日${s > 0 ? '買超' : '賣超'}` : ''
    return { name, total, streak: s, volumePct, text: `${name}${chips.dates.length > 1 ? ` ${chips.dates.length} 日` : ''}${dir} ${Math.abs(total).toLocaleString('en-US')} ${chips.unit}${streakText}` }
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

// 判讀用哪一組百分位：有同產業的就用同產業，否則全市場。scope 是放進句子的比較對象
function valuationBasis(valuation) {
  const industry = valuation?.industry
  if (industry && (industry.pePercentile !== null || industry.yieldPercentile !== null)) {
    return {
      pePercentile: industry.pePercentile,
      yieldPercentile: industry.yieldPercentile,
      scope: `同產業（${industry.label}）`,
    }
  }
  return { pePercentile: valuation?.pePercentile ?? null, yieldPercentile: valuation?.yieldPercentile ?? null, scope: '上市櫃' }
}

function describeValuation(valuation) {
  if (!valuation) return null
  const { pePercentile, yieldPercentile, scope } = valuationBasis(valuation)
  const notes = []
  if (valuation.pe === null) notes.push('沒有本益比（近四季虧損或資料缺）')
  else if (pePercentile !== null && pePercentile >= 85)
    notes.push(`本益比 ${valuation.pe} 倍，高於 ${pePercentile}% 的${scope}公司，估值偏貴`)
  else if (pePercentile !== null && pePercentile <= 20)
    notes.push(`本益比 ${valuation.pe} 倍，低於 ${100 - pePercentile}% 的${scope}公司，估值偏便宜`)
  if (valuation.dividendYield !== null && yieldPercentile !== null && yieldPercentile >= 80)
    notes.push(`殖利率 ${valuation.dividendYield}%，高於 ${yieldPercentile}% 的${scope}公司，屬於高殖利率`)
  return { notes, expensive: pePercentile !== null && pePercentile >= 85, scope }
}

module.exports = { createTwseData, describeChips, describeValuation, valuationBasis, streak, CHIP_DAYS, INDUSTRY_LABELS }
