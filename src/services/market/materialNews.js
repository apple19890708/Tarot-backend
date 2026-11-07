// 重大訊息（v17 階段 4）：公開資訊觀測站的每日重大訊息，上市 t187ap04_L、上櫃 mopsfin_t187ap04_O。
// 來源只有當天的，抓到就存進 MarketNews（保留 30 天）；畫面讀資料庫。
const crypto = require('crypto')

const { rocDate } = require('./corporateEvents')
const { digestMaterialNews, materialFields } = require('./materialDigest')

const URLS = {
  twse: 'https://openapi.twse.com.tw/v1/opendata/t187ap04_L',
  tpex: 'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O',
}
// 來源每 30 分鐘最多抓一次
const SYNC_INTERVAL_MS = 30 * 60 * 1000
const DETAIL_MAX = 4000
const FAILURE_COOLDOWN_MS = 2 * 60 * 1000

// 發言時間 70004 → 07:00:04
function clock(raw) {
  const text = String(raw || '').trim()
  if (!text) return ''
  const digits = text.padStart(6, '0')
  return /^\d{6}$/.test(digits) ? `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}` : ''
}

// 主旨與說明有很多換行與空白（\r\n），整理成一般文字
const clean = (value) =>
  String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t　]+\n/g, '\n')
    .trim()

// 兩邊欄位名稱不同（上市的「主旨 」後面有空白），整理成同一個格式
function parseNews(twseRows, tpexRows) {
  const rows = []
  const add = (exchange, r, code, name) => {
    const date = rocDate(r['發言日期'])
    const title = clean(r['主旨'] ?? r['主旨 '])
    if (!code || !date || !title) return
    const time = clock(r['發言時間'])
    const hash = crypto.createHash('sha1').update(title).digest('hex').slice(0, 12)
    rows.push({
      key: `${code}|${date}|${time}|${hash}`,
      code,
      exchange,
      name: String(name || '').trim(),
      date,
      time,
      title: title.replace(/\n+/g, ''),
      detail: clean(r['說明']).slice(0, DETAIL_MAX),
      clause: String(r['符合條款'] || '').trim(),
    })
  }
  for (const r of twseRows || []) add('tse', r, String(r['公司代號'] || '').trim(), r['公司名稱'])
  for (const r of tpexRows || []) add('otc', r, String(r.SecuritiesCompanyCode || '').trim(), r.CompanyName)
  return rows
}

function rawFieldsOf(detail) {
  const { fields, empty } = materialFields(detail)
  return { fields, emptyFields: empty }
}

// MarketNews：Mongoose model；fetchJson：抓 JSON 的函式（測試可以注入）
function createNewsSync({ MarketNews, fetchJson, now = () => new Date() }) {
  let lastSync = 0
  let running = null

  async function sync({ force = false } = {}) {
    if (!force && now().getTime() - lastSync < SYNC_INTERVAL_MS) return null
    if (running) return running
    running = (async () => {
      const [twse, tpex] = await Promise.allSettled([fetchJson(URLS.twse), fetchJson(URLS.tpex)])
      if (twse.status === 'rejected') console.error('上市重大訊息失敗：', twse.reason?.message)
      if (tpex.status === 'rejected') console.error('上櫃重大訊息失敗：', tpex.reason?.message)
      const rows = parseNews(twse.status === 'fulfilled' ? twse.value : [], tpex.status === 'fulfilled' ? tpex.value : [])
      if (rows.length) {
        const expireAt = new Date(now().getTime() + MarketNews.KEEP_DAYS * 86400000)
        await MarketNews.bulkWrite(
          rows.map((row) => ({ updateOne: { filter: { key: row.key }, update: { $setOnInsert: { ...row, expireAt } }, upsert: true } })),
          { ordered: false },
        )
      }
      // 兩邊都失敗時 2 分鐘後再試（不要每次開頁面都等它逾時）
      lastSync = twse.status === 'fulfilled' || tpex.status === 'fulfilled' ? now().getTime() : now().getTime() - SYNC_INTERVAL_MS + FAILURE_COOLDOWN_MS
      return rows.length
    })().finally(() => {
      running = null
    })
    return running
  }

  // 指定公司最近 days 天的訊息，新的在前
  async function listFor(codes, { days = MarketNews.KEEP_DAYS, limit = 100 } = {}) {
    if (!codes.length) return []
    const since = new Date(now().getTime() - days * 86400000).toISOString().slice(0, 10)
    const docs = await MarketNews.find({ code: { $in: codes }, date: { $gte: since } })
      .sort({ date: -1, time: -1 })
      .limit(limit)
      .lean()
    // points：從說明挑出的重點欄位（讀取時才算，規則改了舊公告也跟著更新）
    return docs.map((d) => ({
      id: String(d._id),
      code: d.code,
      exchange: d.exchange,
      name: d.name,
      date: d.date,
      time: d.time,
      title: d.title,
      detail: d.detail,
      clause: d.clause,
      points: digestMaterialNews(d.detail),
      // 原文拆成欄位表（看原文時用）；不是編號格式的公告 fields 是空的，畫面直接顯示 detail
      ...rawFieldsOf(d.detail),
    }))
  }

  return { sync, listFor }
}

module.exports = { URLS, parseNews, clock, createNewsSync }
