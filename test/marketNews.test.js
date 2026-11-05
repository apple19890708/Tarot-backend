const test = require('node:test')
const assert = require('node:assert/strict')

const { parseNews, clock, createNewsSync, URLS } = require('../src/services/market/materialNews')

test('發言時間補零；上市、上櫃欄位不同（上市的「主旨 」有空白）合併成同一格式', () => {
  assert.equal(clock('70004'), '07:00:04')
  assert.equal(clock('143000'), '14:30:00')
  assert.equal(clock(''), '')
  const rows = parseNews(
    [{ 發言日期: '1151104', 發言時間: '70004', 公司代號: '2330', 公司名稱: '台積電', '主旨 ': '公告本公司\r\n董事會決議', 符合條款: '第11款', 說明: '1.事實發生日\r\n2.內容' }],
    [{ 發言日期: '1151104', 發言時間: '94226', SecuritiesCompanyCode: '6233', CompanyName: '旺玖', 主旨: '公告第三季財報', 說明: '說明' }],
  )
  assert.equal(rows.length, 2)
  assert.deepEqual(
    { code: rows[0].code, exchange: rows[0].exchange, date: rows[0].date, time: rows[0].time, title: rows[0].title, detail: rows[0].detail },
    { code: '2330', exchange: 'tse', date: '2026-11-04', time: '07:00:04', title: '公告本公司董事會決議', detail: '1.事實發生日\n2.內容' },
  )
  assert.equal(rows[1].exchange, 'otc')
  assert.ok(rows[0].key.startsWith('2330|2026-11-04|07:00:04|'))
  // 沒有主旨或代號的略過
  assert.equal(parseNews([{ 發言日期: '1151104', 公司代號: '2330', '主旨 ': '' }], []).length, 0)
})

test('同步：30 分鐘內不重抓；寫入用 upsert 去重；只查指定公司', async () => {
  let clockMs = Date.parse('2026-11-05T02:00:00Z')
  const writes = []
  let fetches = 0
  const stored = [
    { _id: 'n1', code: '2330', exchange: 'tse', name: '台積電', date: '2026-11-04', time: '07:00:04', title: 'A', detail: '', clause: '' },
    { _id: 'n2', code: '9999', exchange: 'tse', name: '別家', date: '2026-11-04', time: '08:00:00', title: 'B', detail: '', clause: '' },
  ]
  const MarketNews = {
    KEEP_DAYS: 30,
    bulkWrite: async (ops) => writes.push(...ops),
    find: (query) => ({
      sort: () => ({
        limit: () => ({ lean: async () => stored.filter((d) => query.code.$in.includes(d.code) && d.date >= query.date.$gte) }),
      }),
    }),
  }
  const sync = createNewsSync({
    MarketNews,
    now: () => new Date(clockMs),
    fetchJson: async (url) => {
      fetches += 1
      return url === URLS.twse ? [{ 發言日期: '1151104', 發言時間: '70004', 公司代號: '2330', 公司名稱: '台積電', '主旨 ': 'A' }] : []
    },
  })
  assert.equal(await sync.sync(), 1)
  assert.equal(fetches, 2)
  assert.equal(writes[0].updateOne.upsert, true)
  assert.ok(writes[0].updateOne.update.$setOnInsert.expireAt)
  assert.equal(await sync.sync(), null)
  assert.equal(fetches, 2)
  clockMs += 31 * 60 * 1000
  await sync.sync()
  assert.equal(fetches, 4)

  const list = await sync.listFor(['2330'])
  assert.deepEqual(list.map((n) => n.code), ['2330'])
  assert.deepEqual(await sync.listFor([]), [])
})
