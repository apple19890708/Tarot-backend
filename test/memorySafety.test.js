const test = require('node:test')
const assert = require('node:assert/strict')

const { createTwseData } = require('../src/services/market/twseData')
const { dateTimeFormat } = require('../src/lib/intlFormat')

// 和 marketService 的快取同樣介面的最小版本
function memoryCache() {
  const store = new Map()
  return {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
  }
}

// 2026-11-09：自選清單 N 檔同時查籌碼，同一天的全市場三大法人被下載 N 次（8 檔 × 7 天 = 56 次），
// 記憶體衝過 512MB、Cloud Run 把主機砍掉。同一份資料下載中時，後來的呼叫要等同一個結果
test('多檔股票同時查籌碼：同一天的全市場資料只下載一次', async () => {
  const calls = new Map()
  const fetchJson = async (url) => {
    calls.set(url, (calls.get(url) || 0) + 1)
    await new Promise((resolve) => setTimeout(resolve, 20))
    if (url.includes('/fund/T86')) {
      return { stat: 'OK', data: [['2330', '台積電', 0, 0, '1,000', 0, 0, '0', 0, 0, '200', '300', 0, 0, 0, 0, 0, 0, '1,500']] }
    }
    if (url.includes('MI_MARGN')) return { stat: 'OK', tables: [] }
    return null
  }
  const twse = createTwseData({ fetchJson, cache: memoryCache(), today: () => '2026-11-06' })
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']
  const targets = ['2330', '2317', '2454', '0050', '2308', '2382', '2881', '2412'].map((code) => ({
    market: 'tw',
    kind: 'stock',
    exchange: 'tse',
    code,
  }))

  await Promise.all(targets.map((target) => twse.getChips(target, dates)))

  const t86 = [...calls].filter(([url]) => url.includes('/fund/T86'))
  assert.equal(t86.length, dates.length, '每一天各一個網址')
  for (const [url, count] of t86) assert.equal(count, 1, `${url} 只能下載一次`)
})

test('下載失敗時不會卡住：之後的呼叫會重新下載', async () => {
  let attempts = 0
  const fetchJson = async () => {
    attempts += 1
    if (attempts === 1) throw new Error('暫時失敗')
    return { stat: 'OK', data: [] }
  }
  const twse = createTwseData({ fetchJson, cache: memoryCache(), today: () => '2026-11-06' })
  const target = { market: 'tw', kind: 'stock', exchange: 'tse', code: '2330' }

  await assert.rejects(twse.getChips(target, ['2026-11-06']))
  await twse.getChips(target, ['2026-11-06'])
  assert.ok(attempts >= 2, '失敗後下一次要重新下載，不能一直拿到同一個失敗的 promise')
})

// 每 new 一個 Intl.DateTimeFormat 約 27KB 原生記憶體，K 線每根都 new 會讓記憶體暴增
test('dateTimeFormat：同樣的 locale 與選項重用同一個格式器', () => {
  const options = { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }
  const a = dateTimeFormat('en-CA', options)
  const b = dateTimeFormat('en-CA', { ...options })
  assert.equal(a, b)
  assert.notEqual(a, dateTimeFormat('en-CA', { ...options, timeZone: 'America/New_York' }))
  assert.equal(a.format(new Date('2026-11-08T17:00:00Z')), '2026-11-09')
})

// 估值改和同產業比（金融股本益比天生低、半導體天生高）
test('估值：同產業至少 8 家時另外算同產業百分位，判讀以同產業為準；產業資料抓不到就退回全市場', async () => {
  const { describeValuation } = require('../src/services/market/twseData')
  // 60 家公司：前 10 家金融（本益比 8～17），其餘 50 家半導體（本益比 20～69）
  const codes = Array.from({ length: 60 }, (_, i) => String(1000 + i))
  const pe = (i) => (i < 10 ? 8 + i : 20 + (i - 10))
  const valuationRows = codes.map((code, i) => ({ Code: code, PEratio: String(pe(i)), DividendYield: '3', PBratio: '1.5' }))
  const companies = codes.map((code, i) => ({ 公司代號: code, 產業別: i < 10 ? '17' : '24' }))
  const make = (withIndustry) =>
    createTwseData({
      fetchJson: async (url) => {
        if (url.includes('BWIBBU_ALL')) return valuationRows
        if (url.includes('t187ap03_L')) {
          if (!withIndustry) throw new Error('down')
          return companies
        }
        return []
      },
      cache: memoryCache(),
      today: () => '2026-11-06',
    })

  // 金融股裡本益比最高的（17 倍）：全市場只贏 9 家（15%，偏便宜），同產業贏 9/10 = 90%（偏貴）
  const v = await make(true).getValuation('1009')
  assert.equal(v.pePercentile, 15)
  assert.equal(v.industry.label, '金融保險')
  assert.equal(v.industry.count, 10)
  assert.equal(v.industry.pePercentile, 90)
  const described = describeValuation(v)
  assert.equal(described.expensive, true)
  assert.match(described.notes[0], /同產業（金融保險）公司，估值偏貴/)

  // 產業資料抓不到：沒有 industry，照全市場判斷
  const fallback = await make(false).getValuation('1009')
  assert.equal(fallback.industry, null)
  assert.match(describeValuation(fallback).notes[0], /上市櫃公司，估值偏便宜/)
})

test('估值：證交所 OpenAPI 被擋（回 HTML）時改抓網站版，上市股票的估值不會消失', async () => {
  const twse = createTwseData({
    fetchJson: async (url) => {
      if (url.includes('BWIBBU_ALL')) throw new SyntaxError(`Unexpected token '<', "<html>" is not valid JSON`)
      if (url.includes('BWIBBU_d')) {
        return { stat: 'OK', data: Array.from({ length: 60 }, (_, i) => [String(2000 + i), `股${i}`, '100', '3.5', 114, i === 0 ? '-' : String(10 + i), '1.2', '115/2']) }
      }
      return []
    },
    cache: memoryCache(),
    today: () => '2026-11-06',
  })
  const v = await twse.getValuation('2005')
  assert.equal(v.pe, 15)
  assert.equal(v.dividendYield, 3.5)
  // 本益比「-」（虧損）當成沒有
  assert.equal((await twse.getValuation('2000')).pe, null)
})
