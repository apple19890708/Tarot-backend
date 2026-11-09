// 價位提醒的檢查：網頁開著時（/api/market/alerts/check）與外部排程（/api/cron/market）共用。
// 純邏輯＋注入的報價函式，方便測試。
//
// 提醒種類（kind）：
// - price：漲到／跌到某價（condition above／below、price）
// - changePct：單日漲幅或跌幅達到 X%（params.direction up／down、params.value）
// - ma：站上／跌破 MA20 或 MA60（params.direction above／below、params.period 20／60）。要記上一次在哪一側（lastSide），穿越才觸發
// - kd：KD 黃金交叉／死亡交叉（params.direction golden／dead），當天發生交叉才觸發
// - rsi：RSI(14) ≥ X 或 ≤ X（params.direction above／below、params.value）
// - volume：量比（當日量 ÷ 20 日均量）≥ X 倍（params.value）

const { dateTimeFormat } = require('../../lib/intlFormat')

const keyOf = (target) => target.symbol || `${target.exchange}_${target.code}`

const ALERT_KINDS = ['price', 'changePct', 'ma', 'kd', 'rsi', 'volume']
// 看「當天」的條件：只在開盤時判斷，否則週末會拿前一個交易日的漲跌、交叉、量比觸發
const SESSION_KINDS = ['changePct', 'kd', 'volume']
// 看「狀態」的條件：同一個交易日最多觸發一次（重新啟用後不會馬上又觸發）
const ONCE_PER_DAY_KINDS = ['changePct', 'kd', 'volume', 'rsi']
const MA_LABELS = { 20: '月線（MA20）', 60: '季線（MA60）' }

// 交易時段（含收盤後幾分鐘的緩衝，讓收盤價也檢查得到）。週末不開盤；國定假日不另外處理，
// 假日查到的是前一天收盤價，不會誤觸發新的提醒（價格沒變）
const SESSIONS = {
  tw: { timeZone: 'Asia/Taipei', open: 9 * 60, close: 13 * 60 + 40 },
  us: { timeZone: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 + 10 },
}

function localClock(timeZone, date) {
  const parts = Object.fromEntries(
    dateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  )
  return { weekday: parts.weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
}

function isMarketOpen(market, date = new Date()) {
  const session = SESSIONS[market]
  if (!session) return false
  const { weekday, minutes } = localClock(session.timeZone, date)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  return minutes >= session.open && minutes <= session.close
}

function formatPrice(value) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })
}

const kindOf = (alert) => alert.kind || 'price'

// 條件的文字（建立後顯示用）
function describeAlert(alert) {
  const p = alert.params || {}
  switch (kindOf(alert)) {
    case 'changePct':
      return `單日${p.direction === 'down' ? '跌' : '漲'}幅達 ${formatPrice(p.value)}%`
    case 'ma':
      return `${p.direction === 'below' ? '跌破' : '站上'}${MA_LABELS[p.period] || `MA${p.period}`}`
    case 'kd':
      return p.direction === 'dead' ? 'KD 死亡交叉' : 'KD 黃金交叉'
    case 'rsi':
      return `RSI(14) ${p.direction === 'below' ? '低於' : '高於'} ${formatPrice(p.value)}`
    case 'volume':
      return `量比達 ${formatPrice(p.value)} 倍（相對 20 日均量）`
    default:
      return `${alert.condition === 'above' ? '漲到' : '跌到'} ${formatPrice(alert.price)}`
  }
}

// 價格以外的條件需要的指標。signals：{ price, changePct, ma20, ma60, k, d, prevK, prevD, rsi, volumeRatio }
// 回傳 { hit, note（觸發時的補充說明）, side（ma 的目前側，用來更新 lastSide） }
function checkCondition(alert, signals) {
  const p = alert.params || {}
  const s = signals
  switch (kindOf(alert)) {
    case 'changePct': {
      if (s.changePct === null || s.changePct === undefined) return { hit: false }
      const hit = p.direction === 'down' ? s.changePct <= -p.value : s.changePct >= p.value
      return { hit, note: `今日 ${s.changePct > 0 ? '+' : ''}${formatPrice(s.changePct)}%` }
    }
    case 'ma': {
      const ma = s[`ma${p.period}`]
      if (ma === null || ma === undefined || s.price === null || s.price === undefined) return { hit: false }
      const side = s.price >= ma ? 'above' : 'below'
      // 第一次檢查（還不知道上一次在哪一側）只記錄，不觸發
      const hit = Boolean(alert.lastSide) && alert.lastSide !== side && side === p.direction
      return { hit, side, note: `MA${p.period} ${formatPrice(ma)}` }
    }
    case 'kd': {
      if ([s.k, s.d, s.prevK, s.prevD].some((v) => v === null || v === undefined)) return { hit: false }
      const golden = s.prevK <= s.prevD && s.k > s.d
      const dead = s.prevK >= s.prevD && s.k < s.d
      return { hit: p.direction === 'dead' ? dead : golden, note: `K ${formatPrice(s.k)}、D ${formatPrice(s.d)}` }
    }
    case 'rsi': {
      if (s.rsi === null || s.rsi === undefined) return { hit: false }
      return { hit: p.direction === 'below' ? s.rsi <= p.value : s.rsi >= p.value, note: `RSI ${formatPrice(s.rsi)}` }
    }
    case 'volume': {
      if (s.volumeRatio === null || s.volumeRatio === undefined) return { hit: false }
      return { hit: s.volumeRatio >= p.value, note: `量比 ${formatPrice(s.volumeRatio)} 倍` }
    }
    default:
      return { hit: false }
  }
}

// alerts：Mongoose 文件。
// getQuote(target) → { price } | null（價格提醒用，台股優先用即時報價）
// getSignals(target) → 指標（其他種類用，含 date＝行情日期）；沒傳就只檢查價格提醒
// Model：MarketAlert。有傳時觸發用條件式更新（active 還是 true 才寫），網頁與排程同時檢查也只會有一邊觸發；
//        沒傳（測試）就直接改文件再 save
// 回傳 { triggered: [alert], quotes: Map<key, quote> }
async function evaluateAlerts(
  alerts,
  getQuote,
  { now = () => new Date(), getSignals = null, Model = null, isOpen = (market) => isMarketOpen(market, now()) } = {},
) {
  const quotes = new Map()
  const signalsMap = new Map()
  const priceTargets = new Map(alerts.filter((a) => kindOf(a) === 'price').map((a) => [keyOf(a.target), a.target]))
  const signalTargets = getSignals ? new Map(alerts.filter((a) => kindOf(a) !== 'price').map((a) => [keyOf(a.target), a.target])) : new Map()

  await Promise.all([
    ...[...priceTargets.entries()].map(async ([key, target]) => {
      try {
        const quote = await getQuote(target)
        if (quote) quotes.set(key, quote)
      } catch (error) {
        console.error(`提醒報價失敗（${key}）：`, error.message)
      }
    }),
    ...[...signalTargets.entries()].map(async ([key, target]) => {
      try {
        const signals = await getSignals(target)
        if (signals) {
          signalsMap.set(key, signals)
          if (signals.price !== null && signals.price !== undefined && !quotes.has(key)) quotes.set(key, { price: signals.price })
        }
      } catch (error) {
        console.error(`提醒指標失敗（${key}）：`, error.message)
      }
    }),
  ])

  // 觸發：條件式更新，搶不到（已經被另一邊觸發或被刪掉）就跳過
  async function fire(alert, fields) {
    if (Model) {
      const updated = await Model.findOneAndUpdate({ _id: alert._id, active: true }, { $set: { ...fields, active: false } }, { new: true })
      return updated || null
    }
    Object.assign(alert, fields, { active: false })
    await alert.save()
    return alert
  }

  const triggered = []
  for (const alert of alerts) {
    // 一筆出錯（例如檢查途中被刪掉）不影響其他提醒
    try {
      const key = keyOf(alert.target)
      const kind = kindOf(alert)
      if (kind === 'price') {
        const quote = quotes.get(key)
        if (!quote) continue
        const hit = alert.condition === 'above' ? quote.price >= alert.price : quote.price <= alert.price
        if (hit) {
          const fired = await fire(alert, { triggeredAt: now(), triggeredPrice: quote.price, triggeredNote: '' })
          if (fired) triggered.push(fired)
        }
        continue
      }
      const signals = signalsMap.get(key)
      if (!signals) continue
      if (SESSION_KINDS.includes(kind) && !isOpen(alert.target.market)) continue
      if (ONCE_PER_DAY_KINDS.includes(kind) && signals.date && alert.lastTriggeredOn === signals.date) continue
      const result = checkCondition(alert, signals)
      if (result.hit) {
        const fired = await fire(alert, {
          triggeredAt: now(),
          triggeredPrice: signals.price ?? null,
          triggeredNote: result.note || '',
          lastTriggeredOn: signals.date ?? null,
          ...(result.side ? { lastSide: result.side } : {}),
        })
        if (fired) triggered.push(fired)
      } else if (result.side && result.side !== alert.lastSide) {
        // 均線提醒：記下目前在哪一側
        if (Model) await Model.updateOne({ _id: alert._id }, { $set: { lastSide: result.side } })
        else {
          alert.lastSide = result.side
          await alert.save()
        }
      }
    } catch (error) {
      console.error('提醒檢查失敗：', error.message)
    }
  }
  return { triggered, quotes }
}

// 推播的文字（後端產生，前端不組句子）
function alertMessage(alert) {
  const lines = [`🔔 ${alert.target.name} ${describeAlert(alert)}`]
  const detail = [alert.triggeredPrice !== null && alert.triggeredPrice !== undefined ? `目前 ${formatPrice(alert.triggeredPrice)}` : '', alert.triggeredNote]
    .filter(Boolean)
    .join('，')
  if (detail) lines.push(detail)
  if (alert.note) lines.push(`備註：${alert.note}`)
  return lines.join('\n')
}

// 瀏覽器推播的內容：標題、內文、點了要開的頁面（相對於網站根目錄，由 service worker 補上前綴）
function alertPushPayload(alert) {
  const body = []
  if (alert.triggeredPrice !== null && alert.triggeredPrice !== undefined) body.push(`目前 ${formatPrice(alert.triggeredPrice)}`)
  if (alert.triggeredNote) body.push(alert.triggeredNote)
  if (alert.note) body.push(alert.note)
  return {
    title: `${alert.target.name} ${describeAlert(alert)}`,
    body: body.join('｜'),
    url: 'market?tab=alerts',
  }
}

module.exports = {
  ALERT_KINDS,
  evaluateAlerts,
  checkCondition,
  describeAlert,
  isMarketOpen,
  alertMessage,
  alertPushPayload,
  keyOf,
}
