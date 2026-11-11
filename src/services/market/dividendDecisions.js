// 公司自己公告的配息（v20 2.9.10，2026-11-11 使用者要求預估誤差在 10% 內）。來源是公開資訊觀測站的重大訊息，兩種固定格式：
//
// 1. 董事會決議股利分派：金額確定，除息日還沒訂
//    1. 董事會決議日期：115/11/04 2. 股利所屬年(季)度：115年 第3季 3. 股利所屬期間：115/07/01 至 115/09/30
//    4. 股東配發內容：(1)盈餘分配之現金股利(元/股)：2.00000000 (2)法定盈餘公積發放之現金(元/股)：0 (3)資本公積發放之現金(元/股)：0 …
// 2. 訂定除息交易日：日期確定，金額通常也有（「每股 NT$9.0 元」），沒寫每股的用同一家公司的決議補
//    1.董事會、股東會決議或公司決定日期:115/11/10 2.除權、息類別…:除息 3.普通股發放股利種類及金額:現金股利 NT$233,391,284,730元(每股 NT$9.0 元)
//    4.除權（息）交易日:116/03/11 …
//
// 證交所的除權息預告常常晚 1～3 個月才出現，這兩種公告更早。ETF 沒有這種公告（投信的收益分配不在這個來源），只適用個股。
//
// 2026-11-11 用 45 則真實決議抽查後的取捨：
// - 「不配」的決議不使用：「上半年度不分派」只代表沒有期中股利，年度股利照配（6679、3293…），拿來刪推估會刪錯
// - 決議只在對得準時用（見 decisionSlot）：台積電 11/10 決議的第 3 季股利 3 月才除息，12 月那次是更早決議的第 2 季

// 子公司的決議掛在母公司代號下，不是母公司自己的股利。不一定在開頭（「中信金控代子公司…」「本公司之子公司EDISON OPTO…」）
const SUBSIDIARY_TITLE = /代(重要)?(子|孫)公司|之(子|孫)公司/
// 決議到除息通常 1～5 個月（年度股利：3 月董事會、7～8 月除息）
const PENDING_DAYS = 180
// 存多久、配對往前看多久（MarketNews 一般只存 30 天，這兩種公告另外延長）。
// 要比 PENDING_DAYS 長很多：舊決議不參與配對的話，它的除息會被誤配到較新的決議（新的就被當成已除息）
const KEEP_DAYS = 400

// 民國日期 115/11/04 → 2026-11-04
function rocSlashDate(text) {
  const m = /(\d{2,3})\s*\/\s*(\d{1,2})\s*\/\s*(\d{1,2})/.exec(text || '')
  if (!m) return null
  return `${Number(m[1]) + 1911}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

// 「(1)盈餘分配之現金股利(元/股)：2.00000000」這類欄位的數字；全形括號、冒號都接受；找不到是 null
function perShareField(detail, label) {
  const re = new RegExp(`${label}\\s*[（(]元\\s*/\\s*股[）)]\\s*[:：]\\s*([\\d.,]+)`)
  const m = re.exec(detail)
  if (!m) return null
  const value = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

// 董事會決議 → { decidedAt, periodStart, periodEnd, cash }；不是這種格式（或是子公司的）回 null。
// cash：盈餘、法定盈餘公積、資本公積三種現金合計（每股元）；0 代表決議不配
function parseDividendDecision(title, detail) {
  if (SUBSIDIARY_TITLE.test(title || '')) return null
  const text = String(detail || '')
  if (!/股東配發內容/.test(text)) return null
  const earnings = perShareField(text, '盈餘分配之現金股利')
  if (earnings === null) return null
  const legal = perShareField(text, '法定盈餘公積發放之現金') ?? 0
  const capital = perShareField(text, '資本公積發放之現金') ?? 0
  const decidedAt = rocSlashDate(/董事會決議日期\s*[:：]\s*([^\s]+)/.exec(text)?.[1])
  const period = /股利所屬期間\s*[:：]\s*([\d/\s]+?)\s*至\s*([\d/\s]+)/.exec(text)
  if (!decidedAt) return null
  return {
    decidedAt,
    periodStart: period ? rocSlashDate(period[1]) : null,
    periodEnd: period ? rocSlashDate(period[2]) : null,
    cash: Math.round((earnings + legal + capital) * 1e8) / 1e8,
  }
}

// 訂定除息交易日 → { date, cash, decidedAt }；cash 是每股現金（原文沒寫每股的是 null）。
// 只有除權（配股）、交易日寫 NA 的回 null
function parseExDividendNotice(title, detail) {
  if (SUBSIDIARY_TITLE.test(title || '')) return null
  const text = String(detail || '')
  const date = rocSlashDate(/除權[（(]息[）)]交易日\s*[:：]\s*([^\s]+)/.exec(text)?.[1])
  if (!date) return null
  const kind = /除權、息類別[^:：]*[:：]\s*(除權息|除息|除權)/.exec(text)?.[1]
  if (kind === '除權') return null
  // 金額在「發放股利種類及金額」那一段（到「4.」為止）；有「變更後」的用變更後的（1437 調整配息率）
  const section = /發放(普通股)?股利種類及金額\s*[:：]([\s\S]*?)(?:\n|\s)4\s*[.．]/.exec(text)?.[2] ?? ''
  const amountText = section.includes('變更後') ? section.slice(section.indexOf('變更後')) : section
  const m = /每股[^\d]{0,15}?([\d.]+)\s*元/.exec(amountText)
  const cash = m && Number.isFinite(Number(m[1])) && Number(m[1]) > 0 ? Number(m[1]) : null
  const decidedAt = rocSlashDate(/決議或公司決定日期\s*[:：]\s*([^\s]+)/.exec(text)?.[1])
  return { date, cash, decidedAt }
}

const daysBetween = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000

// 還沒除息、有配息的決議（舊到新）。cashEvents：Yahoo 的實際除息（日期排序）。
// 依序配對：每一次除息，消掉「決議日在它之前、最舊的一筆還沒配對的決議」；同一期更正公告兩次只留最新的
function pendingDecisions(decisions, cashEvents, today) {
  const list = decisions
    .filter((d) => d.cash > 0 && d.decidedAt <= today && daysBetween(d.decidedAt, today) <= KEEP_DAYS)
    .sort((a, b) => (a.periodEnd || a.decidedAt).localeCompare(b.periodEnd || b.decidedAt) || a.decidedAt.localeCompare(b.decidedAt))
  const byPeriod = new Map()
  for (const d of list) byPeriod.set(d.periodEnd || d.decidedAt, d)
  const unique = [...byPeriod.values()]
  const consumed = new Set()
  for (const event of cashEvents) {
    if (event.date > today) continue
    const match = unique.find((d) => !consumed.has(d) && d.decidedAt < event.date)
    if (match) consumed.add(match)
  }
  return unique.filter((d) => !consumed.has(d) && daysBetween(d.decidedAt, today) <= PENDING_DAYS)
}

// 決議所屬期間有幾個月（季 3、半年 6、年度 12）；沒有期間是 null
function periodMonths(decision) {
  if (!decision.periodStart || !decision.periodEnd) return null
  return Math.round(daysBetween(decision.periodStart, decision.periodEnd) / 30.4)
}
const FREQUENCY_MONTHS = { quarterly: 3, semiannual: 6, annual: 12 }

// 決議對到哪一次配息。只在對得準的時候才對（回傳 slots 的 index，否則 null）：
// - 配息頻率要和決議的期間一樣長（年配的公司第一次決議期中股利 → 新的一次，不能蓋掉年度股利：4749、1817）
// - 決議後 5 個月內只有一次還沒除息的配息（季配的有兩次就分不出來：台積電 11 月決議的 3 月才除息）
// slots：[{ month: 'YYYY-MM', open }]，open＝還沒除息、可以對（推估或已公告）
function decisionSlot(decision, slots, frequency) {
  const months = periodMonths(decision)
  if (!months || FREQUENCY_MONTHS[frequency] === undefined || Math.abs(months - FREQUENCY_MONTHS[frequency]) > 1) return null
  const limit = new Date(Date.parse(decision.decidedAt) + 152 * 86400000).toISOString().slice(0, 7)
  const candidates = slots.map((slot, index) => ({ ...slot, index })).filter((slot) => slot.open && slot.month >= decision.decidedAt.slice(0, 7) && slot.month <= limit)
  return candidates.length === 1 ? candidates[0].index : null
}

module.exports = {
  parseDividendDecision,
  parseExDividendNotice,
  pendingDecisions,
  decisionSlot,
  PENDING_DAYS,
  KEEP_DAYS,
  SUBSIDIARY_TITLE,
}
