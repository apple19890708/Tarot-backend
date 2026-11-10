// 市場資料：依問題查出相關標的的報價與技術指標，交給 AI 解讀使用。
//
// 資料來源（都不需要金鑰）：
// - 證交所 MIS 即時報價（非正式介面，約延遲 20 秒）：台股上市／上櫃個股、加權與櫃買指數
// - Yahoo Finance chart（非正式介面）：日 K 歷史資料，用來算均線、RSI、KD、MACD；美股報價也從這裡來
// - 證交所 OpenAPI、櫃買中心 OpenAPI：上市／上櫃股票清單，用來把公司名稱對應到代號
//
// 任何一個來源失敗都只會少一部分資料，不會讓 AI 解讀失敗；全部失敗時 snapshot 會帶 notes 說明。
const { dateTimeFormat } = require('../../lib/intlFormat')
const { computeIndicators, round } = require('./indicators')
const { buildSignals } = require('./signals')
const { computeSeries, aggregateSeries } = require('./series')
const { backtestSignals, backtestStrategies } = require('./backtest')
const { predictDirection } = require('./prediction')
const { buildAdvice } = require('./advice')
const { buildLongTermAdvice } = require('./longTermAdvice')
const { isEtf } = require('./portfolio')
const { createTwseData, describeChips, describeValuation } = require('./twseData')

// 機器學習的大盤特徵：台股個股用加權指數、美股個股用標普 500
const CONTEXT_INDEX = {
  tw: { symbol: '^TWII', label: '大盤' },
  us: { symbol: '^GSPC', label: '標普 500' },
}

// 圖表能看的範圍：日 K 約一年、週 K 約三年、月 K 是抓到的全部（5 年）
const CHART_DAYS = 250
const CHART_WEEKS = 156
const CHART_MONTHS = 60
// 少於這麼多根 K 棒（約一年）就不做回測與預測，樣本太少的統計只會誤導
const MIN_RESEARCH_BARS = 250
const { buildNameIndex, findMarketTargets, resolveTargetIn, searchTargets: searchLocalTargets, US_SYMBOL_PATTERN } = require('./symbols')

const corporateEvents = require('./corporateEvents')
const income = require('./income')
const exDividendReminder = require('./exDividendReminder')
const taifex = require('./taifex')
const macro = require('./macro')
const tpexIndex = require('./tpexIndex')
const dailyPicks = require('./dailyPicks')
const screener = require('./screener')
// 大盤概況與選股用的全市場收盤資料、類股指數：一天只變一次，快取 30 分鐘
const DAILY_TTL = 30 * 60 * 1000
const LISTED_CODE_PATTERN = /^(\d{4}|00\d{2,4}[A-Z]?)$/
const OVERVIEW_TTL = 10 * 60 * 1000
// 美國總經數據每月公布一次，快取 6 小時；全部抓不到時 1 分鐘後再試（FAILURE_TTL）
const MACRO_TTL = 6 * 60 * 60 * 1000
const MI_INDEX_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX'
const OVERVIEW_TARGETS = {
  tw: [
    { kind: 'index', market: 'tw', code: 't00', exchange: 'tse', symbol: '^TWII', name: '加權指數' },
    // Yahoo 沒有櫃買指數（symbol 是 null）；走勢彈窗用櫃買中心的日線，代號是 chartSymbol
    { kind: 'index', market: 'tw', code: 'o00', exchange: 'otc', symbol: null, chartSymbol: tpexIndex.CHART_SYMBOL, name: '櫃買指數' },
  ],
  // group：畫面分組；note：給沒學過的人看的一句話；unit：數字的單位（殖利率是 %）
  us: [
    { kind: 'index', market: 'us', symbol: '^GSPC', name: '標普 500', group: 'index', note: '美國 500 家大公司，最常拿來代表美股整體' },
    { kind: 'index', market: 'us', symbol: '^IXIC', name: '那斯達克', group: 'index', note: '科技股比重高，看科技股的氣氛' },
    { kind: 'index', market: 'us', symbol: '^DJI', name: '道瓊工業', group: 'index', note: '30 家老牌大公司' },
    { kind: 'index', market: 'us', symbol: '^RUT', name: '羅素 2000', group: 'index', note: '2000 家中小型公司，反映美國國內景氣' },
    { kind: 'index', market: 'us', symbol: '^SOX', name: '費城半導體', group: 'tw', note: '半導體股，和台股電子股連動最緊' },
    { kind: 'stock', market: 'us', symbol: 'TSM', name: '台積電 ADR', group: 'tw', note: '台積電在美國掛牌的股票，常用來預估台股隔天開盤' },
    { kind: 'index', market: 'us', symbol: 'TWD=X', name: '美元兌台幣', group: 'tw', note: '1 美元換多少台幣；數字變大代表台幣變弱，外資可能在匯出' },
    { kind: 'index', market: 'us', symbol: '^VIX', name: '恐慌指數 VIX', group: 'mood', note: '越高代表市場越緊張；20 以下算平靜，30 以上算恐慌' },
    { kind: 'index', market: 'us', symbol: '^TNX', name: '美國 10 年期公債殖利率', group: 'mood', unit: '%', note: '升高時股票（尤其科技股）通常比較有壓力' },
    { kind: 'index', market: 'us', symbol: 'DX-Y.NYB', name: '美元指數', group: 'mood', note: '美元對歐元、日圓等主要貨幣的強弱，越高代表美元越強' },
  ],
}
// 除權息預告與月營收一天變動很少，快取 6 小時；抓不到時 10 分鐘後再試
const EVENTS_TTL = 6 * 60 * 60 * 1000
const EVENTS_FAILURE_TTL = 10 * 60 * 1000
// 個股分析的單檔快照
const TARGET_SNAPSHOT_TTL = 10 * 60 * 1000

// 美股搜尋只收美國交易所的股票、ETF 與指數（Yahoo 的 exchange 代碼）
const US_EXCHANGES = new Set(['NMS', 'NGM', 'NCM', 'NYQ', 'ASE', 'PCX', 'BTS', 'NAS', 'NYS', 'SNP', 'DJI', 'NIM', 'WCB'])
const US_QUOTE_TYPES = new Set(['EQUITY', 'ETF', 'INDEX'])
const SEARCH_LIMIT = 10

// 自訂追蹤：迷你走勢圖畫最近這麼多個交易日；52 週約 250 個交易日
const SPARK_DAYS = 60
const YEAR_BARS = 250

const URLS = {
  twseList: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
  tpexList: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
  mis: 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp',
  yahooChart: 'https://query1.finance.yahoo.com/v8/finance/chart/',
  // 證交所休市日（今年）
  twseHolidays: 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule',
  // 非正式介面，只用來給美股輸入框的候選
  yahooSearch: 'https://query1.finance.yahoo.com/v1/finance/search',
}

const TTL = {
  directory: 12 * 60 * 60 * 1000,
  history: 5 * 60 * 1000,
  search: 10 * 60 * 1000,
  realtime: 20 * 1000,
}

const REQUEST_TIMEOUT_MS = 8000
// 大盤概況每個區塊最多等這麼久，超過就先不放那一塊（還在跑的請求照樣跑完、填進快取）。
// 2026-11-07 線上（Render）的大盤概況卡住超過 2 分鐘、本機正常：單一來源在 Render 上沒回應時不能拖住整個概況
const OVERVIEW_SECTION_TIMEOUT_MS = 15000
const TW_TIMEZONE = 'Asia/Taipei'

// promise 超過 ms 還沒結束就以逾時失敗（不取消原本的工作）
function withDeadline(promise, ms, label) {
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}逾時（${ms / 1000} 秒）`)), ms)
  })
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer))
}

// 清單裡只收股票與 ETF 的代號格式，排除權證、債券這類
const CODE_PATTERN = /^\d{4,6}[A-Z]?$/

function toNumber(value) {
  if (value === null || value === undefined) {
    return null
  }
  const number = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(number) && String(value).trim() !== '' && value !== '-' ? number : null
}

// 某個時間點在指定時區的日期（YYYY-MM-DD）
function dateIn(timeZone, date) {
  return dateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

// 快取最多這麼多筆；超過時先清掉過期的，還是太多就丟最舊的（Map 依插入順序）
const CACHE_MAX_ENTRIES = 500
// 搜尋候選用另一個小快取，避免大量不同的查詢字把股票清單與歷史資料擠掉
const SEARCH_CACHE_MAX_ENTRIES = 200
// 外部來源失敗（含查無代號）時，這段時間內不再重打，避免被限流時越打越糟
const FAILURE_TTL = 60 * 1000
// 自訂追蹤一次最多同時查幾檔的歷史資料
const WATCH_CONCURRENCY = 5
// 選股技術面的歷史資料快取筆數（每筆 6 個月日 K，很小）
const SCREEN_CACHE_MAX_ENTRIES = 300
// 獲利與股利（v20）的歷史股利：一檔一筆、一天變動很少，快取 24 小時；獨立的快取，不擠掉共用快取的全市場資料
const DIVIDEND_CACHE_MAX_ENTRIES = 400
const DIVIDEND_TTL = 24 * 60 * 60 * 1000
const DIVIDEND_FAILURE_TTL = 10 * 60 * 1000
// 一位使用者最多 30 檔，同時最多抓這麼多檔
const DIVIDEND_CONCURRENCY = 4

function createCache(now, maxEntries = CACHE_MAX_ENTRIES) {
  const store = new Map()
  return {
    get(key) {
      const hit = store.get(key)
      return hit && hit.expires > now() ? hit.value : undefined
    },
    // 過期但還留著的值：來源失敗時退回舊資料
    stale(key) {
      return store.get(key)?.value
    },
    set(key, value, ttl) {
      store.delete(key)
      store.set(key, { value, expires: now() + ttl })
      if (store.size > maxEntries) {
        for (const [k, hit] of store) {
          if (hit.expires <= now()) store.delete(k)
        }
        while (store.size > maxEntries) {
          store.delete(store.keys().next().value)
        }
      }
    },
  }
}

class SymbolNotFoundError extends Error {}

function createMarketService({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const cache = createCache(now)
  const searchCache = createCache(now, SEARCH_CACHE_MAX_ENTRIES)
  // 選股技術面用的短期歷史（6 個月）：獨立的小快取，避免把共用快取裡的全市場資料擠掉
  const screenCache = createCache(now, SCREEN_CACHE_MAX_ENTRIES)
  const dividendCache = createCache(now, DIVIDEND_CACHE_MAX_ENTRIES)
  // 進行中的全市場資料請求（快取剛過期時，同時進來的請求共用同一次下載）
  const inFlight = new Map()
  function once(key, load) {
    if (inFlight.has(key)) return inFlight.get(key)
    const promise = load().finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }
  // 進行中的歷史資料請求：同一檔同時被查時共用同一個請求
  const historyInFlight = new Map()
  // twseData 用的 fetchJson 在下面定義，這裡延後取用
  let twseData = null
  const getTwseData = () => {
    twseData =
      twseData || createTwseData({ fetchJson: (url) => fetchJson(url), cache, today: () => dateIn(TW_TIMEZONE, new Date(now())) })
    return twseData
  }

  // init：要 POST 時傳 { method, body, headers }（期交所的行情 API）
  async function fetchJson(url, init = {}) {
    const response = await fetchImpl(url, {
      ...init,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TarotMarket/1.0)', Accept: 'application/json', ...init.headers },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (response.status === 404) {
      throw new SymbolNotFoundError(url)
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${url}`)
    }
    return response.json()
  }

  // ---- 股票清單 ----

  async function loadDirectory() {
    const cached = cache.get('directory')
    if (cached) {
      return cached
    }

    const [twse, tpex] = await Promise.allSettled([fetchJson(URLS.twseList), fetchJson(URLS.tpexList)])
    const entries = []
    if (twse.status === 'fulfilled' && Array.isArray(twse.value)) {
      for (const row of twse.value) {
        if (CODE_PATTERN.test(row.Code) && row.Name) {
          entries.push({ code: row.Code, name: row.Name.trim(), exchange: 'tse' })
        }
      }
    }
    if (tpex.status === 'fulfilled' && Array.isArray(tpex.value)) {
      for (const row of tpex.value) {
        if (CODE_PATTERN.test(row.SecuritiesCompanyCode) && row.CompanyName) {
          entries.push({ code: row.SecuritiesCompanyCode, name: row.CompanyName.trim(), exchange: 'otc' })
        }
      }
    }

    if (entries.length === 0) {
      // 兩個來源都失敗：有舊清單就先用舊的，沒有就只能辨識指數與美股
      const stale = cache.stale('directory')
      if (stale) {
        return stale
      }
      console.error('股票清單載入失敗：', twse.reason?.message, tpex.reason?.message)
      return { entries: [], nameIndex: [] }
    }

    const directory = { entries, nameIndex: buildNameIndex(entries) }
    cache.set('directory', directory, TTL.directory)
    return directory
  }

  // ---- 日 K 歷史（Yahoo）----

  async function loadHistory(symbol) {
    const key = `history:${symbol}`
    const cached = cache.get(key)
    if (cached) {
      return cached
    }
    const failed = cache.get(`history-failed:${symbol}`)
    if (failed) {
      throw failed
    }
    if (historyInFlight.has(symbol)) {
      return historyInFlight.get(symbol)
    }
    const request = fetchHistory(symbol, key)
      .catch((error) => {
        cache.set(`history-failed:${symbol}`, error, FAILURE_TTL)
        throw error
      })
      .finally(() => historyInFlight.delete(symbol))
    historyInFlight.set(symbol, request)
    return request
  }

  async function fetchHistory(symbol, key) {

    // 5 年日 K：指標只需要最近幾個月，回測與機器學習需要比較長的歷史
    const payload = await fetchJson(`${URLS.yahooChart}${encodeURIComponent(symbol)}?range=5y&interval=1d`)
    const result = payload?.chart?.result?.[0]
    if (!result) {
      throw new SymbolNotFoundError(symbol)
    }

    const timezone = result.meta?.exchangeTimezoneName || 'UTC'
    const quote = result.indicators?.quote?.[0] || {}
    const bars = (result.timestamp || [])
      .map((ts, i) => ({
        date: dateIn(timezone, new Date(ts * 1000)),
        open: quote.open?.[i],
        high: quote.high?.[i],
        low: quote.low?.[i],
        close: quote.close?.[i],
        volume: quote.volume?.[i],
      }))
      .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))

    const period = result.meta?.currentTradingPeriod?.regular
    const history = {
      bars,
      timezone,
      currency: result.meta?.currency || null,
      name: result.meta?.shortName || result.meta?.longName || null,
      price: toNumber(result.meta?.regularMarketPrice),
      time: result.meta?.regularMarketTime ? new Date(result.meta.regularMarketTime * 1000).toISOString() : null,
      regularStart: period?.start ? period.start * 1000 : null,
      regularEnd: period?.end ? period.end * 1000 : null,
    }
    cache.set(key, history, TTL.history)
    return history
  }

  // ---- 台股即時（證交所 MIS）----

  async function loadRealtime(twTargets) {
    if (twTargets.length === 0) {
      return new Map()
    }
    const channels = twTargets.map((target) => `${target.exchange}_${target.code}.tw`)
    const key = `realtime:${channels.join('|')}`
    const cached = cache.get(key)
    if (cached) {
      return cached
    }

    const payload = await fetchJson(`${URLS.mis}?ex_ch=${encodeURIComponent(channels.join('|'))}&json=1&delay=0`)
    const quotes = new Map()
    for (const row of payload?.msgArray || []) {
      // 還沒有成交時 z 是「-」，改用最佳買價，再不行就用昨收
      const bestBid = toNumber(String(row.b || '').split('_')[0])
      const price = toNumber(row.z) ?? bestBid ?? toNumber(row.y)
      if (price === null) {
        continue
      }
      quotes.set(`${row.ex}_${row.c}`, {
        name: row.n || null,
        price,
        prevClose: toNumber(row.y),
        open: toNumber(row.o),
        high: toNumber(row.h),
        low: toNumber(row.l),
        // 上市個股單位是「張」，指數是成交金額（百萬元），兩者不混用，只留著顯示
        volume: toNumber(row.v),
        date: row.d ? `${row.d.slice(0, 4)}-${row.d.slice(4, 6)}-${row.d.slice(6, 8)}` : null,
        clock: row.t || row['%'] || null,
        time: row.tlong ? new Date(Number(row.tlong)).toISOString() : null,
      })
    }
    cache.set(key, quotes, TTL.realtime)
    return quotes
  }

  // ---- 組合成一個標的的快照 ----

  function twSession(realtime, nowDate) {
    if (!realtime?.date || realtime.date !== dateIn(TW_TIMEZONE, nowDate)) {
      return 'closed'
    }
    const clock = realtime.clock || ''
    return clock >= '09:00:00' && clock < '13:30:00' ? 'intraday' : 'closed'
  }

  // extras：{ context: { label, series }, chips, valuation, revenue, light }，都可以省略
  // light：自訂追蹤用的輕量版，只算報價與技術指標，不做回測、預測、圖表與操作建議
  function buildItem(target, history, realtime, extras = {}) {
    const light = extras.light === true
    // detail：自訂追蹤展開卡片用，有圖表與籌碼，但不做回測、預測與操作建議（太慢，也和股市諮詢的結論重複）
    const detail = extras.detail === true
    const nowDate = new Date(now())
    let bars = history ? history.bars.map((bar) => ({ ...bar })) : []

    // 即時報價併進最後一根 K 棒：同一天就以即時報價的開高低收與成交量為準（Yahoo 當天那根常常不完整、成交量是 0），新的一天就補一根。
    // 證交所的成交量單位是張，Yahoo 是股，換成股才能和前幾天比
    if (realtime?.date) {
      const last = bars[bars.length - 1]
      // 指數的 v 是成交金額不是張數，不併
      const liveVolume = target.kind !== 'index' && Number.isFinite(realtime.volume) ? realtime.volume * 1000 : null
      if (last && last.date === realtime.date) {
        if (Number.isFinite(realtime.open)) last.open = realtime.open
        last.close = realtime.price
        last.high = Math.max(last.high, realtime.high ?? realtime.price)
        last.low = Math.min(last.low, realtime.low ?? realtime.price)
        if (liveVolume !== null) last.volume = Math.max(Number.isFinite(last.volume) ? last.volume : 0, liveVolume)
      } else if (!last || realtime.date > last.date) {
        bars.push({
          date: realtime.date,
          open: realtime.open ?? realtime.price,
          high: realtime.high ?? realtime.price,
          low: realtime.low ?? realtime.price,
          close: realtime.price,
          volume: liveVolume,
        })
      }
    }

    const last = bars[bars.length - 1]
    const price = realtime?.price ?? history?.price ?? last?.close ?? null
    if (price === null) {
      return null
    }

    // 昨收：即時報價有就用它；否則用倒數第二根 K 棒
    const prevClose = realtime?.prevClose ?? (bars.length >= 2 ? bars[bars.length - 2].close : null)
    const change = prevClose !== null ? price - prevClose : null

    let session = 'closed'
    if (target.market === 'tw' && realtime) {
      session = twSession(realtime, nowDate)
    } else if (history?.regularStart && history?.regularEnd) {
      session = now() >= history.regularStart && now() < history.regularEnd ? 'intraday' : 'closed'
    }

    // 少於 20 根 K 棒的指標沒有意義（例如櫃買指數只有即時報價）
    const indicators = bars.length >= 20 ? computeIndicators(bars) : null
    const analysis = buildSignals({ price: round(price), indicators, intraday: session === 'intraday' })
    // light 不做回測、預測與圖表，用不到序列
    const series = !light && bars.length >= 20 ? computeSeries(bars) : null

    const item = {
      symbol: target.symbol,
      code: target.code || null,
      exchange: target.exchange || null,
      name: target.market === 'tw' ? target.name : history?.name || target.name,
      market: target.market,
      kind: target.kind,
      currency: target.market === 'tw' ? 'TWD' : history?.currency || 'USD',
      session,
      source: realtime ? 'twse-mis' : 'yahoo',
      quote: {
        price: round(price),
        prevClose: round(prevClose),
        change: round(change),
        changePct: prevClose ? round((change / prevClose) * 100) : null,
        open: round(realtime?.open ?? last?.open ?? null),
        high: round(realtime?.high ?? last?.high ?? null),
        low: round(realtime?.low ?? last?.low ?? null),
        time: realtime?.time || history?.time || null,
        date: last?.date || realtime?.date || null,
        // 最新一根的成交量（股；台股畫面上換成張）。股市總覽的表格檢視用
        volume: Number.isFinite(last?.volume) ? last.volume : null,
      },
      // 少於 20 根 K 棒的指標沒有意義（例如櫃買指數只有即時報價）
      indicators,
      // 判讀標籤與支撐壓力：畫面與 AI 用同一份
      analysis,
      // 歷史回測、策略比較、機器學習預測（資料不足一年時為 null）
      research:
        !light && !detail && series && analysis && bars.length >= MIN_RESEARCH_BARS
          ? {
              backtest: backtestSignals(series, analysis.signals),
              strategies: backtestStrategies(series, target.market, { etf: isEtf(target) }),
              prediction: predictDirection(series, { context: extras.context || null }),
            }
          : null,
      chart: !light && series ? buildChart(series) : null,
      // 籌碼面（台股才有）：三大法人與融資融券，summary 是判讀文字
      chips: extras.chips
        ? { ...extras.chips, summary: describeChips(extras.chips, indicators?.change5d ?? null, { volumeLots: chipVolumeLots(extras.chips, bars) }) }
        : null,
      // 估值（台股個股才有）：本益比、殖利率、股價淨值比與在全體上市櫃的百分位
      valuation: extras.valuation ? { ...extras.valuation, summary: describeValuation(extras.valuation) } : null,
      barCount: bars.length,
    }
    // 操作建議要用到上面的全部資料，最後才算；輕量版缺回測與籌碼，算出來會不一致，所以不算
    item.advice = light || detail ? null : buildAdvice(item, { context: extras.context || null })
    // 長期建議（規格 H）：年線、大盤、買進持有年化、估值、月營收；歷史不到約一年時是 null
    if (item.advice) {
      item.advice.longTerm = buildLongTermAdvice({
        series,
        price: item.quote.price,
        context: extras.context || null,
        strategies: item.research?.strategies ?? null,
        valuation: item.valuation,
        revenue: extras.revenue || null,
      })
    }
    if (light) {
      item.spark = bars.slice(-SPARK_DAYS).map((bar) => round(bar.close))
      item.range52w = yearRange(bars, price)
    }
    return item
  }

  // 台股的籌碼（三大法人、融資融券）與估值；不是台股回傳空的。各自失敗只少一塊
  async function loadTwExtras(target, history, realtime, { valuation: withValuation = true } = {}) {
    if (target.market !== 'tw') return { chips: null, valuation: null, chipsFailed: false }
    const dates = (history?.bars ?? []).map((bar) => bar.date)
    if (realtime?.date && (dates.length === 0 || realtime.date > dates[dates.length - 1])) dates.push(realtime.date)
    const [chips, valuation] = await Promise.allSettled([
      dates.length > 0 ? getTwseData().getChips(target, dates) : null,
      withValuation && target.kind === 'stock' ? getTwseData().getValuation(target.code) : null,
    ])
    if (chips.status === 'rejected') console.error(`籌碼資料失敗（${target.code}）：`, chips.reason?.message)
    if (valuation.status === 'rejected') console.error(`估值資料失敗（${target.code}）：`, valuation.reason?.message)
    return {
      chips: chips.status === 'fulfilled' ? chips.value : null,
      valuation: valuation.status === 'fulfilled' ? valuation.value : null,
      chipsFailed: chips.status === 'rejected',
    }
  }

  // 只給「股市諮詢」用：一定當成股市問題，問題沒寫到標的就看加權指數。
  // 一定回傳 snapshot（可能 items 為空、notes 說明原因）
  async function buildMarketSnapshot(question) {
    const directory = await loadDirectory()
    const found = findMarketTargets(question, {
      directory: directory.entries,
      nameIndex: directory.nameIndex,
      force: true,
    })
    if (!found) {
      return null
    }
    return snapshotOf(found.targets)
  }

  // 指定標的的完整快照（行情、指標、籌碼、估值、回測、預測、操作建議）。股市諮詢與個股分析共用
  async function snapshotOf(targets) {
    const notes = []
    const twTargets = targets.filter((target) => target.market === 'tw')
    const [realtimeResult, ...historyResults] = await Promise.allSettled([
      loadRealtime(twTargets),
      ...targets.map((target) => (target.symbol ? loadHistory(target.symbol) : Promise.resolve(null))),
    ])

    const realtimeMap = realtimeResult.status === 'fulfilled' ? realtimeResult.value : new Map()
    const historyOf = (index) => (historyResults[index].status === 'fulfilled' ? historyResults[index].value : null)

    // 大盤序列（機器學習特徵）、籌碼、估值：各自失敗只少一塊資料
    const contextSymbols = [
      ...new Set(targets.filter((t) => t.kind === 'stock').map((t) => CONTEXT_INDEX[t.market]?.symbol).filter(Boolean)),
    ]
    const contextEntries = await Promise.all(
      contextSymbols.map(async (symbol) => {
        try {
          const history = await loadHistory(symbol)
          return [symbol, history.bars.length >= 60 ? computeSeries(history.bars) : null]
        } catch (error) {
          console.error(`大盤歷史資料失敗（${symbol}）：`, error.message)
          return [symbol, null]
        }
      }),
    )
    const contextSeries = new Map(contextEntries)

    // 月營收（長期建議用；台股個股才有，整個市場一份、有快取）
    const hasTwStock = targets.some((t) => t.market === 'tw' && t.kind === 'stock')
    const corporate = hasTwStock ? await loadCorporateEvents().catch(() => null) : null

    const twExtras = await Promise.all(
      targets.map(async (target, index) => {
        const realtime = realtimeMap.get(`${target.exchange}_${target.code}`)
        const extras = await loadTwExtras(target, historyOf(index), realtime)
        if (extras.chipsFailed) notes.push(`${target.name} 的籌碼資料暫時取不到。`)
        return { chips: extras.chips, valuation: extras.valuation }
      }),
    )
    if (realtimeResult.status === 'rejected' && twTargets.length > 0) {
      console.error('台股即時報價失敗：', realtimeResult.reason?.message)
      notes.push('台股即時報價暫時取不到，改用 Yahoo 的報價（可能延遲約 20 分鐘）。')
    }

    const items = []
    targets.forEach((target, index) => {
      const historyResult = historyResults[index]
      const history = historyResult.status === 'fulfilled' ? historyResult.value : null
      if (historyResult.status === 'rejected') {
        if (historyResult.reason instanceof SymbolNotFoundError && target.market === 'us') {
          // 英文代號比對比較寬鬆，查不到就當成不是代號，不必特別說明
          if (target.name !== target.symbol) {
            notes.push(`查不到 ${target.name}（${target.symbol}）的資料。`)
          }
          return
        }
        console.error(`歷史資料失敗（${target.symbol}）：`, historyResult.reason?.message)
        notes.push(`${target.name} 的歷史資料暫時取不到，技術指標從缺。`)
      }

      const realtime = target.market === 'tw' ? realtimeMap.get(`${target.exchange}_${target.code}`) : null
      const contextInfo = target.kind === 'stock' ? CONTEXT_INDEX[target.market] : null
      const context = contextInfo && contextSeries.get(contextInfo.symbol)
        ? { label: contextInfo.label, series: contextSeries.get(contextInfo.symbol) }
        : null
      const revenue = corporate && target.market === 'tw' && target.kind === 'stock' ? (corporate.revenue.get(target.code) ?? null) : null
      const item = buildItem(target, history, realtime, { ...twExtras[index], context, revenue })
      if (item) {
        items.push(item)
      } else {
        notes.push(`${target.name} 目前查不到報價。`)
      }
    })

    return { asOf: new Date(now()).toISOString(), items, notes }
  }

  // 個股分析彈窗：單一標的的完整快照，加上除權息與月營收。結果快取 10 分鐘（不含個人持股，所有人共用）
  async function buildTargetSnapshot(target) {
    const key = `target-snapshot:${target.symbol || `${target.exchange}_${target.code}`}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    return once(key, async () => {
      const isTwStock = target.market === 'tw' && target.kind === 'stock' && target.code
      const isStock = target.kind === 'stock' && target.symbol
      const [snapshot, events, dividendHistory] = await Promise.all([
        snapshotOf([target]),
        isTwStock ? loadCorporateEvents().catch(() => null) : null,
        isStock ? loadDividendHistory(target.symbol, target.market) : null,
      ])
      const today = dateIn(TW_TIMEZONE, new Date(now()))
      // 除權息分頁：歷年除權息、殖利率、填息（日 K 在 snapshotOf 已經快取過）
      let dividendRecords = null
      if (isStock && dividendHistory) {
        const bars = await loadHistory(target.symbol).then((h) => h.bars).catch(() => null)
        // 附加資訊：算失敗（資料格式異常）只是沒有這個分頁，不能讓整個個股分析 500
        try {
          dividendRecords = income.buildDividendRecords({ history: dividendHistory, bars, market: target.market, today })
        } catch (error) {
          console.error(`除權息紀錄失敗（${target.symbol}）：`, error.message)
        }
      }
      const result = {
        ...snapshot,
        items: snapshot.items.map((item, index) => (index === 0 && isStock ? { ...item, dividendRecords } : item)),
        events: events && isTwStock ? corporateEvents.eventsFor(target.code, events, today) : null,
      }
      // 完全查不到報價時只快取 1 分鐘，稍後可以重試
      cache.set(key, result, result.items.length > 0 ? TARGET_SNAPSHOT_TTL : FAILURE_TTL)
      return result
    })
  }

  // 單一標的的最新價格（價位提醒用）：台股優先用證交所即時報價，其次 Yahoo
  async function getQuote(target) {
    if (target.market === 'tw' && target.code && target.exchange) {
      try {
        const realtime = (await loadRealtime([target])).get(`${target.exchange}_${target.code}`)
        if (realtime) return { price: realtime.price, time: realtime.time }
      } catch (error) {
        console.error('提醒的即時報價失敗：', error.message)
      }
    }
    if (!target.symbol) return null
    const history = await loadHistory(target.symbol)
    const last = history.bars[history.bars.length - 1]
    const price = history.price ?? last?.close ?? null
    return price === null ? null : { price, time: history.time }
  }

  // 標的的日 K（自動對答案用）
  async function getHistoryBars(symbol) {
    return (await loadHistory(symbol)).bars
  }

  // 依使用者輸入找標的。
  // 沒指定市場（手動新增提醒）：和股市諮詢用同一套辨識，取第一個。
  // 指定市場（自訂追蹤）：只在該市場找；美股另外查一次歷史資料確認代號存在，並補上正式名稱
  async function resolveTarget(query, market = null) {
    const directory = await loadDirectory()
    if (!market) {
      const found = findMarketTargets(query, { directory: directory.entries, nameIndex: directory.nameIndex, force: false })
      return found?.targets[0] ?? null
    }
    const target = resolveTargetIn(query, market, { directory: directory.entries, nameIndex: directory.nameIndex })
    if (!target || market !== 'us') return target
    try {
      const history = await loadHistory(target.symbol)
      return target.name === target.symbol && history.name ? { ...target, name: history.name } : target
    } catch (error) {
      if (error instanceof SymbolNotFoundError) return null
      throw error
    }
  }

  // 輸入框的下拉候選。台股只查本機清單；美股先列常用中文名與指數，再補 Yahoo 搜尋（失敗就只有本機的）
  async function searchTargets(query, market) {
    const directory = await loadDirectory()
    const local = searchLocalTargets(query, market, { directory: directory.entries, limit: SEARCH_LIMIT })
    if (market !== 'us' || !/^[\w .&-]{1,30}$/.test(query)) return local

    const key = `search:${query.toUpperCase()}`
    let remote = searchCache.get(key)
    if (!remote) {
      try {
        const payload = await fetchJson(`${URLS.yahooSearch}?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`)
        remote = (payload?.quotes || [])
          .filter((q) => US_EXCHANGES.has(q.exchange) && US_QUOTE_TYPES.has(q.quoteType) && US_SYMBOL_PATTERN.test(q.symbol || ''))
          .map((q) => ({
            kind: q.quoteType === 'INDEX' ? 'index' : 'stock',
            market: 'us',
            symbol: q.symbol,
            name: q.shortname || q.longname || q.symbol,
          }))
        searchCache.set(key, remote, TTL.search)
      } catch (error) {
        console.error('美股搜尋失敗：', error.message)
        remote = []
        searchCache.set(key, remote, FAILURE_TTL)
      }
    }
    const seen = new Set(local.map((t) => t.symbol))
    return [...local, ...remote.filter((t) => !seen.has(t.symbol))].slice(0, SEARCH_LIMIT)
  }

  // 全市場最新一日收盤（上市 STOCK_DAY_ALL、上櫃收盤行情）：Map<代號, { code, name, exchange, open, high, low, close, change, changePct, volume（張）, date }>
  async function loadDailyQuotes() {
    const cached = cache.get('daily-quotes')
    if (cached) return cached
    const failed = cache.get('daily-quotes-failed')
    if (failed) throw failed
    return once('daily-quotes', () =>
      fetchDailyQuotes().catch((error) => {
        // 兩邊都失敗時 1 分鐘內不重打
        cache.set('daily-quotes-failed', error, FAILURE_TTL)
        throw error
      }),
    )
  }

  async function fetchDailyQuotes() {
    const [twse, tpex] = await Promise.allSettled([fetchJson(URLS.twseList), fetchJson(URLS.tpexList)])
    const map = new Map()
    const add = (row) => {
      // 只收股票（4 碼）與 ETF（00 開頭），排除權證、ETN 這類 6 碼的商品
      if (row.close === null || !LISTED_CODE_PATTERN.test(row.code)) return
      const prev = row.change === null ? null : row.close - row.change
      map.set(row.code, { ...row, changePct: prev ? round((row.change / prev) * 100) : null })
    }
    if (twse.status === 'fulfilled') {
      for (const r of twse.value || []) {
        add({ code: r.Code, name: (r.Name || '').trim(), exchange: 'tse', open: toNumber(r.OpeningPrice), high: toNumber(r.HighestPrice), low: toNumber(r.LowestPrice), close: toNumber(r.ClosingPrice), change: toNumber(r.Change), volume: toNumber(r.TradeVolume) === null ? null : Math.round(toNumber(r.TradeVolume) / 1000), date: corporateEvents.rocDate(r.Date) })
      }
    } else console.error('上市收盤資料失敗：', twse.reason?.message)
    if (tpex.status === 'fulfilled') {
      for (const r of tpex.value || []) {
        add({ code: r.SecuritiesCompanyCode, name: (r.CompanyName || '').trim(), exchange: 'otc', open: toNumber(r.Open), high: toNumber(r.High), low: toNumber(r.Low), close: toNumber(r.Close), change: toNumber(String(r.Change || '').trim()), volume: toNumber(r.TradingShares) === null ? null : Math.round(toNumber(r.TradingShares) / 1000), date: corporateEvents.rocDate(r.Date) })
      }
    } else console.error('上櫃收盤資料失敗：', tpex.reason?.message)
    if (map.size === 0) throw new Error('全市場收盤資料暫時取不到')
    // 只抓到一邊（例如上櫃那份資料很大、偶爾中斷）時，5 分鐘後就重抓
    const complete = twse.status === 'fulfilled' && tpex.status === 'fulfilled'
    cache.set('daily-quotes', map, complete ? DAILY_TTL : 5 * 60 * 1000)
    return map
  }

  // 類股指數的漲跌（證交所 MI_INDEX，前一個交易日收盤）
  async function loadSectors() {
    const cached = cache.get('sectors')
    if (cached) return cached
    const rows = await fetchJson(MI_INDEX_URL)
    const sectors = (rows || [])
      .filter((r) => /類指數$/.test(r['指數'] || '') && !/報酬/.test(r['指數']))
      .map((r) => ({
        name: r['指數'].replace(/類指數$/, ''),
        close: toNumber(r['收盤指數']),
        changePct: toNumber(r['漲跌百分比']),
        date: corporateEvents.rocDate(r['日期']),
      }))
      .filter((s) => s.changePct !== null)
    cache.set('sectors', sectors, DAILY_TTL)
    return sectors
  }

  // ---- 指數走勢彈窗（大盤概況的重點卡點開）：像 Google 財經，不同時間範圍的線圖＋今天的開高低 ----
  // 只開放大盤概況裡的代號，避免被拿來代查任意標的
  const INDEX_CHART_SYMBOLS = new Map(
    [...OVERVIEW_TARGETS.tw, ...OVERVIEW_TARGETS.us].filter((t) => t.symbol).map((t) => [t.symbol, t.name]),
  )
  // range → Yahoo 的 interval：1 天 5 分鐘一點、5 天 15 分鐘、1 個月～1 年每天、5 年每週
  const INDEX_CHART_RANGES = { '1d': '5m', '5d': '15m', '1mo': '1d', '6mo': '1d', ytd: '1d', '1y': '1d', '5y': '1wk' }

  async function loadYahooChart(symbol, range) {
    const key = `index-chart:${symbol}:${range}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    return once(key, async () => {
      const payload = await fetchJson(
        `${URLS.yahooChart}${encodeURIComponent(symbol)}?range=${range}&interval=${INDEX_CHART_RANGES[range]}`,
      )
      const result = payload?.chart?.result?.[0]
      if (!result) throw new SymbolNotFoundError(symbol)
      const quote = result.indicators?.quote?.[0] || {}
      const points = (result.timestamp || [])
        .map((ts, i) => ({ t: new Date(ts * 1000).toISOString(), close: quote.close?.[i], open: quote.open?.[i] }))
        .filter((p) => Number.isFinite(p.close))
      const data = { meta: result.meta || {}, points }
      // 盤中會變的短範圍快取 1 分鐘，其他 30 分鐘
      cache.set(key, data, range === '1d' || range === '5d' ? 60 * 1000 : 30 * 60 * 1000)
      return data
    })
  }

  // 台指期夜盤的分鐘走勢（當次夜盤 15:00～隔天 05:00），快取 1 分鐘
  async function getFuturesNightChart() {
    const key = 'futures-night-chart'
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    return once(key, async () => {
      const post = (url, body) =>
        fetchJson(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
      const quote = taifex.nearMonthQuote(await post(taifex.QUOTE_URL, taifex.requestBody('night')), 'night')
      if (!quote) {
        cache.set(key, null, FAILURE_TTL)
        return null
      }
      const payload = await post(taifex.CHART_URL, JSON.stringify({ SymbolID: quote.symbolId }))
      const result = { quote, points: taifex.chartPoints(payload, quote.date) }
      cache.set(key, result, 60 * 1000)
      return result
    })
  }

  // 櫃買指數一個月的日線：過去的月份不會再變，快取 1 天；這個月 10 分鐘
  async function loadTpexMonth({ year, month }, today) {
    const key = `tpex-index:${year}-${month}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    return once(key, async () => {
      const bars = tpexIndex.parseMonth(await fetchJson(tpexIndex.monthUrl(year, month)))
      const current = today.startsWith(`${year}-${String(month).padStart(2, '0')}`)
      cache.set(key, bars, current ? 10 * 60 * 1000 : 24 * 60 * 60 * 1000)
      return bars
    })
  }

  // 櫃買指數的走勢彈窗：範圍只有日線（櫃買中心沒有盤中分時），不支援的範圍改用 1 個月，回傳裡的 range 是實際用的
  async function getTpexIndexChart(range) {
    const today = dateIn(TW_TIMEZONE, new Date(now()))
    const useRange = tpexIndex.RANGES.includes(range) ? range : tpexIndex.DEFAULT_RANGE
    // 52 週高低要一年的資料，所以不管範圍都抓 13 個月（有快取）
    const months = tpexIndex.recentMonths(today, 13)
    const [monthResults, realtimeResult] = await Promise.all([
      settleLimited(months, 4, (m) => loadTpexMonth(m, today)),
      loadRealtime([OVERVIEW_TARGETS.tw[1]]).catch(() => null),
    ])
    const failed = monthResults.find((r) => r.status === 'rejected')
    if (failed) throw failed.reason
    const bars = monthResults.flatMap((r) => r.value)
    const quote = realtimeResult?.get('otc_o00') ?? null
    const realtime = quote
      ? {
          ...quote,
          time: quote.date && quote.clock ? new Date(`${quote.date}T${quote.clock}+08:00`).toISOString() : null,
        }
      : null
    return tpexIndex.buildChart(bars, realtime, useRange, today)
  }

  // options.name：不在大盤概況清單裡、但路由已確認是使用者自己追蹤的個股（股市總覽的重點卡，v19）時傳名稱進來
  async function getIndexChart(symbol, range, options = {}) {
    if (symbol === tpexIndex.CHART_SYMBOL && INDEX_CHART_RANGES[range]) return getTpexIndexChart(range)
    const name = INDEX_CHART_SYMBOLS.get(symbol) ?? options.name
    if (!name || !INDEX_CHART_RANGES[range]) return null
    // 線圖用指定範圍；今天的開盤、最高、最低、上次收盤價一律看 1 天的資料
    const [chart, today] = await Promise.all([loadYahooChart(symbol, range), range === '1d' ? null : loadYahooChart(symbol, '1d')])
    const day = today || chart
    const meta = day.meta
    const price = toNumber(meta.regularMarketPrice)
    const prevClose = toNumber(meta.previousClose ?? meta.chartPreviousClose)
    // 1 天的基準是上次收盤價；其他範圍是範圍起點的前一個收盤
    const baseline = range === '1d' ? prevClose : toNumber(chart.meta.chartPreviousClose) ?? chart.points[0]?.close ?? null
    const change = (from, to) => (from !== null && to !== null ? round(to - from) : null)
    const pct = (from, to) => (from ? round(((to - from) / from) * 100) : null)
    return {
      symbol,
      name,
      range,
      currency: meta.currency || null,
      timezone: meta.exchangeTimezoneName || null,
      time: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
      price: round(price),
      // 今天和上次收盤比
      dayChange: change(prevClose, price),
      dayChangePct: pct(prevClose, price),
      // 這個範圍的起點到現在
      baseline: round(baseline),
      rangeChange: change(baseline, price),
      rangeChangePct: pct(baseline, price),
      stats: {
        open: round(toNumber(day.points[0]?.open) ?? null),
        high: round(toNumber(meta.regularMarketDayHigh)),
        low: round(toNumber(meta.regularMarketDayLow)),
        prevClose: round(prevClose),
        high52: round(toNumber(meta.fiftyTwoWeekHigh)),
        low52: round(toNumber(meta.fiftyTwoWeekLow)),
      },
      points: chart.points.map((p) => ({ t: p.t, close: round(p.close) })),
    }
  }

  // 大盤概況：主要指數、漲跌家數、類股漲跌、三大法人、美股與匯率。各區塊各自失敗只少一塊
  async function getMarketOverview() {
    const cached = cache.get('overview')
    if (cached) return cached
    return once('overview', buildOverview)
  }

  // 美國總經數據（CPI、核心 CPI、PCE、核心 PCE、非農）：各自失敗只少那一張
  async function loadMacro() {
    const cached = cache.get('macro')
    if (cached !== undefined) return cached
    return once('macro', async () => {
      // 年增率要 13 個月以上，抓近兩年
      const from = `${Number(dateIn(TW_TIMEZONE, new Date(now())).slice(0, 4)) - 2}-01-01`
      const results = await Promise.allSettled(
        macro.SERIES.map(async (series) => {
          const response = await fetchImpl(macro.csvUrl(series.id, from), {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TarotMarket/1.0)' },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          })
          if (!response.ok) throw new Error(`${response.status} ${series.id}`)
          return macro.summarize(series, macro.parseFredCsv(await response.text()))
        }),
      )
      results.forEach((result, i) => {
        if (result.status === 'rejected') console.error(`總經數據失敗（${macro.SERIES[i].id}）：`, result.reason?.message)
      })
      const items = results.map((result) => (result.status === 'fulfilled' ? result.value : null)).filter(Boolean)
      cache.set('macro', items, items.length ? MACRO_TTL : FAILURE_TTL)
      return items
    })
  }

  async function buildOverview() {
    const notes = []
    const started = Date.now()
    const sections = [
      ['台股指數', getWatchSummaries(OVERVIEW_TARGETS.tw)],
      ['美股指數', getWatchSummaries(OVERVIEW_TARGETS.us)],
      ['漲跌家數', loadDailyQuotes()],
      ['類股漲跌', loadSectors()],
      ['加權指數歷史資料', loadHistory('^TWII')],
      // 台指期夜盤（期交所即時行情）；抓不到只少這一張卡
      [
        '台指期夜盤',
        fetchJson(taifex.QUOTE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: taifex.requestBody('night'),
        }).then((payload) => taifex.nearMonthQuote(payload, 'night')),
      ],
      ['美國經濟數據', loadMacro()],
    ]
    const [twIndices, usIndices, quotes, sectors, twiiHistory, nightFutures, macroItems] = await Promise.allSettled(
      sections.map(([label, promise]) => withDeadline(promise, OVERVIEW_SECTION_TIMEOUT_MS, label)),
    )
    const pick = (result, label) => {
      if (result.status === 'fulfilled') return result.value
      console.error(`大盤概況（${label}）失敗：`, result.reason?.message)
      notes.push(`${label}暫時取不到。`)
      return null
    }
    const indexCards = (summaries, targets) =>
      (summaries || [])
        .map((s, i) => {
          if (!s) return null
          const { name, symbol, chartSymbol, group, note, unit } = targets[i]
          return {
            name,
            symbol,
            ...(chartSymbol ? { chartSymbol } : {}),
            ...(group ? { group, note: note ?? null, unit: unit ?? null } : {}),
            ...pickIndex(s),
          }
        })
        .filter(Boolean)

    // 漲跌家數（上市、上櫃各自；ETF 也算在內，和交易所公布的口徑接近）
    const quoteMap = pick(quotes, '漲跌家數')
    let breadth = null
    if (quoteMap) {
      breadth = {}
      for (const exchange of ['tse', 'otc']) {
        const rows = [...quoteMap.values()].filter((q) => q.exchange === exchange && q.change !== null)
        // 這一邊的資料沒抓到就是 null（畫面顯示暫時取不到），不要顯示成 0 家
        if (rows.length === 0) {
          breadth[exchange] = null
          continue
        }
        breadth[exchange] = {
          up: rows.filter((q) => q.change > 0).length,
          down: rows.filter((q) => q.change < 0).length,
          flat: rows.filter((q) => q.change === 0).length,
          date: rows[0]?.date ?? null,
        }
      }
    }

    // 三大法人（上市，最近 5 個交易日，億元）
    let institutional = null
    const history = pick(twiiHistory, '加權指數歷史資料')
    if (history) {
      try {
        const dates = history.bars.map((bar) => bar.date)
        const chips = await withDeadline(getTwseData().getChips(OVERVIEW_TARGETS.tw[0], dates), OVERVIEW_SECTION_TIMEOUT_MS, '三大法人')
        institutional = chips ? { ...chips, summary: describeChips(chips, null) } : null
      } catch (error) {
        console.error('大盤三大法人失敗：', error.message)
        notes.push('三大法人資料暫時取不到。')
      }
    }

    const overview = {
      asOf: new Date(now()).toISOString(),
      tw: indexCards(pick(twIndices, '台股指數'), OVERVIEW_TARGETS.tw),
      us: indexCards(pick(usIndices, '美股指數'), OVERVIEW_TARGETS.us),
      breadth,
      sectors: (pick(sectors, '類股漲跌') || []).sort((a, b) => b.changePct - a.changePct),
      institutional,
      // 台指期夜盤近月合約（大盤概況最上方的重點卡）；夜盤沒有成交或抓不到時是 null
      futures: { night: nightFutures.status === 'fulfilled' ? nightFutures.value : null },
      // 美國總經數據（FRED）：通膨看年增率，非農看當月新增人數（千人）
      macro: macroItems.status === 'fulfilled' ? macroItems.value : [],
      notes,
    }
    if (nightFutures.status === 'rejected') console.error('台指期夜盤失敗：', nightFutures.reason?.message)
    if (macroItems.status === 'rejected') console.error('美國經濟數據失敗：', macroItems.reason?.message)
    // 線上卡住時從 log 看是哪一塊慢
    console.log(`大盤概況完成（${Date.now() - started} ms）`)
    // 有區塊失敗或逾時就只快取 1 分鐘：逾時的請求還在背景跑、會填進各自的快取，下次更新就補得上；
    // 不然一次逾時會讓「美股指數暫時取不到」掛 10 分鐘，按更新也沒用（2026-11-07 線上）
    cache.set('overview', overview, notes.length ? FAILURE_TTL : OVERVIEW_TTL)
    return overview
  }

  // 選股用的全市場合併表（價量、估值、月營收、籌碼連買天數），快取 30 分鐘
  async function loadScreenUniverse() {
    const cached = cache.get('screen-universe')
    if (cached) return cached
    return once('screen-universe', buildScreenUniverse)
  }

  async function buildScreenUniverse() {
    const [quotes, valuation, events, history] = await Promise.allSettled([
      loadDailyQuotes(),
      getTwseData().getValuationMap(),
      loadCorporateEvents(),
      loadHistory('^TWII'),
    ])
    if (quotes.status === 'rejected') throw quotes.reason
    const notes = []
    if (valuation.status === 'rejected') notes.push('估值資料暫時取不到，本益比、殖利率、股價淨值比條件會篩不到股票。')
    if (events.status === 'rejected' || !events.value) notes.push('月營收資料暫時取不到。')
    let streaks = null
    let chipDays = 0
    if (history.status === 'fulfilled') {
      try {
        const result = await getTwseData().getChipStreaks(history.value.bars.map((bar) => bar.date))
        streaks = result.streaks
        chipDays = result.days
      } catch (error) {
        console.error('選股籌碼失敗：', error.message)
      }
    }
    if (!streaks) notes.push('三大法人資料暫時取不到，連買條件會篩不到股票。')
    const rows = screener.buildUniverse({
      quotes: quotes.value,
      valuation: valuation.status === 'fulfilled' ? valuation.value : null,
      revenue: events.status === 'fulfilled' ? events.value?.revenue : null,
      streaks,
    })
    const quoteDate = [...quotes.value.values()].find((q) => q.exchange === 'tse')?.date ?? null
    const universe = { rows, notes, quoteDate, chipDays }
    cache.set('screen-universe', universe, notes.length ? 5 * 60 * 1000 : DAILY_TTL)
    return universe
  }

  // 選股：filters 已經過 screener.parseFilters 驗證
  async function screenStocks(filters) {
    const universe = await loadScreenUniverse()
    let matched = screener.sortRows(universe.rows.filter((row) => screener.passes(row, filters)), filters.sort)
    const total = matched.length
    let technicalChecked = 0
    const notes = [...universe.notes]
    if (screener.technicalNeeded(filters)) {
      // 技術面只對前 TECH_LIMIT 檔逐檔算（要抓歷史 K 線）
      const candidates = matched.slice(0, screener.TECH_LIMIT)
      technicalChecked = candidates.length
      // 選股看的是收盤資料，不打證交所即時報價；歷史只抓 6 個月、用獨立快取
      const signals = await settleLimited(candidates, WATCH_CONCURRENCY, (row) =>
        screenSignals(`${row.code}.${row.exchange === 'otc' ? 'TWO' : 'TW'}`),
      )
      matched = candidates.filter((row, i) => screener.passesTechnical(signals[i].status === 'fulfilled' ? signals[i].value : null, filters))
      if (total > screener.TECH_LIMIT) notes.push(`技術面條件只檢查了前 ${screener.TECH_LIMIT} 檔（依目前的排序），可以先用其他條件縮小範圍。`)
    }
    return {
      asOf: new Date(now()).toISOString(),
      quoteDate: universe.quoteDate,
      chipDays: universe.chipDays,
      universeSize: universe.rows.length,
      total,
      technicalChecked,
      results: matched.slice(0, screener.RESULT_LIMIT),
      notes,
    }
  }

  // 當日推薦個股（v19）：所有人共用一份，跟著全市場收盤資料（快取到資料更新）；資料不完整時 5 分鐘後再試
  // type：推薦類型（dailyPicks.PRESETS 的 key：growth、dividend、revenue、value、hot），不認得的用預設
  async function getDailyPicks(type = dailyPicks.DEFAULT_PICK_TYPE) {
    const pickType = dailyPicks.PICK_TYPES.includes(type) ? type : dailyPicks.DEFAULT_PICK_TYPE
    const key = `daily-picks:${pickType}`
    const cached = cache.get(key)
    if (cached) return cached
    return once(key, async () => {
      const preset = dailyPicks.PRESETS[pickType]
      const universe = await loadScreenUniverse()
      // 要看 20 日均線的類型才逐檔抓 K 線（並行、有快取）；其他直接取前幾檔
      const candidates = dailyPicks.baseCandidates(universe.rows, pickType).slice(0, preset.needsMa20 ? dailyPicks.TECH_CANDIDATES : dailyPicks.PICK_LIMIT)
      const signals = preset.needsMa20
        ? (
            await settleLimited(candidates, WATCH_CONCURRENCY, (row) => screenSignals(`${row.code}.${row.exchange === 'otc' ? 'TWO' : 'TW'}`))
          ).map((r) => (r.status === 'fulfilled' ? r.value : null))
        : []
      const result = {
        asOf: new Date(now()).toISOString(),
        quoteDate: universe.quoteDate,
        type: pickType,
        label: preset.label,
        // 規則寫給人看（畫面顯示），和 dailyPicks.js 一致
        rule: `上市櫃一般股票；${preset.rule}，取前 ${dailyPicks.PICK_LIMIT} 檔`,
        items: dailyPicks.selectPicks(candidates, signals, universe.chipDays, pickType),
        // 可以選的類型（前端的切換按鈕）
        types: dailyPicks.PICK_TYPES.map((t) => ({ type: t, label: dailyPicks.PRESETS[t].label })),
        notes: universe.notes,
      }
      cache.set(key, result, universe.notes.length ? 5 * 60 * 1000 : DAILY_TTL)
      return result
    })
  }

  // 任何一檔台股的卡片資料（股市總覽的推薦／熱門卡片，v19）：報價摘要＋日 K 與判讀。不是台股一般股票、或查不到回 null
  async function getStockCard(code) {
    if (typeof code !== 'string' || !/^\d{4,6}[A-Z]?$/.test(code)) return null
    const target = await resolveTarget(code, 'tw')
    if (!target || target.code !== code) return null
    const [summaries, detail] = await Promise.all([getWatchSummaries([target]).catch(() => [null]), getWatchDetail(target)])
    if (!detail) return null
    return { target, summary: summaries[0] ?? null, chart: detail.chart, analysis: detail.analysis }
  }

  // 台股除權息預告與月營收（上市＋上櫃，整個市場一份）。各來源失敗只少一塊；全部失敗回傳 null
  async function loadCorporateEvents() {
    const cached = cache.get('corporate-events')
    if (cached !== undefined) return cached
    // 同時進來的請求共用同一次下載（獲利與股利頁會同時從摘要和預告兩條路呼叫）
    return once('corporate-events', fetchCorporateEvents)
  }

  async function fetchCorporateEvents() {
    const { URLS: E } = corporateEvents
    const [twseEx, tpexEx, twseRev, tpexRev] = await Promise.allSettled(
      [E.twseExDividend, E.tpexExDividend, E.twseRevenue, E.tpexRevenue].map((url) => fetchJson(url)),
    )
    const ok = (r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : null)
    for (const [label, r] of [['上市除權息', twseEx], ['上櫃除權息', tpexEx], ['上市營收', twseRev], ['上櫃營收', tpexRev]]) {
      if (r.status === 'rejected') console.error(`${label}資料失敗：`, r.reason?.message)
    }
    const all = [twseEx, tpexEx, twseRev, tpexRev].map(ok)
    if (all.every((rows) => rows === null)) {
      cache.set('corporate-events', null, EVENTS_FAILURE_TTL)
      return null
    }
    const events = {
      exDividends: corporateEvents.parseExDividends(all[0], all[1]),
      revenue: corporateEvents.parseRevenue(all[2], all[3]),
      // 上市、上櫃的除權息預告都抓到才算完整：缺一邊時那一邊的股票看起來像「沒有預告」，
      // 除息前推播錯過當天就沒了，所以只抓到一半時用短快取、提醒端也會跳過（v20 審查）
      exDividendsComplete: all[0] !== null && all[1] !== null,
    }
    cache.set('corporate-events', events, events.exDividendsComplete ? EVENTS_TTL : EVENTS_FAILURE_TTL)
    return events
  }

  // ---- 歷史股利與配股（v20，Yahoo events=div|split）----

  // { cash, splits }（見 income.parseYahooEvents）；抓不到是 null（10 分鐘後再試）。5 年：股利成長（v20 階段 10）也用這份
  async function loadDividendHistory(symbol, market) {
    const key = `dividends:${symbol}`
    const cached = dividendCache.get(key)
    if (cached !== undefined) return cached
    return once(key, async () => {
      try {
        const payload = await fetchJson(`${URLS.yahooChart}${encodeURIComponent(symbol)}?range=5y&interval=1mo&events=div%7Csplit`)
        const result = payload?.chart?.result?.[0]
        if (!result) throw new SymbolNotFoundError(symbol)
        const timezone = result.meta?.exchangeTimezoneName || 'UTC'
        const history = income.parseYahooEvents(result.events, { market, dateOf: (ts) => dateIn(timezone, new Date(ts * 1000)) })
        dividendCache.set(key, history, DIVIDEND_TTL)
        return history
      } catch (error) {
        console.error(`股利歷史失敗（${symbol}）：`, error.message)
        dividendCache.set(key, null, DIVIDEND_FAILURE_TTL)
        return null
      }
    })
  }

  // 依 targets 順序回傳；指數或沒有代號的是 null（不是失敗，呼叫端用 kind 分辨）
  async function getDividendHistories(targets) {
    const results = await settleLimited(targets, DIVIDEND_CONCURRENCY, (target) =>
      target?.kind === 'stock' && target.symbol ? loadDividendHistory(target.symbol, target.market) : null,
    )
    return results.map((r) => (r.status === 'fulfilled' ? r.value : null))
  }

  // 證交所休市日（v20 除息前推播判斷「前一個交易日」）：Set<YYYY-MM-DD>；抓不到是 null（呼叫端只看週末）
  async function getTwHolidays() {
    const key = 'tw-holidays'
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    return once(key, async () => {
      try {
        const rows = await fetchJson(URLS.twseHolidays)
        const holidays = Array.isArray(rows) ? exDividendReminder.parseHolidays(rows) : null
        cache.set(key, holidays, holidays ? DIVIDEND_TTL : DIVIDEND_FAILURE_TTL)
        return holidays
      } catch (error) {
        console.error('休市日表失敗：', error.message)
        cache.set(key, null, DIVIDEND_FAILURE_TTL)
        return null
      }
    })
  }

  // 台股除權息預告：Map<代號, [{ date, type, cashDividend, stockRatio }]>；抓不到是 null
  // requireComplete：上市、上櫃有一邊沒抓到就回 null（除息前推播用，寧可這一輪不送）
  async function getExDividendNotices({ requireComplete = false } = {}) {
    const events = await loadCorporateEvents()
    if (requireComplete && !events?.exDividendsComplete) return null
    return events?.exDividends ?? null
  }

  // 自訂追蹤清單：每個標的的輕量摘要，順序和 targets 相同；查不到的是 null。
  // 台股即時報價一次批次查完，歷史資料各自查（有 5 分鐘快取）
  async function getWatchSummaries(targets) {
    const twTargets = targets.filter((t) => t.market === 'tw' && t.code && t.exchange)
    const [realtimeResult, historyResults] = await Promise.all([
      loadRealtime(twTargets).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      ),
      settleLimited(targets, WATCH_CONCURRENCY, (target) => (target.symbol ? loadHistory(target.symbol) : null)),
    ])
    const realtimeMap = realtimeResult.status === 'fulfilled' ? realtimeResult.value : new Map()
    if (realtimeResult.status === 'rejected' && twTargets.length > 0) {
      console.error('自訂追蹤的即時報價失敗：', realtimeResult.reason?.message)
    }
    const historyOf = (index) => (historyResults[index].status === 'fulfilled' ? historyResults[index].value : null)
    const realtimeOf = (target) => (target.market === 'tw' ? realtimeMap.get(`${target.exchange}_${target.code}`) : null)

    // 台股個股的籌碼（只用來產生「外資連 3 買」這類小標記）。三大法人資料是整個市場一天一份、有快取，
    // 多檔共用同幾天的資料；但第一次可能要幾秒，超過時間就先略過，下次再補
    // 除權息與月營收（台股才有；整個市場一份、有快取）
    const hasTw = targets.some((t) => t.market === 'tw' && t.kind === 'stock')
    const events = hasTw ? await loadCorporateEvents().catch(() => null) : null
    const today = dateIn(TW_TIMEZONE, new Date(now()))

    const chipsList = await Promise.all(
      targets.map((target, index) =>
        target.market === 'tw' && target.kind === 'stock'
          ? withTimeout(loadTwExtras(target, historyOf(index), realtimeOf(target), { valuation: false }), WATCH_CHIPS_TIMEOUT_MS)
              .then((extras) => extras?.chips ?? null)
              .catch(() => null)
          : null,
      ),
    )

    return targets.map((target, index) => {
      if (historyResults[index].status === 'rejected') {
        console.error(`自訂追蹤的歷史資料失敗（${target.symbol}）：`, historyResults[index].reason?.message)
      }
      const item = buildItem(target, historyOf(index), realtimeOf(target), { light: true, chips: chipsList[index] })
      if (!item) return null
      const summary = toWatchSummary(item)
      // 除權息（今天以後最近一次）與最新月營收；不是台股個股、或資料抓不到時是 null
      summary.events = events && target.market === 'tw' && target.kind === 'stock' ? corporateEvents.eventsFor(target.code, events, today) : null
      return summary
    })
  }

  // 選股技術面：6 個月日 K 算 MA5／20／60 與 RSI（不打即時報價）
  async function screenSignals(symbol) {
    const key = `screen:${symbol}`
    const cached = screenCache.get(key)
    if (cached !== undefined) return cached
    let signals = null
    try {
      const payload = await fetchJson(`${URLS.yahooChart}${encodeURIComponent(symbol)}?range=6mo&interval=1d`)
      const result = payload?.chart?.result?.[0]
      const quote = result?.indicators?.quote?.[0] || {}
      const bars = (result?.timestamp || [])
        .map((_, i) => ({ open: quote.open?.[i], high: quote.high?.[i], low: quote.low?.[i], close: quote.close?.[i], volume: quote.volume?.[i] }))
        .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
      if (bars.length >= 60) {
        const ind = computeIndicators(bars)
        signals = { price: bars[bars.length - 1].close, ma5: ind.ma5, ma20: ind.ma20, ma60: ind.ma60, rsi: ind.rsi14 }
      }
    } catch (error) {
      console.error(`選股技術面失敗（${symbol}）：`, error.message)
    }
    screenCache.set(key, signals, signals ? TTL.history : FAILURE_TTL)
    return signals
  }

  // 價格以外的提醒條件要的指標（單檔；歷史資料有快取）
  async function getAlertSignals(target) {
    const twTargets = target.market === 'tw' && target.code && target.exchange ? [target] : []
    const [realtimeResult, historyResult] = await Promise.allSettled([
      loadRealtime(twTargets),
      target.symbol ? loadHistory(target.symbol) : Promise.resolve(null),
    ])
    const realtime = realtimeResult.status === 'fulfilled' ? realtimeResult.value.get(`${target.exchange}_${target.code}`) : null
    const history = historyResult.status === 'fulfilled' ? historyResult.value : null
    const item = buildItem(target, history, realtime, { light: true })
    if (!item) return null
    const ind = item.indicators || {}
    return {
      price: item.quote.price,
      changePct: item.quote.changePct,
      date: item.quote.date ?? null,
      ma5: ind.ma5 ?? null,
      ma20: ind.ma20 ?? null,
      ma60: ind.ma60 ?? null,
      k: ind.k ?? null,
      d: ind.d ?? null,
      prevK: ind.prevK ?? null,
      prevD: ind.prevD ?? null,
      rsi: ind.rsi14 ?? null,
      volumeRatio: ind.volumeRatio ?? null,
    }
  }

  // 自訂追蹤展開卡片：價格走勢圖（含均線、支撐壓力）、籌碼與估值。台股以外只有圖表
  async function getWatchDetail(target) {
    const twTargets = target.market === 'tw' && target.code && target.exchange ? [target] : []
    const [realtimeResult, historyResult] = await Promise.allSettled([
      loadRealtime(twTargets),
      target.symbol ? loadHistory(target.symbol) : Promise.resolve(null),
    ])
    const realtime = realtimeResult.status === 'fulfilled' ? realtimeResult.value.get(`${target.exchange}_${target.code}`) : null
    const history = historyResult.status === 'fulfilled' ? historyResult.value : null
    const extras = await loadTwExtras(target, history, realtime)
    const item = buildItem(target, history, realtime, { detail: true, chips: extras.chips, valuation: extras.valuation })
    if (!item) return null
    return {
      chart: item.chart,
      analysis: item.analysis,
      chips: item.chips,
      valuation: item.valuation,
      notes: extras.chipsFailed ? ['籌碼資料暫時取不到。'] : [],
    }
  }

  // 台股代號 → 產業別（集中度提醒，v20 2.9.8）；抓不到是空的 Map（只算單一持股的集中度）
  async function getIndustryMap(codes) {
    if (!codes.length) return new Map()
    return getTwseData()
      .getIndustryMap(codes)
      .catch(() => new Map())
  }

  return {
    buildMarketSnapshot,
    buildTargetSnapshot,
    getIndustryMap,
    getQuote,
    getHistoryBars,
    resolveTarget,
    getWatchSummaries,
    getWatchDetail,
    getDividendHistories,
    getExDividendNotices,
    getTwHolidays,
    getAlertSignals,
    getMarketOverview,
    getIndexChart,
    getDailyPicks,
    getStockCard,
    getFuturesNightChart,
    loadDailyQuotes,
    screenStocks,
    searchTargets,
    // 台股上市櫃清單 { entries, nameIndex }（財經新聞比對提及個股用）
    getDirectory: () => loadDirectory(),
    // 啟動時先載入股票清單，第一次問股票就不用等
    warmUp: () => loadDirectory().then(() => undefined),
  }
}

// 和 Promise.allSettled 一樣的回傳格式，但最多同時跑 limit 個
async function settleLimited(items, limit, run) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      try {
        results[index] = { status: 'fulfilled', value: await run(items[index]) }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

// 52 週高低與目前價格的位置（0 = 在低點、100 = 在高點）
function yearRange(bars, price) {
  const recent = bars.slice(-YEAR_BARS)
  if (recent.length < 20) return null
  const high = Math.max(...recent.map((bar) => bar.high), price)
  const low = Math.min(...recent.map((bar) => bar.low), price)
  return {
    high: round(high),
    low: round(low),
    position: high > low ? round(((price - low) / (high - low)) * 100, 0) : null,
    fromHigh: round((price / high - 1) * 100),
  }
}

// 大盤概況的指數卡片：只留畫面要的欄位
function pickIndex(summary) {
  return {
    price: summary.quote.price,
    change: summary.quote.change,
    changePct: summary.quote.changePct,
    date: summary.quote.date,
    session: summary.session,
    spark: summary.spark,
    // 近 5／20 日漲跌（%）；歷史資料不足時是 null
    changes: summary.changes ? { d5: summary.changes.d5, d20: summary.changes.d20 } : null,
  }
}

// 清單摘要等籌碼資料最多等這麼久
const WATCH_CHIPS_TIMEOUT_MS = 4000

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms).unref?.())])
}

// 籌碼那幾天的總成交量（張）：K 棒成交量是股，台股 1 張 = 1000 股。有任何一天對不到 K 棒或沒有成交量就回 null（不硬算）
function chipVolumeLots(chips, bars) {
  if (chips?.unit !== '張' || !chips.dates?.length) return null
  const byDate = new Map(bars.map((bar) => [bar.date, bar.volume]))
  let total = 0
  for (const date of chips.dates) {
    const volume = byDate.get(date)
    if (!Number.isFinite(volume) || volume <= 0) return null
    total += volume / 1000
  }
  return total
}

// 清單那一行的籌碼小標記：外資優先，其次投信；連續 2 日以上同方向才標
function chipsTagOf(summary) {
  if (!summary) return null
  for (const side of [summary.foreign, summary.trust]) {
    if (side && Math.abs(side.streak) >= 2) {
      const buying = side.streak > 0
      return { text: `${side.name}連 ${Math.abs(side.streak)} ${buying ? '買' : '賣'}`, tone: buying ? 'bull' : 'bear' }
    }
  }
  return null
}

// 自訂追蹤的一列：報價、區間漲跌、52 週位置、迷你走勢與幾個主要的技術判讀（文字由 signals 產生）
const WATCH_SIGNAL_KEYS = ['trend', 'ma20', 'ma60', 'rsi', 'kd', 'volume']
function toWatchSummary(item) {
  return {
    name: item.name,
    currency: item.currency,
    session: item.session,
    source: item.source,
    quote: item.quote,
    changes: item.indicators
      ? { d5: item.indicators.change5d, d20: item.indicators.change20d, d60: item.indicators.change60d }
      : null,
    volumeRatio: item.indicators?.volumeRatio ?? null,
    range52w: item.range52w ?? null,
    spark: item.spark ?? [],
    signals: (item.analysis?.signals ?? []).filter((signal) => WATCH_SIGNAL_KEYS.includes(signal.key)),
    supports: item.analysis?.supports ?? [],
    resistances: item.analysis?.resistances ?? [],
    // 籌碼小標記（台股個股、資料有取到才有）
    chipsTag: chipsTagOf(item.chips?.summary),
  }
}

// 日 K 的欄位維持在最外層（舊版前端只認這幾個），週 K、月 K 放在 weekly／monthly
function chartSlice(series, count) {
  const from = Math.max(0, series.closes.length - count)
  const pick = (values) => (values ? values.slice(from).map((value) => (Number.isFinite(value) ? round(value) : null)) : null)
  return {
    dates: series.dates.slice(from),
    open: pick(series.opens),
    high: pick(series.highs),
    low: pick(series.lows),
    close: pick(series.closes),
    ma5: pick(series.ma5),
    ma20: pick(series.ma20),
    ma60: pick(series.ma60),
    volume: series.volumes.slice(from).map((value) => (Number.isFinite(value) ? value : null)),
  }
}

function buildChart(series) {
  return {
    ...chartSlice(series, CHART_DAYS),
    weekly: chartSlice(aggregateSeries(series, 'week'), CHART_WEEKS),
    monthly: chartSlice(aggregateSeries(series, 'month'), CHART_MONTHS),
  }
}

// ---- 給 AI 的文字 ----

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined) {
    return '—'
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: digits })
}

function signed(value, suffix = '') {
  if (value === null || value === undefined) {
    return '—'
  }
  return `${value > 0 ? '+' : ''}${formatNumber(value)}${suffix}`
}

function above(price, level, label) {
  if (level === null || level === undefined) {
    return null
  }
  return `${price >= level ? '高於' : '低於'} ${label}`
}

function formatItem(item) {
  const { quote, indicators: ind } = item
  const id = item.kind === 'index' ? item.symbol : item.code || item.symbol
  const label = id ? `${item.name}（${id}）` : item.name
  const session =
    item.session === 'intraday'
      ? item.market === 'tw'
        ? '盤中，報價約延遲 20 秒，收盤前都可能變動'
        : '盤中'
      : `收盤（${quote.date || '最近交易日'}）`
  const lines = [
    `【${label}】${item.kind === 'index' ? '指數' : '個股'}，${item.currency}，${session}`,
    `現價 ${formatNumber(quote.price)}，漲跌 ${signed(quote.change)}（${signed(quote.changePct, '%')}）；開 ${formatNumber(quote.open)}、高 ${formatNumber(quote.high)}、低 ${formatNumber(quote.low)}；昨收 ${formatNumber(quote.prevClose)}`,
  ]

  if (!ind) {
    lines.push('技術指標：歷史資料不足，從缺')
    return lines.join('\n')
  }

  const position = [above(quote.price, ind.ma5, 'MA5'), above(quote.price, ind.ma20, 'MA20'), above(quote.price, ind.ma60, 'MA60')]
    .filter(Boolean)
    .join('、')
  lines.push(`均線：MA5 ${formatNumber(ind.ma5)}、MA20 ${formatNumber(ind.ma20)}、MA60 ${formatNumber(ind.ma60)}（現價${position}）`)
  lines.push(`區間漲跌：近 5 日 ${signed(ind.change5d, '%')}、近 20 日 ${signed(ind.change20d, '%')}、近 60 日 ${signed(ind.change60d, '%')}`)
  lines.push(`區間高低：近 20 日 ${formatNumber(ind.high20)}／${formatNumber(ind.low20)}；近 60 日 ${formatNumber(ind.high60)}／${formatNumber(ind.low60)}`)

  const kdLine =
    ind.k !== null
      ? `KD(9) K ${formatNumber(ind.k, 1)}、D ${formatNumber(ind.d, 1)}（前一日 K ${formatNumber(ind.prevK, 1)}、D ${formatNumber(ind.prevD, 1)}）`
      : 'KD 從缺'
  const macdLine =
    ind.macdDif !== null
      ? `MACD DIF ${formatNumber(ind.macdDif)}、訊號線 ${formatNumber(ind.macdSignal)}、柱體 ${signed(ind.macdHist)}（前一日 ${signed(ind.macdPrevHist)}）`
      : 'MACD 從缺'
  lines.push(`動能：RSI(14) ${formatNumber(ind.rsi14, 1)}；${kdLine}；${macdLine}`)

  if (ind.volumeRatio !== null) {
    const partial = item.session === 'intraday' ? '，盤中量尚未完整' : ''
    lines.push(`量能：最近一日成交量為前 20 日均量的 ${formatNumber(ind.volumeRatio)} 倍${partial}`)
  }

  const analysis = item.analysis
  if (analysis) {
    lines.push(`判讀：${analysis.signals.map((signal) => `${signal.label} ${signal.value}`).join('；')}`)
    const levels = (list) =>
      list.length > 0 ? list.map((level) => `${formatNumber(level.price)}（${level.label}）`).join('、') : '資料內沒有'
    lines.push(`支撐：${levels(analysis.supports)}`)
    lines.push(`壓力：${levels(analysis.resistances)}`)
  }

  if (item.chips?.summary) {
    const s = item.chips.summary
    const parts = [s.foreign?.text, s.trust?.text, s.dealer?.text, s.margin?.text].filter(Boolean)
    const scope = item.chips.latestOnly ? '（上櫃只有最新一日資料）' : ''
    lines.push(`籌碼${scope}：${parts.join('；')}`)
  }
  if (item.valuation) {
    const v = item.valuation
    const pct = (p) => (p === null ? '' : `，高於 ${p}% 的上市櫃公司`)
    lines.push(
      `估值：本益比 ${v.pe ?? '無'}${v.pe ? ` 倍${pct(v.pePercentile)}` : ''}；殖利率 ${v.dividendYield ?? '—'}%${pct(v.yieldPercentile)}；股價淨值比 ${v.pb ?? '—'}${pct(v.pbPercentile)}`,
    )
    // 同產業比較：判讀（偏貴、偏便宜）以這組為準
    if (v.industry) {
      const peer = (p) => (p === null ? '—' : `高於 ${p}%`)
      lines.push(
        `同產業（${v.industry.label}，${v.industry.count} 家）比較：本益比${peer(v.industry.pePercentile)}、殖利率${peer(v.industry.yieldPercentile)}、股價淨值比${peer(v.industry.pbPercentile)}；判斷貴或便宜以同產業為準`,
      )
    }
  }
  if (item.research) {
    lines.push(...formatResearch(item.research))
  }
  if (item.advice) {
    lines.push(...formatAdvice(item.advice))
  }
  return lines.join('\n')
}

function formatResearch({ backtest, strategies, prediction }) {
  const lines = []
  const pct = (value) => (value === null ? '—' : `${formatNumber(value, 1)}%`)

  if (backtest) {
    const base = backtest.baseline.map((b) => `${b.days} 日上漲 ${pct(b.winRate)}、平均 ${signed(b.avgReturn, '%')}`).join('；')
    lines.push(`歷史回測（這檔標的自己的歷史，訊號「首次出現」後的表現）：基準（任意一天買進）${base}`)
    for (const signal of backtest.signals) {
      const horizons = signal.horizons
        .map((h) => `${h.days} 日上漲 ${pct(h.winRate)}、平均 ${signed(h.avgReturn, '%')}、最差 ${signed(h.worst, '%')}`)
        .join('；')
      const consistency =
        signal.consistent === false
          ? `；前期 10 日上漲 ${signal.periods.early.winRate}%、後期 ${signal.periods.late.winRate}%，前後方向相反`
          : ''
      const note = (signal.sufficient ? '' : `（樣本不足 ${backtest.minSamples} 次，僅供參考）`) + consistency
      // 結論以 backtest.js 的 judgeSignal 為準，AI 不要自己用差幾個百分點重判
      const verdict = signal.verdict
      const verdictText =
        verdict?.counted && verdict.interval
          ? `；10 日上漲的合理範圍 ${verdict.interval.low}～${verdict.interval.high}%，結論：${
              { edge: verdict.direction > 0 ? '之後偏漲' : '之後偏跌', noEdge: '沒有明顯優勢', horizonConflict: '5／20 日方向不一致，沒有明顯優勢' }[verdict.reason]
            }`
          : ''
      lines.push(`- ${signal.label} ${signal.value}：過去出現 ${signal.occurrences} 次${note}；${horizons}${verdictText}`)
    }
  }

  if (strategies) {
    lines.push(
      `策略回測（${strategies.from} 到 ${strategies.to}，約 ${strategies.years} 年，來回成本 ${strategies.roundTripCost}%）：`,
    )
    for (const s of strategies.strategies) {
      const trades = s.key === 'buyHold' ? '' : `、交易 ${s.trades} 次、勝率 ${pct(s.tradeWinRate)}、持有時間 ${pct(s.exposure)}`
      const now = s.key === 'buyHold' ? '' : s.holdingNow ? '，目前持有中' : '，目前空手'
      const stop = s.withStop ? `；加 ${strategies.stopAtrMultiple} 倍 ATR(${strategies.stopAtrPeriod}) 停損（現在約 ${strategies.stopNowPct}%，觸發 ${s.withStop.stops} 次）後 ${signed(s.withStop.totalReturn, '%')}、最大回落 ${signed(s.withStop.maxDrawdown, '%')}` : ''
      const split =
        s.key === 'buyHold'
          ? ''
          : `；分段驗證（${strategies.splitDate} 前後）前段 ${signed(s.periods.early.totalReturn, '%')} vs 買進持有 ${signed(s.periods.early.buyHold, '%')}、後段 ${signed(s.periods.late.totalReturn, '%')} vs ${signed(s.periods.late.buyHold, '%')}${s.robust ? '，兩段都贏' : ''}`
      lines.push(`- ${s.label}：總報酬 ${signed(s.totalReturn, '%')}、年化 ${signed(s.annualReturn, '%')}、最大回落 ${signed(s.maxDrawdown, '%')}${trades}${now}${stop}${split}`)
    }
  }

  if (prediction) {
    const top = prediction.factors
      .slice(0, 3)
      .map((f) => `${f.label}（${f.weight > 0 ? '越高越偏漲' : '越高越偏跌'}）`)
      .join('、')
    lines.push(
      `機器學習（${prediction.model}，預測 ${prediction.horizon} 個交易日後收盤是否高於今天）：上漲機率 ${pct(prediction.probabilityUp)}；` +
        `樣本外測試 ${prediction.testSamples} 筆（${prediction.testFrom} 到 ${prediction.testTo}）準確率 ${pct(prediction.testAccuracy)}，` +
        `基準（一律猜多數那邊）${pct(prediction.baselineAccuracy)}，` +
        (prediction.reliable ? '有贏過基準' : '沒有明顯贏過基準，這個預測不可靠') +
        `；影響最大的特徵：${top}` +
        (prediction.marketContext
          ? `；有加入${prediction.marketContext.label}特徵（不加時準確率 ${pct(prediction.marketContext.accuracyWithoutMarket)}）`
          : ''),
    )
  }
  return lines
}

function formatAdvice(advice) {
  const level = (l) => `${formatNumber(l.price)}（${l.label}）`
  const lines = [
    `操作建議（規則計算）：${advice.stanceLabel}，信心${advice.confidenceLabel}，適用 ${advice.horizon}。${advice.summary}`,
    `- 依據：${advice.evidence
      .filter((e) => e.counted)
      .map((e) => `${e.label}（${e.direction > 0 ? '偏多' : e.direction < 0 ? '偏空' : '中性'}）`)
      .join('、')}`,
    `- ${advice.levels.stopLossLabel} ${level(advice.levels.stopLoss)}；${advice.levels.targetsLabel} ${advice.levels.targets.map(level).join('、') || '無'}` +
      (advice.levels.riskReward === null ? '' : `；風險報酬比 ${advice.levels.riskReward}`),
    `- 空手者：${advice.forNew}`,
    `- 持有者：${advice.forHolders}`,
    `- 建議部位：${advice.positionSize}`,
  ]
  if (advice.risks.length > 0) lines.push(`- 風險：${advice.risks.join(' ')}`)
  const long = advice.longTerm
  if (long) {
    lines.push(
      `長期建議（規則計算）：${long.stanceLabel}，信心${long.confidenceLabel}，適用 ${long.horizon}。${long.summary}`,
      `- 依據：${long.evidence
        .filter((e) => e.counted)
        .map((e) => `${e.label}（${e.direction > 0 ? '偏多' : '偏空'}；${e.detail}）`)
        .join('、')}`,
      `- 關鍵價位：${formatNumber(long.keyLevel.price)}（${long.keyLevel.label}）`,
      `- 長期還沒持有：${long.forNew}`,
      `- 長期持有者：${long.forHolders}`,
      `- 長期部位：${long.positionSize}`,
    )
  }
  return lines
}

function formatMarketForPrompt(snapshot) {
  if (!snapshot) {
    return ''
  }
  const time = dateTimeFormat('zh-TW', {
    timeZone: TW_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(new Date(snapshot.asOf))
    // Intl 在日期與時間之間放的是窄空白（U+2009），換成一般空白
    .replace(/\s/g, ' ')

  const body = snapshot.items.length > 0 ? snapshot.items.map(formatItem).join('\n\n') : '這次沒有查到任何報價。'
  const notes = snapshot.notes.length > 0 ? `\n\n備註：\n${snapshot.notes.map((note) => `- ${note}`).join('\n')}` : ''
  return `查詢時間：${time}（台北時間）\n\n${body}${notes}`
}

const defaultService = createMarketService()

module.exports = {
  createMarketService,
  formatMarketForPrompt,
  buildMarketSnapshot: (question) => defaultService.buildMarketSnapshot(question),
  defaultMarketService: defaultService,
  warmUpMarket: () => defaultService.warmUp(),
}
