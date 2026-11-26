// AI 費用報表（v29 項目 6）：讀 MarketAiUsage 最近 N 天的用量，依種類列出次數、token、快取命中與費用。
// 只讀資料庫、不呼叫 AI、不印使用者或問題內容。
//
//   node scripts/aiUsageReport.js        最近 7 天
//   node scripts/aiUsageReport.js 14     最近 14 天（用量紀錄保留 14 天）
//
// 用來判斷提示快取（cache_control）值不值得留：看「快取命中」佔輸入 token 的比例，
// 以及有快取時每次的費用是否明顯比較低。
require('dotenv').config()
const mongoose = require('mongoose')
const MarketAiUsage = require('../src/models/MarketAiUsage')

async function main() {
  const days = Math.max(1, Math.min(14, Number.parseInt(process.argv[2] || '7', 10) || 7))
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI 沒有設定')
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })
  const since = new Date(Date.now() - days * 86400000)
  const rows = await MarketAiUsage.aggregate([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: '$kind',
        count: { $sum: 1 },
        reported: { $sum: { $cond: [{ $ne: ['$cost', null] }, 1, 0] } },
        promptTokens: { $sum: { $ifNull: ['$promptTokens', 0] } },
        cachedTokens: { $sum: { $ifNull: ['$cachedTokens', 0] } },
        completionTokens: { $sum: { $ifNull: ['$completionTokens', 0] } },
        reasoningTokens: { $sum: { $ifNull: ['$reasoningTokens', 0] } },
        cost: { $sum: { $ifNull: ['$cost', 0] } },
      },
    },
    { $sort: { cost: -1 } },
  ])
  console.log(`最近 ${days} 天的 AI 用量（只算有回報費用的；中途停止的沒有費用資料）`)
  for (const row of rows) {
    const avg = row.reported ? row.cost / row.reported : 0
    const cacheRate = row.promptTokens ? (row.cachedTokens / row.promptTokens) * 100 : 0
    console.log(
      `${row._id.padEnd(10)} 次數 ${row.count}（有費用 ${row.reported}）｜輸入 ${row.promptTokens}（快取 ${cacheRate.toFixed(0)}%）｜輸出 ${row.completionTokens}（推理 ${row.reasoningTokens}）｜共 US$${row.cost.toFixed(4)}，平均 US$${avg.toFixed(4)}／次`,
    )
  }
  if (!rows.length) console.log('沒有資料')
}

main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(() => mongoose.disconnect())
