// 研究用：抓一籃子標的的 5 年日 K（Yahoo Finance chart，和 marketService.fetchHistory 同一個來源），存成 JSON。
// 只抓公開行情，不呼叫任何 AI。用法：node scripts/research/fetchBars.js <輸出目錄>
const fs = require('node:fs')
const path = require('node:path')

// 台股大型股、金融、傳產、ETF、上櫃，加上美股大型股與 ETF：波動大小、產業、市場都有
const SYMBOLS = [
  '2330.TW', '2317.TW', '2454.TW', '2308.TW', '2382.TW', '2303.TW', '3711.TW', '2357.TW', '3034.TW', '2379.TW',
  '3231.TW', '3037.TW', '2345.TW', '6669.TW', '3008.TW', '2881.TW', '2882.TW', '2891.TW', '2886.TW', '5871.TW',
  '1301.TW', '1303.TW', '2002.TW', '6505.TW', '1216.TW', '2912.TW', '2207.TW', '2412.TW', '2603.TW', '2609.TW',
  '0050.TW', '0056.TW', '00878.TW', '006208.TW', '00713.TW',
  '6488.TWO', '5483.TWO', '8069.TWO', '3293.TWO', '5347.TWO',
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'JPM', 'XOM', 'KO', 'AMD', 'SPY', 'QQQ', 'SCHD', 'VYM',
  '^TWII', '^GSPC',
]

async function fetchBars(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d`
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research/1.0)', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`${response.status}`)
  const result = (await response.json())?.chart?.result?.[0]
  const quote = result?.indicators?.quote?.[0] || {}
  return (result?.timestamp || [])
    .map((ts, i) => ({
      date: new Date((ts + (result.meta?.gmtoffset ?? 0)) * 1000).toISOString().slice(0, 10),
      open: quote.open?.[i],
      high: quote.high?.[i],
      low: quote.low?.[i],
      close: quote.close?.[i],
      volume: quote.volume?.[i],
    }))
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
}

async function main() {
  const out = process.argv[2]
  if (!out) throw new Error('要給輸出目錄')
  fs.mkdirSync(out, { recursive: true })
  for (const symbol of SYMBOLS) {
    const file = path.join(out, `${symbol.replace('^', '_')}.json`)
    if (fs.existsSync(file)) continue
    try {
      const bars = await fetchBars(symbol)
      fs.writeFileSync(file, JSON.stringify(bars))
      console.log(symbol, bars.length, bars[0]?.date, bars[bars.length - 1]?.date)
    } catch (error) {
      console.log(symbol, '失敗', error.message)
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

main()
