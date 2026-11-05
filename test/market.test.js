const test = require('node:test')
const assert = require('node:assert/strict')

const { sma, rsi, kd, macd, changeOver, volumeRatio, computeIndicators } = require('../src/services/market/indicators')
const { findMarketTargets, buildNameIndex } = require('../src/services/market/symbols')
const { createMarketService, formatMarketForPrompt } = require('../src/services/market/marketService')
const { buildSignals, keyLevels } = require('../src/services/market/signals')
const { buildUserMessage, buildSystemPrompt, SYSTEM_PROMPT } = require('../src/services/narrationService')

// ---- 技術指標 ----

test('市場：均線、漲跌幅與量比', () => {
  assert.equal(sma([1, 2, 3, 4, 5], 5), 3)
  assert.equal(sma([1, 2], 5), null)
  assert.ok(Math.abs(changeOver([100, 110, 121], 2) - 21) < 1e-9)
  assert.equal(changeOver([100], 5), null)
  // 最後一天 300，前 20 天平均 100 → 3 倍
  assert.equal(volumeRatio([...new Array(20).fill(100), 300]), 3)
})

test('市場：RSI 單邊上漲為 100、單邊下跌為 0', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i)
  const down = Array.from({ length: 30 }, (_, i) => 100 - i)
  assert.equal(rsi(up), 100)
  assert.equal(rsi(down), 0)
  assert.equal(rsi(up.slice(0, 10)), null)
})

test('市場：KD 在連續創高時偏高、連續創低時偏低', () => {
  const rising = Array.from({ length: 30 }, (_, i) => 100 + i)
  const high = kd(rising.map((v) => v + 1), rising.map((v) => v - 1), rising)
  assert.ok(high.k > 80 && high.d > 70)
  const falling = Array.from({ length: 30 }, (_, i) => 100 - i)
  const low = kd(falling.map((v) => v + 1), falling.map((v) => v - 1), falling)
  assert.ok(low.k < 20 && low.d < 30)
})

test('市場：MACD 在上漲趨勢 DIF 為正、資料不足時為 null', () => {
  const rising = Array.from({ length: 60 }, (_, i) => 100 + i * 2)
  assert.ok(macd(rising).dif > 0)
  assert.equal(macd(rising.slice(0, 20)), null)
})

test('市場：computeIndicators 在資料不足時對應欄位為 null', () => {
  const bars = Array.from({ length: 25 }, (_, i) => ({ open: 10, high: 11 + i, low: 9, close: 10 + i, volume: 1000 }))
  const ind = computeIndicators(bars)
  assert.equal(ind.ma5, 32)
  assert.equal(ind.ma60, null)
  assert.equal(ind.high20, 35)
  assert.equal(ind.change60d, null)
})

// ---- 判讀標籤 ----

const BASE_IND = {
  ma5: 100, ma20: 95, ma60: 90, rsi14: 55, k: 60, d: 50, prevK: 45, prevD: 50,
  macdHist: 2, macdPrevHist: 1, volumeRatio: 1, high20: 110, low20: 92, high60: 120, low60: 80,
}
const valueOf = (ind, key, price = 102) =>
  buildSignals({ price, indicators: { ...BASE_IND, ...ind } }).signals.find((s) => s.key === key)?.value

test('判讀：均線排列與站上／跌破月線', () => {
  assert.equal(valueOf({}, 'trend'), '多頭排列')
  assert.equal(valueOf({ ma5: 80, ma20: 90, ma60: 100 }, 'trend'), '空頭排列')
  assert.equal(valueOf({ ma5: 95, ma20: 100, ma60: 90 }, 'trend'), '均線糾結')
  assert.equal(valueOf({}, 'ma20', 94), '跌破')
  assert.equal(valueOf({}, 'ma20', 96), '站上')
})

test('判讀：RSI、KD 交叉、MACD 柱體、量能', () => {
  assert.equal(valueOf({ rsi14: 75 }, 'rsi'), '過熱')
  assert.equal(valueOf({ rsi14: 25 }, 'rsi'), '超賣')
  assert.equal(valueOf({ rsi14: 45 }, 'rsi'), '偏弱')
  // 前一日 K < D、今天 K > D
  assert.equal(valueOf({}, 'kd'), '黃金交叉')
  assert.equal(valueOf({ k: 15, d: 20, prevK: 25, prevD: 20 }, 'kd'), '死亡交叉（低檔）')
  assert.equal(valueOf({ k: 85, d: 80, prevK: 84, prevD: 79 }, 'kd'), 'K 在 D 之上（高檔）')
  assert.equal(valueOf({}, 'macd'), '紅柱擴大')
  assert.equal(valueOf({ macdHist: 1, macdPrevHist: 2 }, 'macd'), '紅柱收斂')
  assert.equal(valueOf({ macdHist: -3, macdPrevHist: -2 }, 'macd'), '綠柱擴大')
  assert.equal(valueOf({ macdHist: -1, macdPrevHist: -2 }, 'macd'), '綠柱收斂')
  assert.equal(valueOf({ volumeRatio: 2 }, 'volume'), '放量')
  assert.equal(valueOf({ volumeRatio: 0.5 }, 'volume'), '量縮')
})

test('判讀：支撐取現價以下最近的價位、壓力取以上，太接近的價位合併', () => {
  const { supports, resistances } = keyLevels(102, BASE_IND)
  assert.deepEqual(supports.map((l) => l.price), [100, 95, 92])
  assert.deepEqual(resistances.map((l) => l.price), [110, 120])
  // MA60 與近 60 日低點差不到 0.3%，合成一個價位
  const merged = keyLevels(102, { ...BASE_IND, ma60: 80.1 })
  assert.ok(merged.supports.length <= 3)
  assert.equal(keyLevels(70, BASE_IND).supports.length, 0)
  const low = keyLevels(85, { ...BASE_IND, ma60: 80.1 })
  assert.equal(low.supports[0].label, 'MA60、近 60 日低點')
})

test('判讀：沒有指標時回傳 null', () => {
  assert.equal(buildSignals({ price: 100, indicators: null }), null)
})

// ---- 標的辨識 ----

const DIRECTORY = [
  { code: '2330', name: '台積電', exchange: 'tse' },
  { code: '2317', name: '鴻海', exchange: 'tse' },
  { code: '3711', name: '日月光投控', exchange: 'tse' },
  { code: '0050', name: '元大台灣50', exchange: 'tse' },
  { code: '00400A', name: '主動國泰動能高息', exchange: 'tse' },
  { code: '6488', name: '環球晶', exchange: 'otc' },
  { code: '5903', name: '全家', exchange: 'otc' },
  { code: '2026', name: '測試股', exchange: 'tse' },
]
const find = (question) => findMarketTargets(question, { directory: DIRECTORY, nameIndex: buildNameIndex(DIRECTORY) })
const symbolsOf = (question) => find(question)?.targets.map((t) => t.symbol || `${t.exchange}_${t.code}`) ?? null

test('市場：和股市無關的問題回傳 null', () => {
  assert.equal(find('這份工作適合我嗎'), null)
  assert.equal(find('全家人一起出遊好嗎'), null)
  assert.equal(find(''), null)
})

test('市場：大盤關鍵字對應加權指數，美股對應標普與那斯達克', () => {
  assert.deepEqual(symbolsOf('這週台股會怎麼走'), ['^TWII'])
  assert.deepEqual(symbolsOf('美股下週'), ['^GSPC', '^IXIC'])
  assert.deepEqual(symbolsOf('費半最近'), ['^SOX'])
  assert.deepEqual(symbolsOf('櫃買指數今天'), ['otc_o00'])
})

test('市場：代號與名稱都能對應到台股，上櫃用 .TWO', () => {
  assert.deepEqual(symbolsOf('6488 現在可以買嗎'), ['6488.TWO'])
  assert.deepEqual(symbolsOf('00400A 要不要加碼'), ['00400A.TW'])
  // 三個字以上的名稱單獨出現就算；投控可以省略
  assert.deepEqual(symbolsOf('台積電未來一個月如何'), ['2330.TW'])
  assert.deepEqual(symbolsOf('日月光跟環球晶'), ['3711.TW', '6488.TWO'])
})

test('市場：兩個字的名稱要搭配股市關鍵字', () => {
  assert.equal(find('鴻海未來如何'), null)
  assert.deepEqual(symbolsOf('鴻海股價未來如何'), ['2317.TW'])
})

test('市場：選了股市諮詢時一定當成股市問題，沒寫標的就看加權指數', () => {
  const force = (question) =>
    findMarketTargets(question, { directory: DIRECTORY, nameIndex: buildNameIndex(DIRECTORY), force: true })
      .targets.map((t) => t.symbol)
  assert.deepEqual(force('這週運勢'), ['^TWII'])
  assert.deepEqual(force(''), ['^TWII'])
  // 兩個字的名稱不必搭配關鍵字
  assert.deepEqual(force('鴻海未來如何'), ['2317.TW'])
})

test('市場：數字後面接年、點、元時不是代號', () => {
  assert.equal(find('2026年運勢'), null)
  assert.deepEqual(symbolsOf('大盤會不會跌破 2026 點'), ['^TWII'])
})

test('市場：美股中文名稱可以單獨觸發，英文代號要搭配關鍵字或 $', () => {
  assert.deepEqual(symbolsOf('輝達和 AMD 哪個好'), ['NVDA', 'AMD'])
  assert.equal(find('TSLA 下週'), null)
  assert.deepEqual(symbolsOf('$TSLA 下週'), ['TSLA'])
  assert.deepEqual(symbolsOf('台積電ADR 漲了嗎'), ['TSM'])
  // 常見縮寫不是代號
  assert.deepEqual(symbolsOf('台股 ETF 的 KD 怎麼看'), ['^TWII'])
})

// ---- 取資料（假的 fetch）----

function yahooPayload({ closes, currency = 'TWD', timezone = 'Asia/Taipei', start = Date.UTC(2026, 5, 1, 1) }) {
  const day = 24 * 60 * 60
  return {
    chart: {
      result: [
        {
          meta: { currency, exchangeTimezoneName: timezone, shortName: 'TEST CO', regularMarketPrice: closes.at(-1) },
          timestamp: closes.map((_, i) => start / 1000 + i * day),
          indicators: {
            quote: [
              {
                open: closes,
                high: closes.map((c) => c + 1),
                low: closes.map((c) => c - 1),
                close: closes,
                volume: closes.map(() => 1000),
              },
            ],
          },
        },
      ],
    },
  }
}

function fakeFetch(routes) {
  const calls = []
  const impl = async (url) => {
    calls.push(url)
    const route = routes.find(([prefix]) => url.startsWith(prefix))
    if (!route) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    const body = typeof route[1] === 'function' ? route[1](url) : route[1]
    if (body instanceof Error) {
      throw body
    }
    return { ok: true, status: 200, json: async () => body }
  }
  return { impl, calls }
}

const LIST_ROUTES = [
  ['https://openapi.twse.com.tw', [{ Code: '2330', Name: '台積電' }]],
  // 籌碼（T86、融資）：假裝當天沒有公布資料
  ['https://www.twse.com.tw', { stat: '很抱歉，沒有符合條件的資料!' }],
  ['https://www.tpex.org.tw', [{ SecuritiesCompanyCode: '6488', CompanyName: '環球晶' }]],
]

test('市場：台股個股用即時報價更新最後一根 K 棒並計算指標', async () => {
  const closes = Array.from({ length: 70 }, (_, i) => 100 + i)
  // 歷史最後一天是 2026-08-09（台北），即時報價在同一天
  const lastDate = new Date(Date.UTC(2026, 5, 1, 1) + 69 * 86400000)
  const ymd = lastDate.toISOString().slice(0, 10).replace(/-/g, '')
  const { impl } = fakeFetch([
    ...LIST_ROUTES,
    ['https://query1.finance.yahoo.com', yahooPayload({ closes })],
    [
      'https://mis.twse.com.tw',
      { msgArray: [{ ex: 'tse', c: '2330', n: '台積電', z: '180.00', y: '169.00', o: '170', h: '181', l: '168', v: '5000', d: ymd, t: '10:30:00', tlong: String(lastDate.getTime()) }] },
    ],
  ])
  const service = createMarketService({ fetchImpl: impl, now: () => lastDate.getTime() })
  const snapshot = await service.buildMarketSnapshot('台積電這週')

  assert.equal(snapshot.items.length, 1)
  const [item] = snapshot.items
  assert.equal(item.code, '2330')
  assert.equal(item.source, 'twse-mis')
  assert.equal(item.session, 'intraday')
  assert.equal(item.quote.price, 180)
  assert.equal(item.quote.change, 11)
  assert.equal(item.quote.changePct, 6.51)
  // 最後一根被即時報價取代：MA5 = (165+166+167+168+180)/5
  assert.equal(item.indicators.ma5, 169.2)
  assert.equal(item.barCount, 70)
  assert.deepEqual(snapshot.notes, [])
})

test('市場：即時報價失敗時退回 Yahoo，並在備註說明', async () => {
  const closes = Array.from({ length: 30 }, (_, i) => 50 + i)
  const { impl } = fakeFetch([
    ...LIST_ROUTES,
    ['https://query1.finance.yahoo.com', yahooPayload({ closes })],
    ['https://mis.twse.com.tw', new Error('timeout')],
  ])
  const service = createMarketService({ fetchImpl: impl })
  const snapshot = await service.buildMarketSnapshot('台積電這週')
  assert.equal(snapshot.items[0].source, 'yahoo')
  assert.equal(snapshot.items[0].quote.price, 79)
  assert.equal(snapshot.items[0].quote.prevClose, 78)
  assert.match(snapshot.notes[0], /即時報價暫時取不到/)
})

test('市場：查不到的英文代號直接略過，查不到的中文名稱要說明', async () => {
  const { impl } = fakeFetch([...LIST_ROUTES])
  const service = createMarketService({ fetchImpl: impl })
  const snapshot = await service.buildMarketSnapshot('輝達和 ZZZZ 股票')
  assert.deepEqual(snapshot.items, [])
  assert.deepEqual(snapshot.notes, ['查不到 輝達（NVDA）的資料。'])
})

test('市場：股市諮詢的問題沒寫到標的時看加權指數', async () => {
  const closes = Array.from({ length: 30 }, (_, i) => 100 + i)
  const { impl } = fakeFetch([...LIST_ROUTES, ['https://query1.finance.yahoo.com', yahooPayload({ closes })]])
  const service = createMarketService({ fetchImpl: impl })
  const snapshot = await service.buildMarketSnapshot('這週運勢如何')
  assert.deepEqual(snapshot.items.map((item) => item.symbol), ['^TWII'])
  // 有指標就有判讀
  assert.ok(snapshot.items[0].analysis.signals.length > 0)
})

test('市場：股票清單有快取，同一段時間內只載入一次', async () => {
  const { impl, calls } = fakeFetch([...LIST_ROUTES, ['https://query1.finance.yahoo.com', yahooPayload({ closes: [1, 2, 3] })]])
  const service = createMarketService({ fetchImpl: impl })
  await service.buildMarketSnapshot('台積電')
  await service.buildMarketSnapshot('環球晶')
  assert.equal(calls.filter((url) => url.includes('STOCK_DAY_ALL')).length, 1)
})

// ---- 給 AI 的文字 ----

const SAMPLE_SNAPSHOT = {
  asOf: '2026-11-05T02:40:00.000Z',
  items: [
    {
      symbol: '^TWII',
      code: 't00',
      name: '發行量加權股價指數',
      market: 'tw',
      kind: 'index',
      currency: 'TWD',
      session: 'intraday',
      source: 'twse-mis',
      quote: { price: 42392.23, prevClose: 42948.91, change: -556.68, changePct: -1.3, open: 42666.13, high: 42873.81, low: 41866.1, time: null, date: '2026-11-05' },
      indicators: {
        ma5: 43756.13, ma20: 46680.88, ma60: 46504.25, rsi14: 26, k: 14, d: 16.5, prevK: 16.1, prevD: 17.7,
        macdDif: -1053.42, macdSignal: -484.44, macdHist: -568.99, macdPrevHist: -526.67,
        change5d: -8.58, change20d: -14.72, change60d: -4.51, high20: 49968.92, low20: 41855.82, high60: 49968.92, low60: 41855.82, volumeRatio: 1.05,
      },
      barCount: 127,
    },
  ],
  notes: ['台股即時報價暫時取不到，改用 Yahoo 的報價（可能延遲約 20 分鐘）。'],
}

test('市場：給 AI 的資料段包含時間、報價、指標與備註', () => {
  const text = formatMarketForPrompt(SAMPLE_SNAPSHOT)
  assert.match(text, /查詢時間：2026\/11\/05 10:40/)
  assert.match(text, /【發行量加權股價指數（\^TWII）】指數，TWD，盤中/)
  assert.match(text, /現價 42,392\.23，漲跌 -556\.68（-1\.3%）/)
  assert.match(text, /現價低於 MA5、低於 MA20、低於 MA60/)
  assert.match(text, /RSI\(14\) 26/)
  assert.match(text, /盤中量尚未完整/)
  assert.match(text, /備註：\n- 台股即時報價暫時取不到/)
})

test('市場：有市場資料時才附加股市規則與 market_data 區塊', () => {
  assert.equal(buildSystemPrompt(null), SYSTEM_PROMPT)
  assert.match(buildSystemPrompt(SAMPLE_SNAPSHOT), /市場數據分析為主、牌面為輔/)

  const reading = {
    question: '這週台股會怎麼走',
    spread: { name: '投資決策', description: '測試' },
    cards: [],
    analysis: { theme: { text: '' }, pairs: [], positions: [], courts: [], conflicts: [], uncertainties: [] },
  }
  assert.doesNotMatch(buildUserMessage({ reading, cards: [] }), /<market_data>/)
  assert.match(buildUserMessage({ reading, cards: [], market: SAMPLE_SNAPSHOT }), /<market_data>\n查詢時間/)
})
