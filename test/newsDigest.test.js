const test = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')

const {
  watchMatchers,
  digestFromHtml,
  mainThemes,
  extractArticleText,
  splitSentences,
  keyPoints,
  toneOf,
  mentionedStocks,
  buildDigest,
  createNewsDigest,
  DIGEST_VERSION,
} = require('../src/services/market/newsDigest')
const { buildNameIndex } = require('../src/services/market/symbols')

const ENTRIES = [
  { code: '2330', name: '台積電', exchange: 'tse' },
  { code: '2303', name: '聯電', exchange: 'tse' },
  { code: '1216', name: '統一', exchange: 'tse' },
  { code: '2449', name: '京元電子', exchange: 'tse' },
]
const DIRECTORY = { entries: ENTRIES, nameIndex: buildNameIndex(ENTRIES) }

const YAHOO_HTML = `<html><body><p>首頁新聞股市運動TV汽機車購物中心拍賣氣象App 下載搜尋登入首頁股市</p>
<article><div class="atoms" data-component="blocks"><p class="x">【財訊快報／陳孟朔】全球股市週四(5日)走低，美股科技股賣壓沉重，那指暴跌5.52%，費城半導體指數狂瀉約12%。台積電ADR(TSM)下跌42.65美元或10.78%，收報353.10美元，創近7個月收盤新低。聯電ADR(UMC)跌勢更重，下跌2.68美元或16.69%。<br/><br/>晶片股賣壓自亞洲交易時段浮現，美股跌勢隨後擴大，標普500指數也重挫4.4%。</p></div></article>
<p>相關內容台股跌慘了！特斯拉與輝達都大跌，延伸閱讀請點這裡看更多的內容與分析</p></body></html>`

test('抽出內文：只取文章本體，讀到 </article> 就停、跳過導覽列', () => {
  const body = extractArticleText(YAHOO_HTML)
  assert.match(body, /全球股市週四/)
  assert.match(body, /晶片股賣壓/)
  assert.doesNotMatch(body, /首頁新聞/)
  assert.doesNotMatch(body, /特斯拉/)
})

test('抽出內文：有 JSON-LD 的 articleBody 就用它；長段落裡夾著網址不會整段丟掉', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'NewsArticle',
    articleBody: '根據FactSet最新調查，共15位分析師，對京元電子(2449-TW)做出2026年EPS預估：中位數由8.38元下修至8.12元，預估目標價為330元。詳細資訊請看台股內頁：https://www.cnyes.com/twstock/2449',
  })}</script><p>其他段落其他段落其他段落其他段落</p>`
  const body = extractArticleText(html)
  assert.match(body, /京元電子/)
  const points = keyPoints(body, '京元電子EPS預估下修')
  assert.equal(points.length, 1, '網址那句被逐句過濾掉')
  assert.match(points[0], /中位數由8\.38元下修至8\.12元/)
})

test('切句：中文用句號、英文用句點加大寫開頭；去掉句首的記者署名', () => {
  assert.deepEqual(splitSentences('【財訊快報／陳孟朔】第一句。第二句！'), ['第一句。', '第二句！'])
  assert.deepEqual(splitSentences('Stocks fell 5%. Nvidia dropped. ok'), ['Stocks fell 5%.', 'Nvidia dropped. ok'])
})

test('節錄重點：前段、和標題相關、有數字的句子優先，照原文順序', () => {
  const body = extractArticleText(YAHOO_HTML)
  const points = keyPoints(body, '費半暴跌逾一成，台積電ADR週四瀉近11%至7個月新低，聯電ADR挫16.69%')
  assert.equal(points.length, 3)
  assert.match(points[0], /^全球股市週四/)
  assert.ok(points.some((p) => p.includes('台積電ADR(TSM)')))
})

test('語氣：用詞統計，標題算兩倍', () => {
  assert.equal(toneOf('費半暴跌逾一成，台積電ADR重挫', []), 'negative')
  assert.equal(toneOf('Cloudflare stock surges after record high', []), 'positive')
  assert.equal(toneOf('The October jobs report is out Friday', ['Here is what to expect.']), 'neutral')
})

test('提及個股：美股中文名稱與括號代號、台股代號與名稱；兩個字的名稱要在標題或出現兩次', () => {
  const stocks = mentionedStocks('台積電ADR瀉近11%，聯電ADR挫16.69%', '台積電ADR(TSM)下跌。聯電ADR(UMC)跌更重。京元電子(2449)下修。統一發票中獎號碼公布。', DIRECTORY)
  const keys = stocks.map((s) => (s.market === 'tw' ? s.code : s.symbol))
  assert.ok(keys.includes('TSM'))
  assert.ok(keys.includes('UMC'))
  assert.ok(keys.includes('2303'), '聯電在標題裡')
  assert.ok(keys.includes('2449'))
  assert.ok(!keys.includes('1216'), '「統一」只出現一次又不在標題，不算')
  assert.ok(keys.includes('2330'), '中文新聞提到台積電ADR，也標出台股的台積電')
  assert.equal(keys.filter((k) => k === '2330').length, 1)
  assert.equal(stocks.find((s) => s.code === '2449').symbol, '2449.TW')
})

test('提及個股：英文公司名稱比對整個字，括號裡的縮寫不當代號', () => {
  const stocks = mentionedStocks('Nvidia and Super Micro slide', 'Spending on GPUs (GPU) and the Federal Reserve (FOMC) metadata', DIRECTORY)
  assert.deepEqual(stocks.map((s) => s.symbol).sort(), ['NVDA', 'SMCI'])
})

test('組合：讀不到原文時只用來源摘要；族群依主題對照', () => {
  const digest = buildDigest(
    { title: 'Cloudflare stock surges on AI demand', summary: 'Demand for automated AI protection is on the rise in Cloudflare earnings results.', themes: ['ai'] },
    null,
    DIRECTORY,
  )
  assert.equal(digest.basis, 'summary')
  assert.equal(digest.version, DIGEST_VERSION)
  assert.equal(digest.points.length, 1)
  assert.equal(digest.tone, 'positive')
  assert.deepEqual(digest.stocks.map((s) => s.symbol), ['NET'])
  assert.equal(digest.groups[0].theme, 'ai')
  assert.ok(digest.groups[0].tw.includes('散熱'))
})

// ---- 服務：快取、只讀允許的網域、暫時失敗不存 ----

function fakeModel(doc) {
  const updates = []
  return {
    updates,
    findById: (id) => ({ lean: async () => (String(id) === String(doc._id) ? { ...doc } : null) }),
    updateOne: async (filter, update) => {
      updates.push(update)
      doc.digest = update.$set.digest
    },
  }
}

function newsDoc(url) {
  return { _id: new mongoose.Types.ObjectId(), title: '費半暴跌，聯電ADR挫16.69%', summary: '摘要', url, themes: ['semi'], digest: null }
}

test('服務：第一次讀原文並存起來，之後直接用存的；同時打開只讀一次', async () => {
  const doc = newsDoc('https://tw.stock.yahoo.com/news/a.html')
  const Model = fakeModel(doc)
  let fetches = 0
  const service = createNewsDigest({
    FinanceNews: Model,
    getDirectory: async () => DIRECTORY,
    fetchHtml: async () => {
      fetches += 1
      await new Promise((resolve) => setTimeout(resolve, 20))
      return YAHOO_HTML
    },
  })
  const [a, b] = await Promise.all([service.getDigest(String(doc._id)), service.getDigest(String(doc._id))])
  assert.equal(fetches, 1)
  assert.equal(a.basis, 'article')
  assert.deepEqual(a, b)
  assert.equal(Model.updates.length, 1)
  await service.getDigest(String(doc._id))
  assert.equal(fetches, 1, '已存的直接用')
  assert.equal(await service.getDigest(String(new mongoose.Types.ObjectId())), null)
})

test('服務：不在允許網域的網址不讀；暫時失敗不存、2 分鐘內不重讀；401 存起來', async () => {
  let fetches = 0
  const other = newsDoc('https://evil.example.com/a')
  const service = createNewsDigest({
    FinanceNews: fakeModel(other),
    getDirectory: async () => DIRECTORY,
    fetchHtml: async () => {
      fetches += 1
      return ''
    },
  })
  const digest = await service.getDigest(String(other._id))
  assert.equal(fetches, 0)
  assert.equal(digest.basis, 'summary')

  let clock = 0
  let status = 503
  const doc = newsDoc('https://www.cnbc.com/a.html')
  const Model = fakeModel(doc)
  const flaky = createNewsDigest({
    FinanceNews: Model,
    now: () => clock,
    getDirectory: async () => DIRECTORY,
    fetchHtml: async () => {
      fetches += 1
      const error = new Error('fail')
      error.status = status
      throw error
    },
  })
  await flaky.getDigest(String(doc._id))
  assert.equal(Model.updates.length, 0, '暫時失敗不存')
  await flaky.getDigest(String(doc._id))
  assert.equal(fetches, 1, '2 分鐘內不重讀')
  clock = 3 * 60 * 1000
  status = 401
  await flaky.getDigest(String(doc._id))
  assert.equal(fetches, 2)
  assert.equal(Model.updates.length, 1, '原站拒絕就存起來，不再重讀')
})

test('截圖回報的誤判：表格數字不當重點句、中文裡括號的縮寫不當美股代號', () => {
  const body =
    '振樺電(8114-TW)今天公告2026年10月營收為新台幣13.21億元，年增率38.15%，月增率-8.28%。' +
    '今年1-10月累計營收為149.94億元，累計年增率-7.5%。' +
    '近5日籌碼三大法人合計買賣超：-466張外資買賣超：-447張投信買賣超：-17張自營商買賣超：-2張近6個月營收一覽月份月營收年增率月增率26/1013.21億38%-8%26/914.41億45%-7%26/815.42億39%-22%26/719.67億41%-1%。' +
    '振樺電主要產品為收銀機(POS)與工業電腦，台積電ADR(TSM)與輝達(NVDA)不在此列。'
  const points = keyPoints(body, '營收速報 - 振樺電(8114)10月營收13.21億元年增率高達38.15%')
  assert.ok(!points.some((p) => p.includes('近5日籌碼')))
  const symbols = mentionedStocks('振樺電10月營收', body, DIRECTORY).filter((s) => s.market === 'us').map((s) => s.symbol)
  assert.ok(!symbols.includes('POS'))
  assert.ok(symbols.includes('TSM'))
  assert.ok(symbols.includes('NVDA'))
})

test('截圖回報：交代原因的句子要選進重點', () => {
  const body = [
    '台股今（6）日盤中暴跌超過3千點，最低觸及37837點，跌點接近4千點，寫下史上盤中最大，超越今年7月17日，4萬點、3萬9、3萬8關卡一次失守。',
    '受美國期中選舉後政治「藍色浪潮」牽動，市場擔憂未來對 AI 資料中心建設與相關科技產業的審查和監管收緊，引發科技股與晶片股的大逃殺。美股四大指數今天全面收黑。與台股連動密切的費城半導體指數暴跌12.25%，創史上第 2 大單日跌幅，',
    '其他輝達、美光等半導體與 AI巨擘遭到沉重拋售。台積電ADR收盤重挫42.65點，跌幅10.78%，收在353.1點。台指期收盤慘跌2946點。',
    '回顧歷史統計，台股史上盤中第一大跌點是今年7月17日的2953點；第二大為今年6月8日，盤中下跌2694點；第三大是7月29日，盤中下跌2218點。',
  ].join('\n')
  const points = keyPoints(body, '台股暴跌逾3千點！史上盤中最大 4萬點沒了')
  assert.ok(points.some((p) => p.startsWith('受美國期中選舉後')), points.join('\n'))
  const keys = mentionedStocks('台股暴跌逾3千點！史上盤中最大 4萬點沒了', body, DIRECTORY).map((s) => s.code || s.symbol)
  assert.deepEqual(keys.sort(), ['2330', 'MU', 'NVDA', 'TSM'])
})

test('截圖回報（第二批）：數字多的一般句子要保留；表格型公告不放摘要；名稱去掉星號', () => {
  const body =
    '截至台北時間06日09:00，櫃買市場加權指數下跌18.17點（或5.65%），暫報303.30點。' +
    '歷史漲跌幅 近1週:-17.01% 近1月:-25.67% 近3月:-16.23% 近6月:-21.1% 今年以來:+16.37% 焦點個股 電阻與電感概念領跌-9.08%。' +
    '測試介面概念領跌-8.93%，國巨*(2327)與健策(3653)跌幅居前。'
  const points = keyPoints(body, '盤中速報 - 櫃買市場加權指數下跌-18.17點至303.3點，跌幅5.65%')
  assert.ok(points[0].startsWith('截至台北時間06日09:00'), points.join('\n'))
  assert.ok(!points.some((p) => p.startsWith('歷史漲跌幅')))

  const entries = [{ code: '2327', name: '國巨*', exchange: 'tse' }]
  const stocks = mentionedStocks('櫃買下跌', body, { entries, nameIndex: buildNameIndex(entries) })
  assert.equal(stocks[0].name, '國巨')

  const table = '日期：2026年11月06日上市公司：台富(1454)單位：仟元【公告】台富 2026年10月合併營收 (單位：仟元)項目合併營業收入淨額本月102,876去年同期114,552增減金額-11,676增減百分比-10.19%本年累計1,032,123去年累計1,101,234'
  const digest = buildDigest({ title: '【公告】台富 2026年10月合併營收1.03億元 年增-10.19%', summary: table, themes: [] }, '', DIRECTORY, undefined, { articleRead: true })
  assert.equal(digest.basis, 'summary')
  assert.equal(digest.articleRead, true, '原文有讀到，只是挑不出句子')
  assert.deepEqual(digest.points, [], '表格文字不放進重點')
})

test('全面檢查找到的：年份不是代號、兩個字的常用詞只在標題才算、-US 代號、營收年增算正面', () => {
  const entries = [
    { code: '2020', name: '美亞', exchange: 'tse' },
    { code: '2027', name: '大成鋼', exchange: 'tse' },
    { code: '2605', name: '新興', exchange: 'tse' },
    { code: '2454', name: '聯發科', exchange: 'tse' },
    { code: '2530', name: '華建', exchange: 'tse' },
  ]
  const directory = { entries, nameIndex: buildNameIndex(entries) }
  const en = mentionedStocks('IRS unveils higher capital gains tax brackets for 2027', 'The worst day since 2020. Rates for 2027 rise.', directory)
  assert.deepEqual(en, [], '英文新聞裡的年份不是台股代號')

  const zh = mentionedStocks(
    '台股暴跌近4千點！等於憑空消失2家聯發科',
    '新興市場賣壓沉重，新興科技股遭大量拋售。相當於一次少掉兩家聯發科（2454）之多。IREN(IREN-US)與微軟Microsoft(MSFT-US)。',
    directory,
  )
  const keys = zh.map((s) => s.code || s.symbol)
  assert.ok(!keys.includes('2605'), '「新興」是常用詞，不在標題就不算')
  assert.ok(keys.includes('2454'))
  assert.ok(keys.includes('IREN'))
  assert.ok(keys.includes('MSFT'))

  assert.equal(toneOf('營收速報 - 華建(2530)10月營收15.52億元年增率高達2703.91％', ['今年1-10月累計營收為17.83億元。']), 'positive')
  assert.equal(toneOf('營收速報 - 台富10月營收1.03億元 年增率-10.19%', []), 'negative')
})

test('優化：主要主題看全文比重，順帶提到一次的主題不列族群', () => {
  const title = 'Chainalysis追蹤幣安贓款，發現63億美元被盜資產流入中國'
  const body = '區塊鏈分析公司指稱，盜走加密貨幣的駭客正透過洗錢網絡轉移資產。駭客已透過TRON區塊鏈轉移約5億美元。有分析師認為駭客可能來自北韓。加密貨幣交易所加強監控。'
  assert.deepEqual(mainThemes(title, body), ['crypto'])
})

test('優化：只是重述標題的句子扣分、太像的句子只留一句', () => {
  const title = '台積電10月營收創新高 年增50%'
  const body = [
    '台積電10月營收創新高，年增50%。',
    '台積電今日公布10月合併營收達3,500億元，較去年同期成長50%，主要受惠AI晶片需求強勁。',
    '台積電今日公布10月合併營收達3,500億元，較去年同期大幅成長50%。',
    '法人指出，先進製程產能持續滿載，第四季營收可望再創高。',
    '公司預計下週舉行法說會，說明明年資本支出規劃。',
  ].join('')
  const points = keyPoints(body, title)
  assert.ok(!points.includes('台積電10月營收創新高，年增50%。'), '重述標題的那句不選')
  const dupes = points.filter((p) => p.startsWith('台積電今日公布10月合併營收達3,500億元'))
  assert.equal(dupes.length, 1, '兩句幾乎一樣，只留一句')
})

test('優化：鉅亨網附的全文（跳脫過的 HTML）可以直接產生重點', () => {
  const escaped = '&lt;p&gt;振樺電(8114-TW)今天公告2026年10月營收為新台幣13.21億元，年增率38.15%，月增率-8.28%。&lt;/p&gt;&lt;p&gt;今年1-10月累計營收為149.94億元，累計年增率-7.5%。&lt;/p&gt;'
  const digest = digestFromHtml({ title: '營收速報 - 振樺電(8114)10月營收13.21億元年增率高達38.15%', summary: '', themes: [] }, escaped, DIRECTORY)
  assert.equal(digest.basis, 'article')
  assert.equal(digest.articleRead, true)
  assert.match(digest.points[0], /^振樺電\(8114-TW\)今天公告/)
})

test('與我追蹤相關：台股代號與名稱、美股中英文名稱與括號代號；短代號不誤判', () => {
  const matchers = watchMatchers([
    { target: { market: 'tw', code: '0050', name: '元大台灣50' } },
    { target: { market: 'tw', code: '00919', name: '群益台灣精選高息' } },
    { target: { market: 'us', symbol: 'MU', name: 'Micron Technology, Inc.' } },
    { target: { market: 'tw', code: '2327', name: '國巨*' } },
  ])
  const hits = (text) => matchers.filter((m) => m.test(text)).map((m) => m.label)
  assert.deepEqual(hits('0050 單日爆量，元大台灣50 折價擴大'), ['元大台灣50'])
  assert.deepEqual(hits('高股息ETF 00919 配息公告'), ['群益台灣精選高息'])
  assert.deepEqual(hits('記憶體族群重挫，美光跌逾 8%'), ['MU'])
  assert.deepEqual(hits('Micron shares slid after guidance'), ['MU'])
  assert.deepEqual(hits('記憶體大廠(MU-US)公布財報'), ['MU'])
  assert.deepEqual(hits('國巨(2327-TW)下跌9.91%'), ['國巨'])
  assert.deepEqual(hits('MUST READ: the music industry'), [], 'MU 不能撞到一般英文字')
  assert.deepEqual(hits('指數下跌 0050 點'), [], '代號後面接「點」是數字')
  assert.deepEqual(hits('買進 100500 張'), [], '更長數字的一部分不算')
})

test('截圖回報：標題裡的台積電不能被一長串美股擠掉；超過 10 檔的放進 moreStocks', () => {
  const title = '晶片股殺到甜甜價？《巴隆》點名買入台積電等五檔優質股'
  const body = '英特爾、輝達、超微、博通、美光、高通、安謀、谷歌、蘋果、微軟、特斯拉、亞馬遜都在名單上，其中也包括台積電。'
  const stocks = mentionedStocks(title, body, DIRECTORY)
  assert.equal(stocks[0].code, '2330', '標題裡的排第一')
  assert.equal(stocks.length, 10)
  const digest = buildDigest({ title, summary: body, themes: [] }, null, DIRECTORY)
  assert.equal(digest.stocks.length, 10)
  assert.ok(digest.moreStocks.length >= 3)
})

test('截圖回報：引號裡的問號不切開；同一件事寫兩次只選一句', () => {
  assert.deepEqual(splitSentences('分析師直言「今天這盤勢能不嚇人嗎？」不過，由於台積電難得跌停，是「難得送錢、撿便宜的機會」。'), [
    '分析師直言「今天這盤勢能不嚇人嗎？」不過，由於台積電難得跌停，是「難得送錢、撿便宜的機會」。',
  ])
  assert.deepEqual(splitSentences('他說：「漲太多了。」市場隨即反應。'), ['他說：「漲太多了。」市場隨即反應。'])
  assert.deepEqual(splitSentences('第一句。」第二句。'), ['第一句。」', '第二句。'], '多出來的右引號不會讓後面都切不開')

  const title = '台股暴跌近4千點！台積電跌停'
  const body = [
    '台股今（6）日遭遇極端恐慌性賣壓，盤中狂瀉近 4,000 點、創下歷史最大跌點，權王台積電（2330）首當其衝，盤中一度觸及 2,020 元跌停價，引發市場強烈震撼。',
    '分析師直言「今天這盤勢能不嚇人嗎？」不過，由於台積電難得跌停，是「難得送錢、撿便宜的機會」。',
    '融資斷頭賣壓湧現，外資單日賣超逾千億元。',
    '權王台積電（2330）首當其衝，盤中一度觸及 2,020 元跌停價，大跌 220 元，一舉超越 7 月 17 日創下的紀錄，寫下史上最大盤中跌點。',
  ].join('')
  const points = keyPoints(body, title, { limit: 4 })
  assert.equal(points.filter((p) => p.includes('2,020 元跌停價')).length, 1, points.join('\n'))
  assert.ok(!points.some((p) => p.startsWith('」')))
})
