// 從問題裡找出要查的市場標的（大盤指數、台股個股／ETF、美股）。
// 純函式：股票清單由呼叫端傳入，方便測試，也不會在這裡打外部 API。

// 有這些字才當成股市問題；只有「股票代號」可以單獨觸發（代號本身就夠明確）
const MARKET_KEYWORDS =
  /股|大盤|加權|指數|ETF|走勢|漲|跌|投資|進場|出場|加碼|減碼|買進|賣出|套牢|殖利率|盤勢|多空|做多|做空|停損|K線|技術面|基本面|前景|目標價|財報|營收|配息|除息|美股|那斯達克|道瓊|標普|費半/i

// 指數：符合關鍵字就加入。tw 指數有即時報價，櫃買指數 Yahoo 沒有歷史資料，只有即時
const INDEX_RULES = [
  { pattern: /台股|大盤|加權|股市/, target: { kind: 'index', market: 'tw', code: 't00', exchange: 'tse', symbol: '^TWII', name: '發行量加權股價指數' } },
  { pattern: /櫃買|上櫃指數|OTC/i, target: { kind: 'index', market: 'tw', code: 'o00', exchange: 'otc', symbol: null, name: '櫃買指數' } },
  { pattern: /道瓊/, target: { kind: 'index', market: 'us', symbol: '^DJI', name: '道瓊工業指數' } },
  { pattern: /那斯達克|那指|NASDAQ/i, target: { kind: 'index', market: 'us', symbol: '^IXIC', name: '那斯達克綜合指數' } },
  { pattern: /標普|S&P/i, target: { kind: 'index', market: 'us', symbol: '^GSPC', name: '標普 500 指數' } },
  { pattern: /費半|費城半導體/, target: { kind: 'index', market: 'us', symbol: '^SOX', name: '費城半導體指數' } },
]

// 只說「美股」沒指定哪個指數時，看標普與那斯達克
const US_MARKET_DEFAULT = /美股/
const US_DEFAULT_SYMBOLS = ['^GSPC', '^IXIC']

// 常見美股的中文稱呼。英文代號（例如 NVDA）另外用大寫字母比對
const US_NAMES = {
  台積電ADR: 'TSM',
  蘋果: 'AAPL',
  輝達: 'NVDA',
  特斯拉: 'TSLA',
  微軟: 'MSFT',
  谷歌: 'GOOGL',
  Google: 'GOOGL',
  亞馬遜: 'AMZN',
  臉書: 'META',
  超微電腦: 'SMCI',
  超微: 'AMD',
  博通: 'AVGO',
  英特爾: 'INTC',
  美光: 'MU',
  高通: 'QCOM',
  網飛: 'NFLX',
  甲骨文: 'ORCL',
  波克夏: 'BRK-B',
  帕蘭泰爾: 'PLTR',
  安謀: 'ARM',
}

// 大寫字母組合裡常見、但不是股票代號的詞
const TICKER_STOPWORDS = new Set([
  'ETF', 'AI', 'ADR', 'CEO', 'USD', 'TWD', 'NTD', 'OTC', 'KD', 'RSI', 'MACD', 'MA', 'EPS', 'PE', 'PB',
  'GDP', 'CPI', 'PPI', 'FED', 'FOMC', 'IPO', 'ROE', 'NASDAQ', 'TW', 'US', 'USA', 'OK', 'K', 'VS', 'PM', 'AM',
])

const MAX_TARGETS = 4

// 不搭配股市關鍵字時，台股名稱至少要幾個字才算
const STANDALONE_NAME_LENGTH = 3

// 台股代號後面接這些字時是數字不是代號（例如「2000 點」「1500 元」「2026 年」）
const NOT_CODE_SUFFIX = /^\s*[年月日號點元塊%％]/

function usTarget(symbol, name) {
  return { kind: 'stock', market: 'us', symbol, name: name || symbol }
}

function twTarget(entry) {
  return {
    kind: 'stock',
    market: 'tw',
    code: entry.code,
    exchange: entry.exchange,
    symbol: `${entry.code}.${entry.exchange === 'otc' ? 'TWO' : 'TW'}`,
    name: entry.name,
  }
}

// 名稱的別名：去掉 -KY、*、「投控」等使用者通常不會打的部分（日月光投控 → 日月光）
function aliasesOf(name) {
  const aliases = new Set([name])
  const cleaned = name.replace(/[-－]?KY$/i, '').replace(/\*/g, '').trim()
  aliases.add(cleaned)
  if (cleaned.endsWith('投控') && cleaned.length > 3) {
    aliases.add(cleaned.slice(0, -2))
  }
  return [...aliases].filter((alias) => alias.length >= 2)
}

// directory：[{ code, name, exchange: 'tse' | 'otc' }]
function buildNameIndex(directory) {
  const index = []
  for (const entry of directory) {
    for (const alias of aliasesOf(entry.name)) {
      index.push({ alias, entry })
    }
  }
  // 長的名字先比，避免「國泰」吃掉「國泰金」
  return index.sort((a, b) => b.alias.length - a.alias.length)
}

function overlaps(spans, start, end) {
  return spans.some(([s, e]) => start < e && end > s)
}

// 回傳 null：不是股市問題；否則 { targets: [...] }
// nameIndex 可以事先用 buildNameIndex 建好重複使用。
// force：使用者明確選了股市諮詢——一定當成股市問題，找不到標的就看加權指數
function findMarketTargets(question, { directory = [], nameIndex, force = false } = {}) {
  const text = typeof question === 'string' ? question.trim() : ''
  if (!text && !force) {
    return null
  }

  const byCode = new Map(directory.map((entry) => [entry.code.toUpperCase(), entry]))
  const targets = []
  const seen = new Set()
  const spans = []
  const add = (target) => {
    const key = target.symbol || `${target.exchange}_${target.code}`
    if (!seen.has(key) && targets.length < MAX_TARGETS) {
      seen.add(key)
      targets.push(target)
    }
  }

  // 台股代號：4～6 碼數字，ETF 可能多一個英文字母（00400A）。必須在清單裡才算
  let hasCode = false
  for (const match of text.matchAll(/(?<![0-9A-Za-z])(\d{4,6}[A-Za-z]?)(?![0-9A-Za-z])/g)) {
    const entry = byCode.get(match[1].toUpperCase())
    if (entry && !NOT_CODE_SUFFIX.test(text.slice(match.index + match[0].length))) {
      hasCode = true
      spans.push([match.index, match.index + match[0].length])
      add(twTarget(entry))
    }
  }

  // $TSLA 這種寫法本身就表示是股票代號
  const hasKeyword = force || MARKET_KEYWORDS.test(text) || /\$[A-Z]{1,5}(?![A-Za-z])/.test(text)

  // 美股中文名稱（台積電ADR 要比台股的「台積電」先比）。名稱夠明確，不必搭配關鍵字
  for (const [name, symbol] of Object.entries(US_NAMES).sort((a, b) => b[0].length - a[0].length)) {
    const start = text.indexOf(name)
    if (start >= 0 && !overlaps(spans, start, start + name.length)) {
      spans.push([start, start + name.length])
      add(usTarget(symbol, name))
    }
  }

  // 台股名稱。三個字以上（台積電、聯發科）單獨出現就算；
  // 兩個字的容易和日常用語撞名（全家、中華、國產、統一），要有股市關鍵字才算
  for (const { alias, entry } of nameIndex || buildNameIndex(directory)) {
    if (!hasKeyword && alias.length < STANDALONE_NAME_LENGTH) {
      continue
    }
    const start = text.indexOf(alias)
    if (start >= 0 && !overlaps(spans, start, start + alias.length)) {
      spans.push([start, start + alias.length])
      add(twTarget(entry))
    }
  }

  if (!hasCode && !hasKeyword && targets.length === 0) {
    return null
  }

  // 英文代號（美股）：要是大寫，避免把一般英文單字當成代號。查不到的代號由取資料那一端略過
  for (const match of text.matchAll(/(?<![A-Za-z])\$?([A-Z]{1,5}(?:-[A-Z])?)(?![A-Za-z])/g)) {
    const symbol = match[1]
    if (!TICKER_STOPWORDS.has(symbol) && !overlaps(spans, match.index, match.index + match[0].length)) {
      add(usTarget(symbol))
    }
  }

  // 指數
  let hasUsIndex = false
  for (const { pattern, target } of INDEX_RULES) {
    if (pattern.test(text)) {
      add(target)
      hasUsIndex = hasUsIndex || target.market === 'us'
    }
  }
  if (US_MARKET_DEFAULT.test(text) && !hasUsIndex) {
    for (const symbol of US_DEFAULT_SYMBOLS) {
      add(INDEX_RULES.find((rule) => rule.target.symbol === symbol).target)
    }
  }

  if (targets.length === 0 && force) {
    add(INDEX_RULES[0].target)
  }
  if (targets.length === 0) {
    return null
  }
  return { targets }
}

module.exports = {
  MARKET_KEYWORDS,
  MAX_TARGETS,
  buildNameIndex,
  findMarketTargets,
}
