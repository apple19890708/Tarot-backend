// 量測牌對辭典的句型重複程度（唯讀，不寫資料庫，不呼叫 AI）。
//
// 用法：node scripts/auditPairStyle.js
//
// 「造樣造句」要能量化才知道改了有沒有用。這裡看兩件事：
//   1. 句型骨架：整本辭典實際上只用了幾種句子形狀
//   2. 開頭重複：同一個開頭被幾條目共用（同一張牌配 42 個對象都講同一句）
require('dotenv').config({ quiet: true })

function frameOf(text) {
  if (/^既[^，]*也[^，]*，/.test(text)) return '既…也…，收尾'
  if (/，好在/.test(text)) return 'A，好在B'
  if (/，但/.test(text)) return 'A，但B'
  if (/^[^，。]+，[^，。]+。$/.test(text)) return 'A，B'
  return '其他'
}

async function main() {
  const mongoose = require('mongoose')
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })
  const CardPair = require('../src/models/CardPair')

  const domains = await CardPair.distinct('domain')
  console.log('總筆數', await CardPair.countDocuments())

  for (const domain of domains.sort()) {
    const rows = await CardPair.find({ domain }).select('text').lean()
    const frames = {}
    const heads = {}
    rows.forEach((row) => {
      const frame = frameOf(row.text)
      frames[frame] = (frames[frame] || 0) + 1
      const head = row.text.split(/[，。]/)[0]
      heads[head] = (heads[head] || 0) + 1
    })

    const total = rows.length
    console.log(`\n=== ${domain}（${total} 筆）===`)
    Object.entries(frames)
      .sort((a, b) => b[1] - a[1])
      .forEach(([frame, count]) => console.log(`  ${frame.padEnd(14)} ${String(count).padStart(6)}（${((count / total) * 100).toFixed(1)}%）`))
    console.log('  不重複開頭：', Object.keys(heads).length)
    console.log(
      '  最常見開頭：',
      Object.entries(heads)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([head, count]) => `${head}×${count}`)
        .join('、'),
    )
  }

  await mongoose.disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
