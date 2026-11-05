// 市場資料：依問題查出相關標的的報價與技術指標，交給 AI 解讀使用。
//
// 資料來源（都不需要金鑰）：
// - 證交所 MIS 即時報價（非正式介面，約延遲 20 秒）：台股上市／上櫃個股、加權與櫃買指數
// - Yahoo Finance chart（非正式介面）：日 K 歷史資料，用來算均線、RSI、KD、MACD；美股報價也從這裡來
// - 證交所 OpenAPI、櫃買中心 OpenAPI：上市／上櫃股票清單，用來把公司名稱對應到代號
//
// 任何一個來源失敗都只會少一部分資料，不會讓 AI 解讀失敗；全部失敗時 snapshot 會帶 notes 說明。
const { computeIndicators, round } = require('./indicators')
const { buildSignals } = require('./signals')
const { computeSeries } = require('./series')
const { backtestSignals, backtestStrategies } = require('./backtest')
const { predictDirection } = require('./prediction')
const { buildAdvice } = require('./advice')
const { createTwseData, describeChips, describeValuation } = require('./twseData')

// 機器學習的大盤特徵：台股個股用加權指數、美股個股用標普 500
const CONTEXT_INDEX = {
  tw: { symbol: '^TWII', label: '大盤' },
  us: { symbol: '^GSPC', label: '標普 500' },
}

// 圖表只畫最近這麼多個交易日
const CHART_DAYS = 120
// 少於這麼多根 K 棒（約一年）就不做回測與預測，樣本太少的統計只會誤導
const MIN_RESEARCH_BARS = 250
const { buildNameIndex, findMarketTargets } = require('./symbols')

const URLS = {
  twseList: 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
  tpexList: 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
  mis: 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp',
  yahooChart: 'https://query1.finance.yahoo.com/v8/finance/chart/',
}

const TTL = {
  directory: 12 * 60 * 60 * 1000,
  history: 5 * 60 * 1000,
  realtime: 20 * 1000,
}

const REQUEST_TIMEOUT_MS = 8000
const TW_TIMEZONE = 'Asia/Taipei'

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
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

// 快取最多這麼多筆；超過時先清掉過期的，還是太多就丟最舊的（Map 依插入順序）
const CACHE_MAX_ENTRIES = 500

function createCache(now) {
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
      if (store.size > CACHE_MAX_ENTRIES) {
        for (const [k, hit] of store) {
          if (hit.expires <= now()) store.delete(k)
        }
        while (store.size > CACHE_MAX_ENTRIES) {
          store.delete(store.keys().next().value)
        }
      }
    },
  }
}

class SymbolNotFoundError extends Error {}

function createMarketService({ fetchImpl = (...args) => fetch(...args), now = () => Date.now() } = {}) {
  const cache = createCache(now)
  // twseData 用的 fetchJson 在下面定義，這裡延後取用
  let twseData = null
  const getTwseData = () => {
    twseData =
      twseData || createTwseData({ fetchJson: (url) => fetchJson(url), cache, today: () => dateIn(TW_TIMEZONE, new Date(now())) })
    return twseData
  }

  async function fetchJson(url) {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TarotMarket/1.0)', Accept: 'application/json' },
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

  // extras：{ context: { label, series }, chips, valuation }，都可以省略
  function buildItem(target, history, realtime, extras = {}) {
    const nowDate = new Date(now())
    let bars = history ? history.bars.map((bar) => ({ ...bar })) : []

    // 即時報價併進最後一根 K 棒：同一天就更新收盤與高低，新的一天就補一根
    if (realtime?.date) {
      const last = bars[bars.length - 1]
      if (last && last.date === realtime.date) {
        last.close = realtime.price
        last.high = Math.max(last.high, realtime.high ?? realtime.price)
        last.low = Math.min(last.low, realtime.low ?? realtime.price)
      } else if (!last || realtime.date > last.date) {
        bars.push({
          date: realtime.date,
          open: realtime.open ?? realtime.price,
          high: realtime.high ?? realtime.price,
          low: realtime.low ?? realtime.price,
          close: realtime.price,
          volume: null,
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
    const series = bars.length >= 20 ? computeSeries(bars) : null

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
      },
      // 少於 20 根 K 棒的指標沒有意義（例如櫃買指數只有即時報價）
      indicators,
      // 判讀標籤與支撐壓力：畫面與 AI 用同一份
      analysis,
      // 歷史回測、策略比較、機器學習預測（資料不足一年時為 null）
      research:
        series && analysis && bars.length >= MIN_RESEARCH_BARS
          ? {
              backtest: backtestSignals(series, analysis.signals),
              strategies: backtestStrategies(series, target.market),
              prediction: predictDirection(series, { context: extras.context || null }),
            }
          : null,
      chart: series ? buildChart(series) : null,
      // 籌碼面（台股才有）：三大法人與融資融券，summary 是判讀文字
      chips: extras.chips ? { ...extras.chips, summary: describeChips(extras.chips, indicators?.change5d ?? null) } : null,
      // 估值（台股個股才有）：本益比、殖利率、股價淨值比與在全體上市櫃的百分位
      valuation: extras.valuation ? { ...extras.valuation, summary: describeValuation(extras.valuation) } : null,
      barCount: bars.length,
    }
    // 操作建議要用到上面的全部資料，最後才算
    item.advice = buildAdvice(item)
    return item
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

    const notes = []
    const twTargets = found.targets.filter((target) => target.market === 'tw')
    const [realtimeResult, ...historyResults] = await Promise.allSettled([
      loadRealtime(twTargets),
      ...found.targets.map((target) => (target.symbol ? loadHistory(target.symbol) : Promise.resolve(null))),
    ])

    const realtimeMap = realtimeResult.status === 'fulfilled' ? realtimeResult.value : new Map()
    const historyOf = (index) => (historyResults[index].status === 'fulfilled' ? historyResults[index].value : null)

    // 大盤序列（機器學習特徵）、籌碼、估值：各自失敗只少一塊資料
    const contextSymbols = [
      ...new Set(found.targets.filter((t) => t.kind === 'stock').map((t) => CONTEXT_INDEX[t.market]?.symbol).filter(Boolean)),
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

    const twExtras = await Promise.all(
      found.targets.map(async (target, index) => {
        if (target.market !== 'tw') return {}
        const history = historyOf(index)
        const realtime = realtimeMap.get(`${target.exchange}_${target.code}`)
        const dates = (history?.bars ?? []).map((bar) => bar.date)
        if (realtime?.date && (dates.length === 0 || realtime.date > dates[dates.length - 1])) dates.push(realtime.date)
        const [chips, valuation] = await Promise.allSettled([
          dates.length > 0 ? getTwseData().getChips(target, dates) : null,
          target.kind === 'stock' ? getTwseData().getValuation(target.code) : null,
        ])
        if (chips.status === 'rejected') {
          console.error(`籌碼資料失敗（${target.code}）：`, chips.reason?.message)
          notes.push(`${target.name} 的籌碼資料暫時取不到。`)
        }
        if (valuation.status === 'rejected') {
          console.error(`估值資料失敗（${target.code}）：`, valuation.reason?.message)
        }
        return {
          chips: chips.status === 'fulfilled' ? chips.value : null,
          valuation: valuation.status === 'fulfilled' ? valuation.value : null,
        }
      }),
    )
    if (realtimeResult.status === 'rejected' && twTargets.length > 0) {
      console.error('台股即時報價失敗：', realtimeResult.reason?.message)
      notes.push('台股即時報價暫時取不到，改用 Yahoo 的報價（可能延遲約 20 分鐘）。')
    }

    const items = []
    found.targets.forEach((target, index) => {
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
      const item = buildItem(target, history, realtime, { ...twExtras[index], context })
      if (item) {
        items.push(item)
      } else {
        notes.push(`${target.name} 目前查不到報價。`)
      }
    })

    return { asOf: new Date(now()).toISOString(), items, notes }
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

  // 依使用者輸入找標的（手動新增提醒用）：和股市諮詢用同一套辨識，取第一個
  async function resolveTarget(query) {
    const directory = await loadDirectory()
    const found = findMarketTargets(query, { directory: directory.entries, nameIndex: directory.nameIndex, force: false })
    return found?.targets[0] ?? null
  }

  return {
    buildMarketSnapshot,
    getQuote,
    getHistoryBars,
    resolveTarget,
    // 啟動時先載入股票清單，第一次問股票就不用等
    warmUp: () => loadDirectory().then(() => undefined),
  }
}

// 價格走勢圖的資料：最近 CHART_DAYS 天的收盤、均線與成交量
function buildChart(series) {
  const from = Math.max(0, series.closes.length - CHART_DAYS)
  const pick = (values) => values.slice(from).map((value) => (value === null ? null : round(value)))
  return {
    dates: series.dates.slice(from),
    close: pick(series.closes),
    ma5: pick(series.ma5),
    ma20: pick(series.ma20),
    ma60: pick(series.ma60),
    volume: series.volumes.slice(from).map((value) => (Number.isFinite(value) ? value : null)),
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
      lines.push(`- ${signal.label} ${signal.value}：過去出現 ${signal.occurrences} 次${note}；${horizons}`)
    }
  }

  if (strategies) {
    lines.push(
      `策略回測（${strategies.from} 到 ${strategies.to}，約 ${strategies.years} 年，來回成本 ${strategies.roundTripCost}%）：`,
    )
    for (const s of strategies.strategies) {
      const trades = s.key === 'buyHold' ? '' : `、交易 ${s.trades} 次、勝率 ${pct(s.tradeWinRate)}、持有時間 ${pct(s.exposure)}`
      const now = s.key === 'buyHold' ? '' : s.holdingNow ? '，目前持有中' : '，目前空手'
      const stop = s.withStop ? `；加 ${strategies.stopLossPct}% 停損後 ${signed(s.withStop.totalReturn, '%')}、最大回落 ${signed(s.withStop.maxDrawdown, '%')}` : ''
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
  return lines
}

function formatMarketForPrompt(snapshot) {
  if (!snapshot) {
    return ''
  }
  const time = new Intl.DateTimeFormat('zh-TW', {
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
