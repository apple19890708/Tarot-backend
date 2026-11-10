// 持股損益：買賣紀錄（先進先出沖銷）、交易成本、股利。純函式，前後端都只看這裡算出來的數字。
//
// 單位：台股 quantity 是「張」（1 張 = 1000 股，小數代表零股），美股是「股」。
// 台股成本：手續費 = max(最低手續費, floor(成交金額 × 0.1425% × 折扣))，買賣都收；
//           證交稅只在賣出時收：股票 0.3%、ETF（代號 00 開頭）0.1%，無條件捨去到元。
// 美股成本：每筆固定手續費（預設 0），沒有證交稅。
// 未實現損益比照券商的算法：市值扣掉「現在賣出」要付的手續費與稅，再減成本（含買進手續費）。

const TW_FEE_RATE = 0.001425
const TW_TAX_RATE = { stock: 0.003, etf: 0.001 }
const DEFAULT_FEES = Object.freeze({ twDiscount: 1, twMinFee: 20, usFee: 0 })

const unitOf = (target) => (target.market === 'tw' ? 1000 : 1)
const isEtf = (target) => target.market === 'tw' && /^00/.test(target.code || '')
const round2 = (value) => (value === null || value === undefined ? null : Math.round(value * 100) / 100)

function normalizeFees(fees) {
  return {
    twDiscount: Number.isFinite(fees?.twDiscount) ? fees.twDiscount : DEFAULT_FEES.twDiscount,
    twMinFee: Number.isFinite(fees?.twMinFee) ? fees.twMinFee : DEFAULT_FEES.twMinFee,
    usFee: Number.isFinite(fees?.usFee) ? fees.usFee : DEFAULT_FEES.usFee,
  }
}

// 一筆成交的手續費與稅
function tradeCosts(target, side, amount, fees) {
  if (amount <= 0) return { fee: 0, tax: 0 }
  if (target.market === 'tw') {
    const fee = Math.max(fees.twMinFee, Math.floor(amount * TW_FEE_RATE * fees.twDiscount))
    const tax = side === 'sell' ? Math.floor(amount * (isEtf(target) ? TW_TAX_RATE.etf : TW_TAX_RATE.stock)) : 0
    return { fee, tax }
  }
  return { fee: fees.usFee, tax: 0 }
}

// 依序走過買賣紀錄，檢查有沒有賣超過持有數量。回傳 null 代表沒問題，否則回傳錯誤訊息
function validateSequence(trades) {
  let quantity = 0
  for (const [index, trade] of trades.entries()) {
    // 配股之前一定要已經有持股（不然會憑空多出成本 0 的股票，應收股利也會從那天算起）
    if (trade.side === 'stockDividend' && quantity <= 1e-9) return `第 ${index + 1} 筆配股之前沒有持股。`
    quantity += trade.side === 'sell' ? -trade.quantity : trade.quantity
    // 浮點誤差容許一點點（零股小數）
    if (quantity < -1e-9) return `第 ${index + 1} 筆賣出的數量超過當時持有的數量。`
  }
  return null
}

// trades：[{ side（buy／sell／stockDividend）, quantity, price, date }]（依輸入順序沖銷）；dividends：[{ amount, date }]
// quote：{ price, change, date } 或 null（報價取不到時，市值相關欄位為 null）
function computePosition({ target, trades = [], dividends = [], fees: rawFees, quote = null }) {
  const fees = normalizeFees(rawFees)
  const unit = unitOf(target)
  const open = [] // { shares, cost（含買進手續費）, price, date }
  let realized = 0
  let feesPaid = 0
  let taxPaid = 0
  const details = []

  for (const trade of trades) {
    const shares = trade.quantity * unit
    // 配股（v20）：成本 0 的一筆買進，不收手續費與稅；先進先出時跟著順序沖銷，平均成本因此降低
    if (trade.side === 'stockDividend') {
      open.push({ shares, cost: 0, price: 0, date: trade.date || null, stockDividend: true })
      details.push({ fee: 0, tax: 0, realized: null })
      continue
    }
    const amount = trade.price * shares
    const { fee, tax } = tradeCosts(target, trade.side, amount, fees)
    feesPaid += fee
    taxPaid += tax
    if (trade.side === 'buy') {
      open.push({ shares, cost: amount + fee, price: trade.price, date: trade.date || null })
      details.push({ fee, tax, realized: null })
      continue
    }
    // 賣出：先進先出沖銷，按比例扣掉被賣掉那部分的成本
    let remaining = shares
    let consumedCost = 0
    while (remaining > 1e-9 && open.length) {
      const lot = open[0]
      const take = Math.min(lot.shares, remaining)
      const part = lot.cost * (take / lot.shares)
      consumedCost += part
      lot.cost -= part
      lot.shares -= take
      remaining -= take
      if (lot.shares <= 1e-9) open.shift()
    }
    const gain = amount - fee - tax - consumedCost
    realized += gain
    details.push({ fee, tax, realized: round2(gain) })
  }

  const shares = open.reduce((sum, lot) => sum + lot.shares, 0)
  const costBasis = open.reduce((sum, lot) => sum + lot.cost, 0)
  const dividendTotal = dividends.reduce((sum, d) => sum + d.amount, 0)
  const price = quote?.price ?? null

  let marketValue = null
  let sellCost = null
  let unrealized = null
  if (price !== null && shares > 1e-9) {
    marketValue = price * shares
    const costs = tradeCosts(target, 'sell', marketValue, fees)
    sellCost = costs.fee + costs.tax
    unrealized = marketValue - sellCost - costBasis
  } else if (price !== null) {
    marketValue = 0
    sellCost = 0
    unrealized = 0
  }

  // 今日損益：昨天以前買的 = 今日漲跌 × 股數；今天才買的 = (現價 − 買進價) × 股數
  let today = null
  if (price !== null) {
    today = 0
    for (const lot of open) {
      // 配股那筆不是今天用某個價錢買的，照一般持股算今日漲跌
      if (!lot.stockDividend && lot.date && quote?.date && lot.date >= quote.date) today += (price - lot.price) * lot.shares
      else if (quote?.change === null || quote?.change === undefined) {
        today = null
        break
      } else today += quote.change * lot.shares
    }
  }

  const openLots = open
    .filter((lot) => lot.shares > 1e-9)
    .map((lot) => {
      const value = price === null ? null : price * lot.shares
      // 預估賣出成本依市值比例分攤到每一筆
      const share = marketValue ? (value / marketValue) * sellCost : 0
      const pnl = value === null ? null : value - share - lot.cost
      return {
        quantity: round2(lot.shares / unit),
        price: lot.price,
        // 配股來的那筆（成本 0）
        ...(lot.stockDividend ? { stockDividend: true } : {}),
        date: lot.date,
        cost: round2(lot.cost),
        value: round2(value),
        pnl: round2(pnl),
        pnlPct: pnl === null || !lot.cost ? null : round2((pnl / lot.cost) * 100),
      }
    })

  return {
    quantity: Math.round((shares / unit) * 1000) / 1000,
    // 平均成本（每股，含買進手續費）
    avgCost: shares > 1e-9 ? round2(costBasis / shares) : null,
    costBasis: round2(costBasis),
    marketValue: round2(marketValue),
    // 現在全部賣出要付的手續費與稅（預估）
    sellCost: round2(sellCost),
    unrealized: round2(unrealized),
    unrealizedPct: unrealized === null || !costBasis ? null : round2((unrealized / costBasis) * 100),
    realized: round2(realized),
    dividends: round2(dividendTotal),
    // 總報酬 = 未實現 + 已實現 + 股利
    totalReturn: unrealized === null ? null : round2(unrealized + realized + dividendTotal),
    today: round2(today),
    feesPaid: round2(feesPaid),
    taxPaid: round2(taxPaid),
    trades: details,
    openLots,
  }
}

// 舊格式只有 lots（只有買進）：轉成買進紀錄
function tradesOf(watch) {
  if (watch.trades && watch.trades.length) {
    return watch.trades.map((t) => ({ side: t.side, quantity: t.quantity, price: t.price, date: t.date || null }))
  }
  return (watch.lots || []).map((lot) => ({ side: 'buy', quantity: lot.quantity, price: lot.cost, date: lot.date || null }))
}

module.exports = { computePosition, tradesOf, tradeCosts, validateSequence, normalizeFees, DEFAULT_FEES, unitOf, isEtf }
