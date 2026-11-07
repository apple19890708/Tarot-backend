// 財經新聞（v17 規格 G）：國內外免費公開來源（RSS／鉅亨網 JSON），抓到就存進 FinanceNews（保留 7 天）。
// 只存標題、來源給的摘要與連結，不轉載全文；主題標籤用 data/newsThemes.js 的關鍵字表，不呼叫 AI。
const crypto = require('crypto')

const { NEWS_THEMES } = require('../../data/newsThemes')
const { MARKET_KEYWORDS } = require('./symbols')

const SOURCES = [
  { key: 'cnbc', label: 'CNBC', region: 'intl', lang: 'en', type: 'rss', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  {
    key: 'marketwatch',
    label: 'MarketWatch',
    region: 'intl',
    lang: 'en',
    type: 'rss',
    url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories',
  },
  {
    key: 'cnyes-intl',
    label: '鉅亨網',
    region: 'intl',
    lang: 'zh',
    type: 'cnyes',
    url: 'https://api.cnyes.com/media/api/v1/newslist/category/wd_stock?limit=30',
  },
  {
    key: 'cnyes-tw',
    label: '鉅亨網',
    region: 'tw',
    lang: 'zh',
    type: 'cnyes',
    url: 'https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=30',
  },
  { key: 'yahoo-tw', label: 'Yahoo 股市', region: 'tw', lang: 'zh', type: 'rss', url: 'https://tw.stock.yahoo.com/rss?category=news' },
]

// 來源每 15 分鐘最多抓一次；全部失敗時 2 分鐘後再試
const SYNC_INTERVAL_MS = 15 * 60 * 1000
const FAILURE_COOLDOWN_MS = 2 * 60 * 1000
const SUMMARY_MAX = 300
const TITLE_MAX = 300
// 每個來源最多收幾則（RSS 有時一次給上百則）
const PER_SOURCE_LIMIT = 40
// 外部內容不可信：解析前先截短，避免異常的超長內容拖慢 regex（去標籤是平方級）
const RAW_TITLE_MAX = 2000
const RAW_SUMMARY_MAX = 5000
const RSS_ITEM_MAX = 200
// 發布時間比現在晚超過這麼久的當成資料錯誤丟掉，免得一直排在最前面
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000
const KEY_ID_MAX = 100

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text) {
  return String(text || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ''
    }
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

// 去掉 HTML 標籤、合併空白。鉅亨網的內文是「跳脫過的 HTML」，要先解一次再去標籤。
// 最後剩下的 < > 換成全形：這些文字會放進給 AI 的 <news> 區塊，不能讓新聞內容提早關掉標籤、偽造其他區塊
function plainText(value, max = RAW_SUMMARY_MAX) {
  return decodeEntities(
    decodeEntities(String(value || '').slice(0, max))
      .replace(/<[^>]*>/g, ' ')
      .replace(/<[^>]*$/, ' '),
  )
    .replace(/</g, '＜')
    .replace(/>/g, '＞')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// 只接受 http／https 的連結，避免 javascript: 之類的東西進到畫面
function safeUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

// 一個 <item> 裡某個標籤的內容（含 CDATA）
function tagContent(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!match) return ''
  return match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
}

// 很小的 RSS 解析：只取 title、link、description、pubDate、guid。不支援 Atom（目前的來源都是 RSS 2.0）。
// 用 indexOf 逐段切（線性時間），最多 RSS_ITEM_MAX 則
function parseRss(xml) {
  const text = String(xml || '')
  const lower = text.toLowerCase()
  const blocks = []
  let from = 0
  while (blocks.length < RSS_ITEM_MAX) {
    let start = lower.indexOf('<item', from)
    // <items> 之類的其他標籤不算
    while (start >= 0 && !/[\s>]/.test(lower[start + 5] || '')) start = lower.indexOf('<item', start + 5)
    if (start < 0) break
    const end = lower.indexOf('</item>', start)
    if (end < 0) break
    blocks.push(text.slice(start, end + 7))
    from = end + 7
  }
  const items = []
  for (const block of blocks) {
    items.push({
      title: tagContent(block, 'title'),
      link: tagContent(block, 'link'),
      description: tagContent(block, 'description'),
      pubDate: tagContent(block, 'pubDate'),
      guid: tagContent(block, 'guid'),
    })
  }
  return items
}

// 標題裡的台股代號：「華建(2530)」「京元電子(2449-TW)」
function codesIn(text) {
  const codes = new Set()
  for (const match of String(text || '').matchAll(/[（(](\d{4})(?:-TW)?[)）]/g)) codes.add(match[1])
  return [...codes]
}

// 中文關鍵字的例外：前後接某些字時是別的詞，不算命中（真實新聞抽查到的誤判）
// - 毛利率、淨利率、股票殖利率不是利率（公債殖利率另外列成關鍵字，不受影響）
// - 「產業數據中心報導」是優分析的署名，不是在講資料中心
// - 「就業金卡」是簽證，不是就業數據
const ZH_EXCEPTIONS = {
  利率: { notAfter: ['毛', '淨', '殖'] },
  數據中心: { notAfter: ['產業'] },
  就業: { notBefore: ['金卡'] },
}

// 有例外的中文關鍵字編成帶 g 的 RegExp，其他維持字串（用包含比對）
function zhPattern(word, escape) {
  const rule = ZH_EXCEPTIONS[word]
  if (!rule) return word
  const before = (rule.notAfter || []).map((text) => `(?<!${escape(text)})`).join('')
  const after = (rule.notBefore || []).map((text) => `(?!${escape(text)})`).join('')
  return new RegExp(`${before}${escape(word)}${after}`, 'g')
}

// 中文關鍵字（字串或帶 g 的 RegExp）在文字裡出現幾次
function countWord(source, word) {
  return typeof word === 'string' ? source.split(word).length - 1 : (source.match(word) || []).length
}

// 把關鍵字表編成比對函式：英文（ASCII）比對整個字，有大寫的要大小寫相同；中文用包含
function compileThemes(themes) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return themes.map((theme) => {
    const words = [...new Set([...(theme.zh || []), ...(theme.en || [])])]
    const ascii = words.filter((word) => /^[\x20-\x7e]+$/.test(word))
    const others = words.filter((word) => !/^[\x20-\x7e]+$/.test(word))
    const sensitive = ascii.filter((word) => /[A-Z]/.test(word))
    const insensitive = ascii.filter((word) => !/[A-Z]/.test(word))
    const build = (list, flags) =>
      list.length ? new RegExp(`(?<![A-Za-z0-9])(?:${list.map(escape).join('|')})(?![A-Za-z0-9])`, flags) : null
    return {
      key: theme.key,
      sensitive: build(sensitive, ''),
      insensitive: build(insensitive, 'i'),
      // 計算命中次數用（帶 g；和上面分開，避免 test() 被 lastIndex 影響）
      sensitiveAll: build(sensitive, 'g'),
      insensitiveAll: build(insensitive, 'gi'),
      // 中文用包含；ZH_EXCEPTIONS 列的例外不算（「毛利率」不是「利率」）
      others: others.map((word) => zhPattern(word, escape)),
    }
  })
}

const COMPILED_THEMES = compileThemes(NEWS_THEMES)

function themesOf(text) {
  const source = String(text || '')
  return COMPILED_THEMES.filter(
    (theme) =>
      theme.sensitive?.test(source) || theme.insensitive?.test(source) || theme.others.some((word) => countWord(source, word) > 0),
  ).map((theme) => theme.key)
}

// 每個主題的關鍵字在文字裡出現幾次：{ ai: 3, semi: 1 }（新聞重點用全文判斷主要主題）
function themeHits(text) {
  const source = String(text || '')
  const hits = {}
  for (const theme of COMPILED_THEMES) {
    const count =
      (theme.sensitiveAll ? (source.match(theme.sensitiveAll) || []).length : 0) +
      (theme.insensitiveAll ? (source.match(theme.insensitiveAll) || []).length : 0) +
      theme.others.reduce((sum, word) => sum + countWord(source, word), 0)
    if (count) hits[theme.key] = count
  }
  return hits
}

// ---- 同一事件合併 ----

const EN_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'after', 'over', 'into', 'than', 'what', 'have', 'here', 'more', 'about', 'their', 'says', 'said', 'will', 'just'])

// 文字的「特徵」：中文兩個字一組、英文 4 個字母以上的單字（數字不算，所以只差在數字的速報會被當成同一件事）
function featuresOf(text) {
  const features = new Set()
  const lower = String(text || '').toLowerCase()
  for (const word of lower.match(/[a-z][a-z'-]{3,}/g) || []) if (!EN_STOP.has(word)) features.add(word)
  const cjk = lower.replace(/[^\u3400-\u9fff]/g, ' ')
  for (const run of cjk.split(/\s+/)) for (let i = 0; i + 1 < run.length; i += 1) features.add(run.slice(i, i + 2))
  return features
}

// 兩組特徵的重疊比例（Jaccard）
function similarity(a, b) {
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const feature of a) if (b.has(feature)) shared += 1
  return shared / (a.size + b.size - shared)
}

const CLUSTER_WINDOW_MS = 36 * 3600000
// 標題太短（特徵太少）不合併，避免巧合
const CLUSTER_MIN_FEATURES = 4

// 一則標題的用字（數字不算）完全包含在另一則裡才算同一件事：只差數字的速報、轉載的同一篇會合併；
// 格式相同但公司或指數不同的（「瑞昱／台富 10 月營收公告」「集中市場／櫃買市場速報」）差了名稱，不會合併
function sameEvent(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  if (small.size < CLUSTER_MIN_FEATURES) return false
  for (const feature of small) if (!large.has(feature)) return false
  return true
}

// 依標題把同一件事的新聞歸成一群：items 新的在前，每一則加上 clusterId（群裡最新那則的 id）。
// 兩則都提到台股代號但代號不同也不合併
function clusterNews(items) {
  const heads = []
  return items.map((item) => {
    const features = featuresOf(item.title)
    const codes = (item.codes || []).join(',')
    const time = Date.parse(item.publishedAt)
    const head = heads.find(
      (h) =>
        Math.abs(h.time - time) <= CLUSTER_WINDOW_MS &&
        !(codes && h.codes && codes !== h.codes) &&
        sameEvent(features, h.features),
    )
    if (head) return { ...item, clusterId: head.id }
    heads.push({ id: item.id, features, codes, time })
    return { ...item, clusterId: item.id }
  })
}

// 企業新聞稿（美國商業資訊／Business Wire 代發）不是新聞，一律不收
const PRESS_RELEASE = /美國商業資訊|BUSINESS\s*WIRE/i
// Yahoo 股市的「【公告】」是公開資訊觀測站自動轉貼（月營收、董事會決議、法說會…），財報季一次幾十則、多半是小型股，會洗版。
// 照樣存，列表時只留公司在使用者追蹤清單裡的（路由判斷），AI 分析不讀
const MOPS_REPOST = /^【公告】/
function isMopsRepost(item) {
  return item?.source === 'yahoo-tw' && MOPS_REPOST.test(String(item.title || '').trim())
}
// 這些來源混有非財經內容（遊戲、娛樂、社會新聞），沒有財經主題、沒提到股票、也沒有股市字眼的不收。
// 鉅亨網的「國際股」也會收一般國際新聞（例如「歐洲客機遭炸彈威脅」）。CNBC、MarketWatch 是英文財經媒體，不套用
const MIXED_SOURCES = new Set(['yahoo-tw', 'cnyes-intl', 'cnyes-tw'])
// 股市字眼（MARKET_KEYWORDS）以外的財經用語：市場制度、融資券、併購、貿易、總體經濟
const FINANCE_WORDS = /市場|上市|上櫃|櫃買|興櫃|融資|融券|資券|資減|券增|收購|併購|合併|反傾銷|傾銷|稅|預算|經濟|產值|出口|進口|訂單|央行|利率|通膨|債|基金|銀行|保險|證券|期貨|外資|法人|獲利|虧損|股東|董事會|法說|IPO/

function isNoise(item) {
  const text = `${item.title || ''} ${item.summary || ''}`
  if (PRESS_RELEASE.test(text)) return true
  if (!MIXED_SOURCES.has(item.source)) return false
  return !(item.themes || []).length && !(item.codes || []).length && !MARKET_KEYWORDS.test(text) && !FINANCE_WORDS.test(text)
}

function hash(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 16)
}

// 整理成存檔格式；沒有標題、連結或時間的丟掉
function normalize(source, raw, nowMs) {
  const title = truncate(plainText(raw.title, RAW_TITLE_MAX), TITLE_MAX)
  const url = safeUrl(raw.url)
  const publishedAt = validDate(raw.publishedAt)
  if (!title || !url || !publishedAt) return null
  if (publishedAt.getTime() > nowMs + FUTURE_TOLERANCE_MS) return null
  const summary = truncate(plainText(raw.summary, RAW_SUMMARY_MAX), SUMMARY_MAX)
  const id = raw.id ? String(raw.id) : ''
  return {
    key: `${source.key}|${id && id.length <= KEY_ID_MAX ? id : hash(id || url)}`,
    source: source.key,
    sourceLabel: source.label,
    region: source.region,
    lang: source.lang,
    title,
    summary: summary === title ? '' : summary,
    url,
    publishedAt,
    themes: themesOf(`${title} ${summary}`),
    codes: source.region === 'tw' ? codesIn(title) : [],
    ...(raw.html ? { articleHtml: raw.html } : {}),
  }
}

function parseSource(source, payload, nowMs = Date.now()) {
  let raws = []
  if (source.type === 'rss') {
    raws = parseRss(payload).map((item) => ({
      id: item.guid && !/^https?:/i.test(item.guid.trim()) ? item.guid.trim() : null,
      title: item.title,
      url: decodeEntities(item.link),
      summary: item.description,
      publishedAt: item.pubDate,
    }))
  } else if (source.type === 'cnyes') {
    const rows = payload?.items?.data
    raws = (Array.isArray(rows) ? rows : []).map((row) => ({
      id: row.newsId,
      title: row.title,
      url: row.newsId ? `https://news.cnyes.com/news/id/${encodeURIComponent(row.newsId)}` : null,
      summary: row.summary || row.content,
      // 鉅亨網的列表就附全文（跳脫過的 HTML），同步時拿來預先產生新聞重點，不存
      html: typeof row.content === 'string' ? row.content : null,
      publishedAt: Number.isFinite(row.publishAt) ? new Date(row.publishAt * 1000) : null,
    }))
  }
  return raws
    .map((raw) => normalize(source, raw, nowMs))
    .filter((row) => row && !isNoise(row))
    .slice(0, PER_SOURCE_LIMIT)
}

// FinanceNews：Mongoose model；fetchText(url) → 文字（測試可以注入）
// prepareDigest(row, articleHtml)：有附全文的來源（鉅亨網）同步時就先產生新聞重點，打開不用再讀原文；沒傳就略過
function createFinanceNewsSync({ FinanceNews, fetchText, sources = SOURCES, now = () => new Date(), prepareDigest = null }) {
  let lastSync = 0
  let lastStatus = sources.map((source) => ({ key: source.key, label: source.label, region: source.region, ok: null, count: 0 }))
  let lastSyncedAt = null
  let running = null

  async function syncSource(source) {
    const text = await fetchText(source.url)
    return parseSource(source, source.type === 'cnyes' ? JSON.parse(text) : text, now().getTime())
  }

  async function sync({ force = false } = {}) {
    if (!force && now().getTime() - lastSync < SYNC_INTERVAL_MS) return null
    if (running) return running
    running = (async () => {
      const results = await Promise.allSettled(sources.map((source) => syncSource(source)))
      const rows = []
      lastStatus = sources.map((source, index) => {
        const result = results[index]
        if (result.status === 'rejected') {
          console.error(`財經新聞來源 ${source.key} 失敗：`, result.reason?.message)
          return { key: source.key, label: source.label, region: source.region, ok: false, count: 0 }
        }
        rows.push(...result.value)
        return { key: source.key, label: source.label, region: source.region, ok: true, count: result.value.length }
      })
      const anyOk = results.some((result) => result.status === 'fulfilled')
      // 全部失敗或寫入資料庫失敗時 2 分鐘後再試，不要每個請求都重抓 5 個來源
      lastSync = now().getTime() - SYNC_INTERVAL_MS + FAILURE_COOLDOWN_MS
      for (const row of rows) {
        const html = row.articleHtml
        delete row.articleHtml
        if (!html || !prepareDigest) continue
        try {
          row.digest = await prepareDigest(row, html)
        } catch (error) {
          console.error('預先產生新聞重點失敗：', error.message)
        }
      }
      if (rows.length) {
        const expireAt = new Date(now().getTime() + FinanceNews.KEEP_DAYS * 86400000)
        // 已經存過的不覆蓋（以第一次抓到的為準），保留 7 天也從第一次抓到算起
        await FinanceNews.bulkWrite(
          rows.map((row) => ({ updateOne: { filter: { key: row.key }, update: { $setOnInsert: { ...row, expireAt } }, upsert: true } })),
          { ordered: false },
        )
      }
      if (anyOk) {
        lastSync = now().getTime()
        lastSyncedAt = now().toISOString()
      }
      return rows.length
    })().finally(() => {
      running = null
    })
    return running
  }

  // 最近 days 天的新聞，新的在前；region：tw／intl，theme：主題 key（都可不給）
  async function list({ days = 3, limit = 200, region = null, theme = null, since = null } = {}) {
    const filter = { publishedAt: { $gte: since || new Date(now().getTime() - days * 86400000) } }
    if (region) filter.region = region
    if (theme) filter.themes = theme
    // 新聞重點只取提及個股（列表要用來判斷「與我追蹤相關」），重點句與族群不讀
    const docs = await FinanceNews.find(filter).select('-digest.points -digest.groups').sort({ publishedAt: -1 }).limit(limit).lean()
    // 規則加上之前就存進來的雜訊，列表時也濾掉
    // 主題用目前的規則重新判斷（規則修正前存進來的也跟著更新）；規則只會少標不會多標，所以先用資料庫篩再補篩
    return docs
      .filter((doc) => !isNoise(doc))
      .map(toJSON)
      .filter((item) => !theme || item.themes.includes(theme))
  }

  function status() {
    return { syncedAt: lastSyncedAt, sources: lastStatus }
  }

  return { sync, list, status }
}

function toJSON(doc) {
  return {
    id: String(doc._id),
    source: doc.source,
    sourceLabel: doc.sourceLabel,
    region: doc.region,
    lang: doc.lang,
    title: doc.title,
    summary: doc.summary || '',
    url: doc.url,
    publishedAt: new Date(doc.publishedAt).toISOString(),
    themes: themesOf(`${doc.title} ${doc.summary || ''}`),
    codes: doc.codes || [],
    // 已經產生過新聞重點的話：用全文算的語氣（和彈窗一致）；沒有的話路由用標題＋摘要算
    digestTone: doc.digest?.tone ?? null,
    // 新聞重點的規則版本：路由只採用目前版本算出的語氣（舊版本的會在下次打開時重算）
    digestVersion: doc.digest?.version ?? null,
    // 已經產生過新聞重點的話：全文裡提到的個股（tw:2330、us:MU），路由用來算「與我追蹤相關」，不回傳給前端
    mentions: [...(doc.digest?.stocks || []), ...(doc.digest?.moreStocks || [])].map((stock) =>
      stock.market === 'tw' ? `tw:${stock.code}` : `us:${stock.symbol}`,
    ),
  }
}

module.exports = {
  SOURCES,
  SYNC_INTERVAL_MS,
  decodeEntities,
  plainText,
  safeUrl,
  parseRss,
  parseSource,
  codesIn,
  themesOf,
  themeHits,
  featuresOf,
  similarity,
  clusterNews,
  isNoise,
  isMopsRepost,
  createFinanceNewsSync,
}
