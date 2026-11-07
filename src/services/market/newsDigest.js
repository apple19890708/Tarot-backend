// 新聞重點彈窗（v17 規格 G）：不呼叫 AI，全部用規則。
// - 讀原文（只限新聞來源的網域）→ 抽出內文 → 切句、打分，節錄最重要的 3 句（不改寫、不翻譯）
// - 標籤：提及個股（台股代號與名稱、美股中英文名稱與代號）、語氣（漲跌用詞統計）、可能影響族群（主題對照表）
// 全文只拿來挑句子，不存；結果存在那則新聞上全站共用。
const { NEWS_THEMES } = require('../../data/newsThemes')
const { US_NAMES, TICKER_STOPWORDS, buildNameIndex } = require('./symbols')
const { plainText, decodeEntities, featuresOf, similarity, themeHits } = require('./financeNews')

// 規則改了就加 1：存著的舊結果會在下次打開時重算
const DIGEST_VERSION = 11
// 只讀這些網域的原文，避免被當成跳板去打其他網址
const ARTICLE_HOSTS = new Set(['www.cnbc.com', 'cnbc.com', 'www.marketwatch.com', 'marketwatch.com', 'news.cnyes.com', 'tw.stock.yahoo.com'])
// 原站明確拒絕或不存在：存起來不再重讀
const PERMANENT_STATUS = new Set([401, 403, 404, 410, 451])
// 讀原文暫時失敗後多久內不重讀
const RETRY_AFTER_MS = 2 * 60 * 1000
const POINTS = 3
// 原文越長，重點句越多：700 字以下 3 句、1,500 字以下 4 句、更長 5 句
function pointLimit(body) {
  const length = String(body || '').length
  return length > 1500 ? 5 : length > 700 ? 4 : POINTS
}
const MAX_STOCKS = 10
const BODY_MAX = 12000
const REGION_MAX = 400000

// ---- 抽出內文 ----

// 內文區塊的開頭（CNBC、Yahoo 股市、一般網站）；找不到就從 <article> 或整頁找段落
const BODY_MARKERS = ['data-module="ArticleBody"', 'class="atoms"', 'class="caas-body"', 'itemprop="articleBody"', '<article']
// 碰到這些字就是內文結束（留言、相關新聞）
const BODY_END = /^(檢視留言|相關內容|延伸閱讀|相關新聞|更多新聞|Related|More from|Read more|Subscribe to)/i
// 不是內文的段落：網址、圖說、廣告、訂閱提示、免責聲明
const JUNK = /https?:\/\/|www\.|詳細資訊請看|責任編輯|圖／|圖片來源|照片來源|免責聲明|本文僅供參考|訂閱|登入後|Getty Images|Sign up|Subscribe|CNBC Pro|Click here|Disclaimer|All rights reserved|©/i

function jsonLdBody(html) {
  let from = 0
  for (let n = 0; n < 20; n += 1) {
    const start = html.indexOf('application/ld+json', from)
    if (start < 0) return null
    const open = html.indexOf('>', start)
    const close = html.indexOf('</script>', open)
    if (open < 0 || close < 0) return null
    from = close
    try {
      const data = JSON.parse(html.slice(open + 1, close))
      const nodes = Array.isArray(data) ? data : Array.isArray(data['@graph']) ? data['@graph'] : [data]
      const body = nodes.find((node) => typeof node?.articleBody === 'string' && node.articleBody.length > 100)?.articleBody
      if (body) return body
    } catch {
      // 不是合法 JSON 就看下一段
    }
  }
  return null
}

// <p> 段落（用 indexOf 逐段切，線性時間），<br> 也當成分段
function paragraphsIn(region) {
  const lower = region.toLowerCase()
  const parts = []
  let from = 0
  for (;;) {
    let start = lower.indexOf('<p', from)
    while (start >= 0 && !/[\s>]/.test(lower[start + 2] || '')) start = lower.indexOf('<p', start + 2)
    if (start < 0) break
    const open = lower.indexOf('>', start)
    const close = lower.indexOf('</p>', open)
    if (open < 0 || close < 0) break
    for (const piece of region.slice(open + 1, close).split(/<br\s*\/?>/i)) parts.push(piece)
    from = close + 4
  }
  return parts
}

function extractArticleText(html) {
  const source = String(html || '')
  const fromLd = jsonLdBody(source)
  const raw = fromLd
    ? fromLd.split(/\n+/)
    : (() => {
        const lower = source.toLowerCase()
        const at = BODY_MARKERS.map((marker) => lower.indexOf(marker.toLowerCase())).find((index) => index >= 0) ?? 0
        // 讀到文章結尾（</article>）就停，後面通常是相關新聞、留言
        const end = lower.indexOf('</article>', at)
        return paragraphsIn(source.slice(at, end > at ? Math.min(end, at + REGION_MAX) : at + REGION_MAX))
      })()
  const paragraphs = []
  let length = 0
  for (const piece of raw) {
    const text = plainText(piece, 5000)
    if (!text) continue
    if (BODY_END.test(text)) break
    // 短段落有雜訊就整段丟；長段落可能是正文夾著一句網址或宣傳，交給切句時逐句過濾
    // JSON-LD 的 articleBody 本來就是正文，不再過濾
    if (text.length < 20 || (!fromLd && text.length < 200 && JUNK.test(text))) continue
    paragraphs.push(text)
    length += text.length
    if (length > BODY_MAX) break
  }
  return paragraphs.join('\n')
}

// ---- 節錄重點 ----

const CJK = /[㐀-鿿]/
// 句首的記者署名：【財訊快報／陳孟朔】、（中央社記者○○台北5日電）
const BYLINE = /^(?:[【[][^】\]]{1,24}[】\]]|[（(][^）)]{2,30}電[）)])\s*/

const OPEN_QUOTES = '「『“（('
const CLOSE_QUOTES = '」』”）)'
const CJK_END = '。！？；!?'

// 中文斷句：引號、括號裡的句號問號不切（「今天這盤勢能不嚇人嗎？」不過…）；句尾緊接的右引號跟著前一句
function splitCjk(paragraph) {
  const pieces = []
  let depth = 0
  let current = ''
  for (let i = 0; i < paragraph.length; i += 1) {
    const char = paragraph[i]
    current += char
    if (OPEN_QUOTES.includes(char)) depth += 1
    else if (CLOSE_QUOTES.includes(char)) depth = Math.max(0, depth - 1)
    else if (depth === 0 && CJK_END.includes(char)) {
      while (i + 1 < paragraph.length && CLOSE_QUOTES.includes(paragraph[i + 1])) current += paragraph[(i += 1)]
      pieces.push(current)
      current = ''
    }
  }
  if (current) pieces.push(current)
  // 引號沒有關（原文有誤）時，整段會被當成一句：太長就退回一般斷句
  return pieces.flatMap((piece) => (piece.length > 400 ? piece.split(/(?<=[。！？；!?])\s*/) : [piece]))
}

function splitSentences(text) {
  const sentences = []
  for (const paragraph of String(text || '').split(/\n+/)) {
    const pieces = CJK.test(paragraph)
      ? splitCjk(paragraph)
      : paragraph.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'(])/)
    for (const piece of pieces) {
      const sentence = piece.replace(BYLINE, '').trim()
      if (sentence) sentences.push(sentence)
    }
  }
  return sentences
}

const CAUSAL = /受.{0,30}(?:影響|牽動|衝擊|拖累|帶動)|擔憂|憂心|導致|引發|因為|由於|主因|\b(?:because|due to|amid|driven by|fears? (?:of|that|over))\b/i

// 表格攤平成的一長串數字（例如「近5日籌碼…月營收一覽 26/10 13.21億 38% -8%…」）不是句子
function looksLikeTable(sentence) {
  const digits = (sentence.match(/\d/g) || []).length
  const numbers = (sentence.match(/-?\d+(?:[.,/]\d+)*/g) || []).length
  // 一般新聞句也常有不少數字（「下跌 18.17 點（或 5.65%），暫報 303.30 點」），數字比例高之外還要數字夠多才算表格
  // 「近1週:-17.01% 近1月:-25.67%」這種「標籤:數字」連續三組以上也是表格
  const labeled = (sentence.match(/[:：]\s*[-+]?\d/g) || []).length
  // 公告表格常帶「單位：仟元」
  if (/單位[:：]/.test(sentence)) return true
  return numbers > 10 || labeled >= 3 || (digits / sentence.length > 0.45 && numbers > 6)
}

function sentenceOk(sentence) {
  const cjk = CJK.test(sentence)
  const length = sentence.length
  if (cjk ? length < 15 : length < 40) return false
  return !JUNK.test(sentence) && !looksLikeTable(sentence)
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// 和已選的句子相似度超過這個值就不選（3 句各講不同的事）
const REDUNDANT_SIMILARITY = 0.5
// 較短那句的內容有這麼多出現在另一句，也算重複（同一件事前後各寫一次，後半段不同）
const REDUNDANT_CONTAINED = 0.6

// 句子的子句（以逗號、頓號、分號、冒號分開，去掉空白，至少 6 個字）
function clausesOf(sentence) {
  return new Set(
    sentence
      .split(/[，,、；;：:。！？!?]/)
      .map((part) => part.replace(/\s+/g, ''))
      .filter((part) => part.length >= 6),
  )
}

// a、b：{ features, clauses }
function redundant(a, b) {
  if (similarity(a.features, b.features) >= REDUNDANT_SIMILARITY) return true
  // 有兩個以上一模一樣的子句：同一件事前後各寫一次（後半段不同，整體重疊比例不高）
  let sameClauses = 0
  for (const clause of a.clauses) if (b.clauses.has(clause)) sameClauses += 1
  if (sameClauses >= 2) return true
  const [small, large] = a.features.size <= b.features.size ? [a.features, b.features] : [b.features, a.features]
  if (!small.size) return false
  let shared = 0
  for (const feature of small) if (large.has(feature)) shared += 1
  return shared / small.size >= REDUNDANT_CONTAINED
}
// 句子的特徵有這麼多比例都在標題裡，代表只是把標題換句話說
const RESTATES_TITLE = 0.8

// 節錄最重要的幾句，照原文順序。title 用來算相關程度
function keyPoints(text, title, { limit = POINTS } = {}) {
  const titleFeatures = featuresOf(title)
  const candidates = splitSentences(text)
    .slice(0, 40)
    .map((sentence, index) => ({ sentence, index, features: featuresOf(sentence), clauses: clausesOf(sentence) }))
    .filter(({ sentence }) => sentenceOk(sentence))
  // 跟全文的相關程度（中心性）：和其他句子的平均相似度，越高越可能是在講文章的核心；再換算成 0～1
  const centrality = candidates.map((a) =>
    candidates.length > 1 ? candidates.reduce((sum, b) => (a === b ? sum : sum + similarity(a.features, b.features)), 0) / (candidates.length - 1) : 0,
  )
  const maxCentrality = Math.max(0, ...centrality) || 1
  const scored = candidates.map(({ sentence, index, features }, i) => {
    let overlap = 0
    for (const feature of features) if (titleFeatures.has(feature)) overlap += 1
    const relevance = titleFeatures.size ? overlap / titleFeatures.size : 0
    let score = relevance * 3 + (centrality[i] / maxCentrality) * 2
    // 幾乎都是標題的字、又沒有多少新資訊：只是在重述標題（標題已經寫了），其他句子不夠時才拿來補
    const restates = features.size > 0 && overlap / features.size >= RESTATES_TITLE && features.size <= titleFeatures.size * 1.5
    score += index === 0 ? 3 : index === 1 ? 2 : index === 2 ? 1 : 0
    if (/\d/.test(sentence)) score += 1
    if (/[%％]|美元|億元|萬元|元|點|billion|million|trillion|percent/.test(sentence)) score += 1
    // 命中的主題越多越可能是在講事件本身（最多加 2 分）
    const themeHits = NEWS_THEMES.filter((theme) => theme.zh.some((word) => /[^\x20-\x7e]/.test(word) && sentence.includes(word))).length
    score += Math.min(2, themeHits * 0.5)
    // 交代原因的句子（受…影響、擔憂、引發）通常是整篇的重點
    if (CAUSAL.test(sentence)) score += 1.5
    return { sentence, index, score, features, clauses: clausesOf(sentence), restates }
  })
  // 分數高的先選（重述標題的排最後）；和已選的句子太像就跳過
  const picked = []
  for (const item of scored.sort((a, b) => Number(a.restates) - Number(b.restates) || b.score - a.score)) {
    if (picked.some((chosen) => redundant(chosen, item))) continue
    picked.push(item)
    if (picked.length >= limit) break
  }
  return picked
    .sort((a, b) => a.index - b.index)
    .map(({ sentence }) => truncate(sentence, CJK.test(sentence) ? 200 : 360))
}

// ---- 語氣（用詞統計，不是預測）----

const NEGATIVE_ZH = ['重挫', '暴跌', '大跌', '下跌', '走低', '崩', '失守', '新低', '下修', '虧損', '衰退', '疲弱', '賣壓', '跌破', '狂瀉', '下殺', '利空', '不如預期', '遜於預期', '血崩', '翻黑', '跌停']
const POSITIVE_ZH = ['大漲', '上漲', '飆', '走高', '創新高', '新高', '上修', '優於預期', '強勁', '轉盈', '利多', '攻上', '站上', '勁揚', '翻紅', '大增', '暴增', '反彈', '回升', '漲停']
const NEGATIVE_EN = /\b(?:plunge[sd]?|plunging|tumble[sd]?|slump(?:s|ed)?|sink(?:s)?|sank|falls?|fell|drops?|dropped|sell-?off|worst|declines?|declined|loss(?:es)?|miss(?:es|ed)?|downgrade[sd]?|weak(?:er|ness)?|crash(?:es|ed)?|slides?|slid)\b/gi
const POSITIVE_EN = /\b(?:surge[sd]?|soar(?:s|ed)?|rall(?:y|ies|ied)|jump(?:s|ed)?|gains?|gained|rises?|rose|record high|beats?|upgrade[sd]?|strong(?:er)?|boost(?:s|ed)?|climb(?:s|ed)?|comeback|rebound(?:s|ed)?|recover(?:s|ed|y)?)\b/gi

function countWords(text, words) {
  return words.reduce((sum, word) => sum + (text.split(word).length - 1), 0)
}

// 營收新聞：「年增率高達38%」是正面、「年增率-7.5%」「年減」是負面
const REVENUE_UP = /[年月]增(?:率)?(?:高達|達|約)?\s*\+?\d/g
const REVENUE_DOWN = /[年月]增(?:率)?(?:高達|達|約)?\s*-\d|[年月]減/g

function toneScore(text) {
  const source = String(text || '')
  return (
    (source.match(REVENUE_UP) || []).length -
    (source.match(REVENUE_DOWN) || []).length +
    countWords(source, POSITIVE_ZH) +
    (source.match(POSITIVE_EN) || []).length -
    countWords(source, NEGATIVE_ZH) -
    (source.match(NEGATIVE_EN) || []).length
  )
}

// 標題算兩倍；差距 2 以上才算偏多或偏空
function toneOf(title, points) {
  const score = toneScore(title) * 2 + points.reduce((sum, point) => sum + toneScore(point), 0)
  if (score >= 2) return 'positive'
  if (score <= -2) return 'negative'
  return 'neutral'
}

// 新聞清單（還沒打開過新聞重點、只有標題＋摘要）用的語氣：比 toneOf 嚴格，標題本身要有漲跌用詞、而且和整體同方向。
// 摘要裡碰巧出現的 fell、gains（政治、社會新聞）不算，避免非市場新聞被貼上偏多偏空（2026-11-07 用真實新聞抽查的誤判）
// 英文的泛用字在政治、社會新聞也常見（boost the vote、strong job numbers、miss votes），清單判斷標題時不算
const AMBIGUOUS_EN = /\b(?:boost(?:s|ed)?|strong(?:er)?|miss(?:es|ed)?|weak(?:er|ness)?|loss(?:es)?|gains?|gained)\b/gi

function listToneOf(title, summary) {
  const titleScore = toneScore(String(title || '').replace(AMBIGUOUS_EN, ' '))
  if (titleScore === 0) return 'neutral'
  const tone = toneOf(title, summary ? [summary] : [])
  return (tone === 'positive' && titleScore > 0) || (tone === 'negative' && titleScore < 0) ? tone : 'neutral'
}

// ---- 提及個股 ----

// 美股英文名稱（中文名稱沿用股市諮詢的 US_NAMES）
const US_EN_NAMES = {
  Nvidia: 'NVDA',
  Apple: 'AAPL',
  Microsoft: 'MSFT',
  Alphabet: 'GOOGL',
  Google: 'GOOGL',
  Amazon: 'AMZN',
  Meta: 'META',
  Tesla: 'TSLA',
  Broadcom: 'AVGO',
  AMD: 'AMD',
  Intel: 'INTC',
  Qualcomm: 'QCOM',
  Micron: 'MU',
  Oracle: 'ORCL',
  Netflix: 'NFLX',
  Palantir: 'PLTR',
  'Super Micro': 'SMCI',
  TSMC: 'TSM',
  Cloudflare: 'NET',
  Salesforce: 'CRM',
  Adobe: 'ADBE',
  'Berkshire Hathaway': 'BRK-B',
  JPMorgan: 'JPM',
  'Goldman Sachs': 'GS',
  CoreWeave: 'CRWV',
}
// ADR 對應的台股：台股新聞提到 ADR 大跌大漲，直接影響的是台股本身
const ADR_TO_TW = { TSM: '2330', UMC: '2303', ASX: '3711', CHT: '2412' }

// 括號裡大寫字母不是代號的情況
const PAREN_STOPWORDS = new Set([...TICKER_STOPWORDS, 'ADR', 'TSE', 'OTC', 'TPEX', 'TWSE', 'NYSE', 'ECB', 'BOJ', 'OPEC', 'IMF', 'WTO', 'EU', 'UK', 'GPU', 'HBM', 'ASIC', 'EV', 'IC'])
function overlaps(spans, start, end) {
  return spans.some(([s, e]) => start < e && end > s)
}

// directory：{ entries, nameIndex }（marketService.getDirectory）
function mentionedStocks(title, body, directory, { limit = MAX_STOCKS } = {}) {
  const titleText = String(title || '')
  const text = `${titleText}\n${String(body || '')}`
  // 先把提到的都找出來（記下第一次出現的位置），最後再排序取前 MAX_STOCKS 檔。
  // 不能找到就先佔名額：原本先比美股、名額先滿，標題裡的台積電反而被擠掉
  const stocks = []
  const seen = new Map()
  const spans = []
  const add = (stock, at = Infinity) => {
    const key = stock.market === 'tw' ? `tw:${stock.code}` : `us:${stock.symbol}`
    const found = seen.get(key)
    if (found) {
      found.at = Math.min(found.at, at)
      return
    }
    const item = { ...stock, at }
    seen.set(key, item)
    stocks.push(item)
  }
  const twStock = (entry) => ({
    market: 'tw',
    code: entry.code,
    symbol: `${entry.code}.${entry.exchange === 'otc' ? 'TWO' : 'TW'}`,
    // 證交所名稱有時帶 *（國巨*），顯示時去掉
    name: entry.name.replace(/\*/g, '').trim(),
  })
  const entries = directory?.entries || []
  const byCode = new Map(entries.map((entry) => [entry.code, entry]))

  // 美股中文名稱（台積電ADR 要比台股的「台積電」先比）
  for (const [name, symbol] of Object.entries(US_NAMES).sort((a, b) => b[0].length - a[0].length)) {
    const first = text.indexOf(name)
    if (first < 0) continue
    let start = first
    while (start >= 0) {
      spans.push([start, start + name.length])
      start = text.indexOf(name, start + name.length)
    }
    add({ market: 'us', code: null, symbol, name }, first)
  }
  // 美股英文名稱（整個字、大小寫相同）
  for (const [name, symbol] of Object.entries(US_EN_NAMES)) {
    const at = text.search(new RegExp(`(?<![A-Za-z])${name.replace(/ /g, '\\s')}(?![A-Za-z])`))
    if (at >= 0) add({ market: 'us', code: null, symbol, name }, at)
  }
  // 括號裡的美股代號：台積電ADR(TSM)、Nvidia (NVDA)。
  // 中文裡括號的英文常是縮寫（收銀機(POS)、代工(ODM)），前面緊接著中文時只有「ADR」或美股中文名稱才算
  const usNames = Object.keys(US_NAMES)
  // 鉅亨網的寫法：IREN(IREN-US)、Microsoft(MSFT-US)——有 -US 就一定是美股代號
  for (const match of text.matchAll(/[（(]([A-Z]{1,5}(?:\.[A-Z])?)-US[)）]/g)) {
    add({ market: 'us', code: null, symbol: match[1].replace('.', '-'), name: match[1] }, match.index)
  }
  for (const match of text.matchAll(/[（(]([A-Z]{1,5}(?:-[A-Z])?)[)）]/g)) {
    if (PAREN_STOPWORDS.has(match[1])) continue
    const before = text.slice(Math.max(0, match.index - 12), match.index).trimEnd()
    const afterCjk = CJK.test(before.slice(-1))
    if (afterCjk && !before.endsWith('ADR') && !usNames.some((name) => before.endsWith(name))) continue
    add({ market: 'us', code: null, symbol: match[1], name: match[1] }, match.index)
  }

  // 中文新聞提到 ADR 時，也標出對應的台股（位置跟著 ADR）
  if (CJK.test(titleText)) {
    for (const stock of [...stocks]) {
      const entry = stock.market === 'us' ? byCode.get(ADR_TO_TW[stock.symbol]) : null
      if (entry) add(twStock(entry), stock.at)
    }
  }

  // 台股代號：必須在上市櫃清單裡，而且要寫成代號的樣子——括號裡（2330）、或帶 -TW／.TW。
  // 單獨的四位數多半是年份或數字（英文新聞的 2020、2027 不是美亞、大成鋼）
  for (const match of text.matchAll(/[（(](\d{4,6}[A-Z]?)(?:-TW|\.TWO?)?[)）]|(?<![0-9A-Za-z.])(\d{4,6}[A-Z]?)(?:-TW|\.TWO?)(?![0-9A-Za-z])/g)) {
    const entry = byCode.get(match[1] || match[2])
    if (entry) {
      spans.push([match.index, match.index + match[0].length])
      add(twStock(entry), match.index)
    }
  }
  // 台股名稱：三個字以上直接算；兩個字的很多是常用詞（新興、大量、統一），只有出現在標題才算
  //（內文裡真正提到的公司通常會附代號，已經由上面的代號比對抓到）
  for (const { alias, entry } of directory?.nameIndex || buildNameIndex(entries)) {
    const start = text.indexOf(alias)
    if (start < 0 || overlaps(spans, start, start + alias.length)) continue
    if (alias.length < 3 && !titleText.includes(alias)) continue
    spans.push([start, start + alias.length])
    add(twStock(entry), start)
  }
  // 標題裡提到的排最前面（text 的開頭就是標題），其次照內文第一次出現的位置
  return stocks
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
    .map(({ at, ...stock }) => stock)
}

// ---- 與我追蹤相關（財經新聞列表的「只看與我追蹤相關」）----

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 依使用者的追蹤清單做比對函式：[{ label, test(text) }]。
// 台股：代號（0050、2330-TW）或名稱；美股：中英文名稱、括號裡的代號（MU）或 MU-US。
// 很短的英文代號（MU、ON）單獨出現容易撞到一般英文字，只認括號或 -US 的寫法
function watchMatchers(watches) {
  const matchers = []
  for (const watch of watches || []) {
    const target = watch.target || {}
    const patterns = []
    if (target.market === 'tw' && target.code) {
      // 代號前後不能接數字或英文；後面接「年」「點」之類的是數字不是代號
      patterns.push(new RegExp(`(?<![0-9A-Za-z])${escapeRegExp(target.code)}(?:-TW|\\.TWO?)?(?![0-9A-Za-z])(?!\\s*[年月日點元%％])`))
      const name = String(target.name || '').replace(/\*/g, '').replace(/[-－]?KY$/i, '').trim()
      if (name.length >= 2) patterns.push(new RegExp(escapeRegExp(name)))
    } else if (target.market === 'us' && target.symbol) {
      const symbol = escapeRegExp(target.symbol)
      patterns.push(new RegExp(`[（(]${symbol}(?:-US)?[)）]|(?<![A-Za-z])${symbol}-US(?![A-Za-z])`))
      if (target.symbol.length >= 3) patterns.push(new RegExp(`(?<![A-Za-z$])\\$?${symbol}(?![A-Za-z])`))
      const names = [
        ...Object.entries(US_NAMES).filter(([, sym]) => sym === target.symbol).map(([name]) => name),
        ...Object.entries(US_EN_NAMES).filter(([, sym]) => sym === target.symbol).map(([name]) => name),
      ]
      // Yahoo 的英文全名（Micron Technology, Inc.）取第一個字（4 個字母以上才用）
      const first = String(target.name || '').split(/[\s,]+/)[0]
      if (/^[A-Za-z][A-Za-z.&'-]{3,}$/.test(first)) names.push(first)
      for (const name of new Set(names)) {
        patterns.push(CJK.test(name) ? new RegExp(escapeRegExp(name)) : new RegExp(`(?<![A-Za-z])${escapeRegExp(name)}(?![A-Za-z])`))
      }
    }
    if (!patterns.length) continue
    const label = target.market === 'tw' ? String(target.name || target.code).replace(/\*/g, '') : target.symbol
    const key = target.market === 'tw' ? `tw:${target.code}` : `us:${target.symbol}`
    matchers.push({ key, label, test: (text) => patterns.some((pattern) => pattern.test(text)) })
  }
  return matchers
}

// ---- 組合 ----

// 主要主題：標題命中 3 分、內文每命中一次 1 分（最多 5 分）。至少 3 分、取前兩名，
// 而且第二名要有第一名的一半以上。內文順帶提到一次的主題（駭客新聞裡的「北韓」）不算
function mainThemes(title, text) {
  const inTitle = themeHits(title)
  const inText = themeHits(text)
  const scores = NEWS_THEMES.map((theme) => ({
    key: theme.key,
    score: (inTitle[theme.key] ? 3 : 0) + Math.min(5, inText[theme.key] || 0),
  }))
    .filter((t) => t.score >= 3)
    .sort((a, b) => b.score - a.score)
  const top = scores[0]?.score || 0
  return scores.filter((t, i) => i < 2 && t.score >= top / 2).map((t) => t.key)
}

function groupsOf(themes) {
  return NEWS_THEMES.filter((theme) => themes.includes(theme.key) && (theme.groups?.tw.length || theme.groups?.us.length)).map((theme) => ({
    theme: theme.key,
    label: theme.label,
    tw: theme.groups.tw,
    us: theme.groups.us,
  }))
}

// news：FinanceNews 的資料；body：原文內文（讀不到為 null）
// articleRead：原文有讀到（但可能是表格型公告，挑不出句子）
function buildDigest(news, body, directory, nowIso = new Date().toISOString(), { articleRead = Boolean(body) } = {}) {
  const hasBody = Boolean(body && body.length >= 80)
  const fromBody = hasBody ? keyPoints(body, news.title, { limit: pointLimit(body) }) : []
  let points = fromBody
  if (!points.length) points = news.summary ? keyPoints(news.summary, news.title) : []
  // 來源摘要本身是一句話就直接用；是表格攤平的文字就不放（畫面請使用者看原文）
  if (!points.length && news.summary && !looksLikeTable(news.summary) && news.summary.length >= 15) points = [news.summary]
  return {
    version: DIGEST_VERSION,
    basis: fromBody.length ? 'article' : 'summary',
    articleRead,
    points,
    tone: toneOf(news.title, points),
    // 前 10 檔顯示；後面的存在 moreStocks，只有在使用者追蹤清單裡的才會補進畫面（見 routes/financeNews.js）
    ...(() => {
      const all = mentionedStocks(news.title, hasBody ? body : news.summary, directory, { limit: 40 })
      return { stocks: all.slice(0, MAX_STOCKS), moreStocks: all.slice(MAX_STOCKS) }
    })(),
    // 族群只看全文判斷出的主要主題；沒有全文時用來源摘要
    groups: groupsOf(mainThemes(news.title, hasBody ? body : news.summary)),
    createdAt: nowIso,
  }
}

// 同步時預先產生（鉅亨網的列表附全文，跳脫過的 HTML）
function digestFromHtml(news, escapedHtml, directory, nowIso) {
  const body = extractArticleText(decodeEntities(escapedHtml))
  return buildDigest(news, body, directory, nowIso, { articleRead: true })
}

// FinanceNews：model；fetchHtml(url) → 文字，失敗時丟出帶 status 的錯誤；getDirectory()：台股清單
function createNewsDigest({ FinanceNews, fetchHtml, getDirectory, now = () => Date.now() }) {
  const running = new Map()
  const failedAt = new Map()

  async function readArticle(url) {
    let host = ''
    try {
      host = new URL(url).hostname
    } catch {
      return { body: null, permanent: true }
    }
    if (!ARTICLE_HOSTS.has(host)) return { body: null, permanent: true }
    try {
      const html = await fetchHtml(url)
      return { body: extractArticleText(html), permanent: true, read: true }
    } catch (error) {
      console.error('讀取新聞原文失敗：', error.message)
      return { body: null, permanent: PERMANENT_STATUS.has(error.status) }
    }
  }

  async function compute(doc) {
    const id = String(doc._id)
    const recentlyFailed = failedAt.has(id) && now() - failedAt.get(id) < RETRY_AFTER_MS
    const [article, directory] = await Promise.all([
      recentlyFailed ? { body: null, permanent: false } : readArticle(doc.url),
      Promise.resolve(getDirectory()).catch(() => ({ entries: [], nameIndex: [] })),
    ])
    const digest = buildDigest(doc, article.body, directory, new Date(now()).toISOString(), { articleRead: Boolean(article.read) })
    if (article.permanent) {
      failedAt.delete(id)
      await FinanceNews.updateOne({ _id: doc._id }, { $set: { digest } })
    } else if (!recentlyFailed) {
      failedAt.set(id, now())
    }
    return digest
  }

  // 回傳 null：找不到這則新聞
  async function getDigest(id) {
    const doc = await FinanceNews.findById(id).lean()
    if (!doc) return null
    if (doc.digest?.version === DIGEST_VERSION) return doc.digest
    if (!running.has(id)) {
      running.set(
        id,
        compute(doc).finally(() => running.delete(id)),
      )
    }
    return running.get(id)
  }

  return { getDigest }
}

module.exports = {
  ARTICLE_HOSTS,
  DIGEST_VERSION,
  extractArticleText,
  splitSentences,
  keyPoints,
  toneOf,
  listToneOf,
  mentionedStocks,
  watchMatchers,
  buildDigest,
  digestFromHtml,
  mainThemes,
  createNewsDigest,
}
