// 股票日記（v26 計畫 2-2）：一檔股票一本日記，不是每次分析一本。
// - 股票鍵：<市場>:<代號>，台股用代號（tw:0050），美股與指數用 symbol（us:NVDA、tw:^TWII）
// - 每篇可選填「記錄股票」的欄位（動作、價格、數量、寫的時候的股價、目標價、停損價），只是紀錄，不改持股
// - 2026-11-20 以前寫在單一分析底下的日記（stock:<分析 id>）用 scripts/migrateStockJournal.js 轉成那筆分析的股票（D9；v29 從啟動流程移到腳本）

const MARKETS = ['tw', 'us']
// 觀察／買進／加碼／減碼／賣出／停損
const STOCK_ACTIONS = ['watch', 'buy', 'add', 'reduce', 'sell', 'stop']
// 台股可以填張或股（1 張＝1000 股，換算沿用前端的 quantityUnit）；美股一律是股
const QUANTITY_UNITS = ['share', 'lot']
const ID_PATTERN = /^[A-Z0-9^.=-]{1,16}$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const PRICE_MAX = 10_000_000
const QUANTITY_MAX = 1_000_000_000

// 分析紀錄或追蹤項目的 target → 股票鍵；資料不完整時 null。
// 指數用 symbol（加權指數存成 code 't00'、symbol '^TWII'），沒有 symbol 才用代號（櫃買指數 'o00'）；
// 台股個股用代號；美股用 symbol。鍵只由這裡決定，比對也一律用它（api-reviewer 2026-11-20：用 Mongo 直接比對 code／symbol 會因大小寫與別名對不上）
function stockKeyOf(target) {
  if (!target || !MARKETS.includes(target.market)) return null
  let raw
  if (target.kind === 'index') raw = target.symbol || target.code
  else raw = target.market === 'tw' && target.code ? target.code : target.symbol
  const id = String(raw || '').trim().toUpperCase()
  return ID_PATTERN.test(id) ? `${target.market}:${id}` : null
}

// 自己的分析紀錄或追蹤項目裡，屬於這檔股票的（先用市場縮小範圍，再用 stockKeyOf 比對；
// 追蹤上限 30、分析上限 100，量不大）。Model 要支援 find(filter) 回傳可 await 的結果
// select：只讀需要的欄位（分析紀錄的快照與全文很大）；lean：不需要 mongoose 文件的方法時用
async function findForStock(Model, userId, stock, { sort, select = 'target', lean = true } = {}) {
  let query = Model.find({ user: userId, 'target.market': stock.market })
  if (select && query.select) query = query.select(select)
  if (sort && query.sort) query = query.sort(sort)
  if (lean && query.lean) query = query.lean()
  const docs = await query
  return docs.filter((doc) => stockKeyOf(doc.target) === stock.key)
}

// "tw:0050" → { market: 'tw', id: '0050', key: 'tw:0050' } 或 null
function parseStockKey(value) {
  if (typeof value !== 'string') return null
  const index = value.indexOf(':')
  if (index < 0) return null
  const market = value.slice(0, index).toLowerCase()
  const id = value.slice(index + 1).trim().toUpperCase()
  if (!MARKETS.includes(market) || !ID_PATTERN.test(id)) return null
  return { market, id, key: `${market}:${id}` }
}

function parseNumber(value, max, label) {
  if (value === undefined || value === null || value === '') return { value: null }
  const number = typeof value === 'number' ? value : Number.NaN
  if (!Number.isFinite(number)) return { error: `${label}要是大於 0 的數字。` }
  // 先四捨五入到小數 4 位再檢查：0.00001 進位後是 0，要擋掉（api-reviewer）
  const rounded = Math.round(number * 10000) / 10000
  if (rounded <= 0 || rounded > max) return { error: `${label}要是大於 0 的數字。` }
  return { value: rounded }
}

// 「記錄股票」的欄位：undefined＝沒帶（不改）、null＝清掉；全部可選填
function parseStockFields(value) {
  if (value === undefined) return { value: undefined }
  if (value === null) return { value: null }
  if (typeof value !== 'object' || Array.isArray(value)) return { error: '股票欄位格式不對。' }
  const known = new Set(['action', 'price', 'quantity', 'unit', 'quoteAtWrite', 'quoteDate', 'targetPrice', 'stopPrice'])
  if (Object.keys(value).some((key) => !known.has(key))) return { error: '股票欄位格式不對。' }

  const action = value.action ?? null
  if (action !== null && !STOCK_ACTIONS.includes(action)) return { error: '動作只能是觀察、買進、加碼、減碼、賣出或停損。' }
  const unit = value.unit ?? null
  if (unit !== null && !QUANTITY_UNITS.includes(unit)) return { error: '數量單位只能是張或股。' }
  const quoteDate = value.quoteDate ?? null
  if (quoteDate !== null && (typeof quoteDate !== 'string' || !DATE_PATTERN.test(quoteDate))) return { error: '股價日期格式要是 YYYY-MM-DD。' }

  const fields = { action, unit, quoteDate }
  for (const [key, max, label] of [
    ['price', PRICE_MAX, '價格'],
    ['quantity', QUANTITY_MAX, '數量'],
    ['quoteAtWrite', PRICE_MAX, '寫的時候的股價'],
    ['targetPrice', PRICE_MAX, '目標價'],
    ['stopPrice', PRICE_MAX, '停損價'],
  ]) {
    const parsed = parseNumber(value[key], max, label)
    if (parsed.error) return { error: parsed.error }
    fields[key] = parsed.value
  }
  // 什麼都沒填就當成沒有
  const filled = Object.values(fields).some((v) => v !== null)
  return { value: filled ? fields : null }
}

const STOCK_FIELDS = ['action', 'price', 'quantity', 'unit', 'quoteAtWrite', 'quoteDate', 'targetPrice', 'stopPrice']

// 有沒有填任何「記錄股票」的欄位（只有填了動作或價格，也算有寫）。
// 只看已知欄位：mongoose 子文件用 Object.values 會讀到內部屬性（api-reviewer）
function hasStockRecord(stock) {
  return Boolean(stock && STOCK_FIELDS.some((key) => stock[key] !== null && stock[key] !== undefined))
}

module.exports = {
  MARKETS,
  STOCK_ACTIONS,
  QUANTITY_UNITS,
  stockKeyOf,
  parseStockKey,
  findForStock,
  parseStockFields,
  hasStockRecord,
}
