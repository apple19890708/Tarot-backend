// 個股 AI 深度分析（v17 規格 F）：系統指示與交給 AI 的資料。
// 只做文字組裝，不呼叫 AI；串流由 narrationService.streamChat 負責。
const { formatMarketForPrompt } = require('./marketService')
const { taipeiTime } = require('./financeNewsAnalysis')

const STOCK_ANALYSIS_PROMPT = `你是一位說話直接、重視數據的台股與美股分析師，正在替使用者分析他追蹤的一檔股票。你會收到 <market_data>（查詢當下的報價、技術指標、籌碼、估值、歷史回測、機器學習預測與規則算出的操作建議），可能還有 <holding>（使用者自己的持股與損益）、<events>（除權息、月營收）與 <news>（近期重大訊息）。

數據的使用：
- 價格、漲跌、指標、損益數字**只能用資料裡有的**，不可以自行編造或回憶任何價格、新聞、財報、法人買賣超、目標價。資料沒有的就不提。
- 數字照資料寫，不要改寫成其他精度；提到價位時要說明它來自哪裡（例如「MA20 的 46,680」「近 20 日低點 41,855」）。
- 資料是盤中時，要提醒收盤前還會變動；資料是收盤時，要寫出是哪一天的收盤。
- 資料的備註寫著查不到或從缺的，要在開場一句話交代，並說明這會讓判斷少了哪一塊。
- 資料裡的「判讀」與「操作建議（規則計算）」畫面上也會顯示。你的方向判斷、停損與目標價**必須和操作建議一致**，不可以給出相反的方向或不同的停損；你的工作是解釋為什麼，並補上情境細節。
- 有「長期建議（規則計算）」時，談長期持有、存股一律以它為準（年線是長期的關鍵價位）；短中期和長期結論不同是正常的（例如短線偏空、長期仍適合持有），要分開講清楚，不要混在一起。
- 引用訊號當理由時，要附上這個訊號在這檔標的的歷史表現，並和基準比較；差距不到 5 個百分點要直說沒有明顯優勢。機器學習標示不可靠時，要明講不要拿這個機率做決定。
- 重大訊息只能引用 <news> 裡的主旨與說明，不要延伸成資料沒寫的利多或利空。

語氣：
- 繁體中文，口語、直接，用「你」稱呼使用者，不要用第一人稱。
- 先給結論，再解釋原因；判斷要明確（偏多、偏空或區間整理），不要兩邊都說。
- 不談塔羅、牌面或運勢。

結構（使用 Markdown）：
1. 開場一段：直接給結論（短線方向＋最關鍵的一個價位），一兩句話。
2. ## 現況：價位、漲跌、在均線的哪一側、近 5／20／60 日表現。
3. ## 技術面：趨勢、動能、量能各一段，最後列出支撐與壓力價位（項目清單）。
4. ## 籌碼與估值：資料裡有才寫。法人動向、融資，估值在全市場的位置。
5. ## 回測與預測怎麼看：資料裡有才寫。目前訊號過去的勝率與基準差距、策略比較、模型機率與可信度。
6. ## 事件與消息：資料裡有除權息、月營收或重大訊息才寫，說明它們對接下來的影響要盯什麼。
7. ## 依你的持股：有 <holding> 才寫。用他的平均成本與損益，分別寫續抱、加碼、減碼各要看到什麼價位或訊號才做；沒有持股就改成「還沒持有的話」，寫進場要等的條件。有長期建議時，分「短線」與「長期」各寫一段。
8. ## 主要風險：兩到四個項目，每個都要有可以觀察的價位或指標。
9. 最後一行固定寫：「以上僅供參考，不是投資建議。」

格式：只用 ## 標題、項目清單（-）、粗體、→ 箭頭；不要表格、不要表情符號。全文約 800 到 1400 字。`

function money(value) {
  return value === null || value === undefined ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function formatHolding(holding) {
  if (!holding) return ''
  const unit = holding.market === 'tw' ? '張' : '股'
  const lines = [
    `持有 ${money(holding.quantity)} ${unit}，平均成本 ${money(holding.avgCost)}（含買進手續費），總成本 ${money(holding.costBasis)}`,
    `市值 ${money(holding.marketValue)}，未實現損益 ${money(holding.unrealized)}（${holding.unrealizedPct ?? '—'}%，已扣預估賣出成本）`,
    `已實現損益 ${money(holding.realized)}，股利 ${money(holding.dividends)}，總報酬 ${money(holding.totalReturn)}`,
  ]
  return lines.join('\n')
}

function formatEvents(events) {
  if (!events) return ''
  const lines = []
  if (events.exDividend) {
    const e = events.exDividend
    const parts = [e.cashDividend ? `現金股利 ${e.cashDividend} 元` : '', e.stockRatio ? `配股比率 ${e.stockRatio}` : ''].filter(Boolean)
    lines.push(`除權息：${e.date} 除${e.type}${parts.length ? `，${parts.join('、')}` : ''}`)
  }
  if (events.revenue) {
    const r = events.revenue
    lines.push(`月營收（${r.month}）：${money(r.revenue)} 千元，月增 ${r.mom ?? '—'}%、年增 ${r.yoy ?? '—'}%、累計年增 ${r.cumYoy ?? '—'}%${r.note ? `；備註：${r.note}` : ''}`)
  }
  return lines.join('\n')
}

// 重大訊息的說明可能很長，每則截到 600 字
function formatNews(news) {
  if (!news?.length) return ''
  return news.map((n) => `- ${n.date} ${n.title}\n  ${String(n.detail || '').slice(0, 600)}`).join('\n')
}

function buildStockAnalysisMessage({ snapshot, holding = null, news = [], now = new Date() }) {
  // 現在時間（含星期）：「今天」「昨天」、盤中或收盤由 AI 對照資料時間判斷，不讓它自己推算星期
  const sections = [`現在時間：${taipeiTime(now, { withYear: true })} 台北時間。`, `<market_data>\n${formatMarketForPrompt(snapshot)}\n</market_data>`]
  const holdingText = formatHolding(holding)
  if (holdingText) sections.push(`<holding>\n${holdingText}\n</holding>`)
  const eventsText = formatEvents(snapshot.events)
  if (eventsText) sections.push(`<events>\n${eventsText}\n</events>`)
  const newsText = formatNews(news)
  if (newsText) sections.push(`<news>\n${newsText}\n</news>`)
  sections.push('請依照上述資料撰寫這檔股票的分析。')
  return sections.join('\n\n')
}

function buildStockAnalysisMessages(input) {
  return [
    { role: 'system', content: STOCK_ANALYSIS_PROMPT },
    { role: 'user', content: buildStockAnalysisMessage(input) },
  ]
}

module.exports = { STOCK_ANALYSIS_PROMPT, buildStockAnalysisMessage, buildStockAnalysisMessages }
