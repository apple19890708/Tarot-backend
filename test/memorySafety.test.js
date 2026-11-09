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
