// 股市 API 共用的輸入處理（2026-11-21 從 routes/market.js 拆出來）：標的格式檢查、依前端提示重新解析標的、搜尋類的限速。
// 價位提醒（marketAlerts.js）與自訂股票追蹤（marketWatchlist.js）都用
// 標的欄位會拼進報價 API 的網址（已編碼），格式仍要先擋：
// 台股代號 4～6 碼（ETF 可能多一個字母，指數是 t00／o00）、交易所只有 tse／otc、Yahoo 代號只有英數與 .^=-
const CODE_PATTERN = /^(\d{4,6}[A-Z]?|[to]00)$/
const SYMBOL_PATTERN = /^[\w.^=-]{1,20}$/

function isTarget(raw) {
  if (!raw || typeof raw !== 'object') return false
  if (!['tw', 'us'].includes(raw.market) || !['index', 'stock'].includes(raw.kind)) return false
  const symbolOk = raw.symbol === null || raw.symbol === undefined || (typeof raw.symbol === 'string' && SYMBOL_PATTERN.test(raw.symbol))
  const codeOk = raw.code === null || raw.code === undefined || (typeof raw.code === 'string' && CODE_PATTERN.test(raw.code))
  const exchangeOk = raw.exchange === null || raw.exchange === undefined || ['tse', 'otc'].includes(raw.exchange)
  const hasId = typeof raw.symbol === 'string' || (typeof raw.code === 'string' && typeof raw.exchange === 'string')
  return symbolOk && codeOk && exchangeOk && hasId
}

function pickTarget(raw) {
  const str = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : null)
  return {
    symbol: str(raw.symbol),
    code: str(raw.code),
    exchange: str(raw.exchange, 10),
    market: raw.market,
    kind: raw.kind,
    name: str(raw.name, 60) || str(raw.symbol) || str(raw.code) || '',
  }
}

// 前端帶來的標的（下拉選單、操作建議）只當成「要找哪一檔」的提示，存進資料庫的一律是後端重新解析的結果，
// 避免存進不存在的代號或互相矛盾的欄位（例如 symbol 是 2330、code 是 2454）
function hintOf(raw, market) {
  if (!isTarget(raw) || raw.market !== market) return null
  if (market === 'tw') return raw.kind === 'index' ? raw.name || raw.code : raw.code || raw.symbol
  return raw.symbol
}

async function resolveFromRequest(marketService, body, market) {
  const hint = hintOf(body.target, market)
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, 50) : ''
  const text = typeof hint === 'string' && hint ? hint.slice(0, 50) : query
  if (!text) return null
  const found = await marketService.resolveTarget(text, market)
  return found && isTarget(found) ? pickTarget(found) : null
}

// 每個使用者每分鐘最多這麼多次：下拉搜尋 60 次（前端有 250ms 防抖，正常打字遠低於這個量）、選股 10 次
const SEARCH_WINDOW_MS = 60 * 1000
const SEARCH_MAX_PER_WINDOW = 60
function createSearchLimiter(max = SEARCH_MAX_PER_WINDOW, message = '搜尋太頻繁，請稍後再試。') {
  const hits = new Map()
  return function searchLimit(req, res, next) {
    const key = String(req.auth?.userId || req.ip || 'unknown')
    const now = Date.now()
    const entry = hits.get(key)
    if (!entry || now - entry.start > SEARCH_WINDOW_MS) {
      hits.set(key, { start: now, count: 1 })
      // 順手清掉過期的，Map 不會無限長大
      if (hits.size > 1000) {
        for (const [k, v] of hits) if (now - v.start > SEARCH_WINDOW_MS) hits.delete(k)
      }
      next()
      return
    }
    entry.count += 1
    if (entry.count > max) {
      res.status(429).json({ message })
      return
    }
    next()
  }
}

// 數字欄位：數字或非空字串轉成數字，其他（空字串、null、物件）是 NaN，呼叫端當成錯誤
const toPositive = (value) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN)

module.exports = { isTarget, pickTarget, resolveFromRequest, createSearchLimiter, toPositive }
