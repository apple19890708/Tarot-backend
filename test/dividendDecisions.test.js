const test = require('node:test')
const assert = require('node:assert/strict')

const { parseDividendDecision, parseExDividendNotice, pendingDecisions } = require('../src/services/market/dividendDecisions')

// 公開資訊觀測站重大訊息的原文格式（2026-11 實際資料：8467、7780、1437）
const detailOf = (decided, period, cash, legal = '0', capital = '0') =>
  `1. 董事會決議日期：${decided} 2. 股利所屬年(季)度：115年 第3季 3. 股利所屬期間：${period} 4. 股東配發內容： (1)盈餘分配之現金股利(元/股)：${cash} (2)法定盈餘公積發放之現金(元/股)：${legal} (3)資本公積發放之現金(元/股)：${capital} (4)股東配發之現金(股利)總金額(元)：96,747,150 (5)盈餘轉增資配股(元/股)：0 5. 其他應敘明事項： 無`

test('董事會股利決議：解析決議日、所屬期間、三種現金合計', () => {
  assert.deepEqual(parseDividendDecision('公告本公司董事會通過分派115年第3季盈餘', detailOf('115/11/04', '115/07/01 至 115/09/30', '2.00000000')), {
    decidedAt: '2026-11-04',
    periodStart: '2026-07-01',
    periodEnd: '2026-09-30',
    cash: 2,
  })
  // 盈餘＋資本公積
  assert.equal(parseDividendDecision('董事會決議股利分派', detailOf('115/11/09', '115/01/01 至 115/06/30', '0.12588796', '0', '0.3')).cash, 0.42588796)
  // 不配也是決議（0）
  assert.equal(parseDividendDecision('公告本公司董事會決議115年第三季不分配股利', detailOf('115/11/09', '115/07/01 至 115/09/30', '0')).cash, 0)
})

test('董事會股利決議：子公司代公告、不是股利分派格式的不算', () => {
  const detail = detailOf('115/11/06', '115/07/01 至 115/09/30', '1.5')
  assert.equal(parseDividendDecision('代重要子公司可寧衛企業股份有限公司公告董事會決議115年第3季現金股利分派事宜', detail), null)
  assert.equal(parseDividendDecision('代子公司ACI HOLDINGS,LLC公告董事會決議辦理現金增資', detail), null)
  // 不在開頭的子公司寫法
  assert.equal(parseDividendDecision('中信金控代子公司Land and Houses Bank PublicCompany Limited', detail), null)
  assert.equal(parseDividendDecision('本公司之子公司EDISON OPTO USA CORPORATION辦理盈餘分配', detail), null)
  // 母公司自己的（標題沒有子公司字樣）照樣算
  assert.equal(parseDividendDecision('公告本公司董事會決議股利分派', detail).cash, 1.5)
  // 現金增資的公告也有「元/股」，但沒有股東配發內容
  assert.equal(parseDividendDecision('公告本公司董事會決議辦理現金增資發行新股', '1.董事會決議日期:115/11/06 8.發行價格:馬來西亞令吉1元/股'), null)
})

test('董事會股利決議：依序配對除息，只留還沒除息、有配息的', () => {
  const decisions = [
    { decidedAt: '2026-02-10', periodEnd: '2025-12-31', cash: 1 },
    { decidedAt: '2026-05-10', periodEnd: '2026-03-31', cash: 1.2 },
    { decidedAt: '2026-08-10', periodEnd: '2026-06-30', cash: 1.5 },
  ]
  const cash = [
    { date: '2026-06-15', amount: 1 },
    { date: '2026-09-15', amount: 1.2 },
  ]
  // 6 月的除息配第一筆、9 月配第二筆 → 8/10 那筆還沒除息
  assert.deepEqual(pendingDecisions(decisions, cash, '2026-11-11').map((d) => d.decidedAt), ['2026-08-10'])
  // 同一期更正公告兩次只留最新的
  const corrected = [...decisions, { decidedAt: '2026-08-12', periodEnd: '2026-06-30', cash: 1.6 }]
  assert.deepEqual(pendingDecisions(corrected, cash, '2026-11-11').map((d) => d.cash), [1.6])
  // 不配的不算（「上半年度不分派」不代表年度股利不配）
  assert.deepEqual(pendingDecisions([{ decidedAt: '2026-11-05', periodEnd: '2026-06-30', cash: 0 }], cash, '2026-11-11'), [])
  // 太舊的（超過 180 天）不算還沒除息
  assert.deepEqual(pendingDecisions([{ decidedAt: '2026-04-01', periodEnd: '2025-12-31', cash: 1 }], [], '2026-11-11'), [])
})

test('訂定除息交易日：解析交易日與每股金額（各種寫法、變更後），沒寫每股是 null；配股、NA、子公司不算', () => {
  // 2026-11 實際原文（節錄）
  const head = (decided) => `1.董事會、股東會決議或公司決定日期:${decided} 2.除權、息類別（請填入「除權」、「除息」或「除權息」）:除息 `
  const tsmc = `${head('115/11/10')}3.普通股發放股利種類及金額:現金股利 NT$233,391,284,730元(每股 NT$9.0 元) 4.除權（息）交易日:116/03/11 5.最後過戶日:116/03/12`
  assert.deepEqual(parseExDividendNotice('本公司訂定民國115年第三季之現金股利除息交易日', tsmc), { date: '2027-03-11', cash: 9, decidedAt: '2026-11-10' })
  const t6548 = `${head('115/11/06')}3.發放普通股股利種類及金額: 普通股現金股利新台幣430,022,122元，每股配發新台幣0.46元。 4.除權（息）交易日:116/03/18 5.最後過戶日:116/03/19`
  assert.equal(parseExDividendNotice('公告本公司董事會決議通過訂定民國115年第三季盈餘之現金股利暨除息基準日', t6548).cash, 0.46)
  const t1707 = `${head('115/11/09')}3.普通股發放股利種類及金額: 每股無償配發現金股利新台幣1.9元，共計新台幣281,461,009元。 4.除權（息）交易日:115/12/30 5.最後過戶日:116/01/02`
  assert.deepEqual(parseExDividendNotice('公告本公司董事長訂定115年上半年度現金股利除息基準日相關事宜', t1707), { date: '2026-12-30', cash: 1.9, decidedAt: '2026-11-09' })
  // 調整配息率：用變更後的
  const t1437 = `${head('115/11/09')}3.普通股發放股利種類及金額: (1)原發放股利種類及金額: 現金股利新台幣124,850,197元，每股配發新台幣0.62元。 (2)變更後發放股利種類及金額: 現金股利新台幣124,850,197元，每股配發新台幣0.62465299元。 4.除權（息）交易日:115/12/03 5.最後過戶日:115/12/06`
  assert.equal(parseExDividendNotice('公告本公司115年第二季盈餘分配發放現金股利，訂定除息基準日及調整配息率', t1437).cash, 0.62465299)
  // 只寫總金額 → null（用決議補）
  const t6613 = `${head('115/11/05')}3.發放普通股股利種類及金額:普通股現金股利新台幣389,007,425元 4.除權（息）交易日:116/02/11 5.最後過戶日:116/02/12`
  assert.deepEqual(parseExDividendNotice('公告本公司董事會決議通過115年上半年度現金股利除息基準日', t6613), { date: '2027-02-11', cash: null, decidedAt: '2026-11-05' })
  // 子公司、交易日 NA
  const sub = `${head('115/11/10')}3.發放股利種類及金額: 盈餘分配發放現金股利新臺幣30,000,000元(每股約10.00元) 4.除權（息）交易日:NA 5.最後過戶日:NA`
  assert.equal(parseExDividendNotice('代重要子公司加璽企業股份有限公司 公告現金股利除息基準日', sub.replace('NA 5', '116/01/10 5')), null)
  assert.equal(parseExDividendNotice('公告現金股利除息基準日', sub), null)
  // 只有配股
  const stockOnly = '1.董事會、股東會決議或公司決定日期:115/11/10 2.除權、息類別（請填入「除權」、「除息」或「除權息」）:除權 3.發放股利種類及金額:股票股利每股1元 4.除權（息）交易日:116/01/10 5.最後過戶日:NA'
  assert.equal(parseExDividendNotice('公告除權基準日', stockOnly), null)
})
