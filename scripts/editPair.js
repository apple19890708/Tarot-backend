// 修改或標記單筆牌對解讀。
// 用法：
//   node scripts/editPair.js --key="major-0-the-fool|upright>major-16-the-tower|upright" --domain=work --text="新的說法"
//   node scripts/editPair.js --key=... --domain=work --reviewed
//   node scripts/editPair.js --list-unreviewed --domain=work [--limit=20]
require('dotenv').config({ quiet: true })

const mongoose = require('mongoose')
const CardPair = require('../src/models/CardPair')

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [k, ...rest] = arg.replace(/^--/, '').split('=')
    return [k, rest.length ? rest.join('=') : true]
  }),
)

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })

  if (args['list-unreviewed']) {
    const filter = { reviewed: false, source: 'ai' }
    if (args.domain) {
      filter.domain = args.domain
    }
    const rows = await CardPair.find(filter).limit(Number(args.limit) || 20).lean()
    const total = await CardPair.countDocuments(filter)
    console.log(`未校訂共 ${total} 筆，列出前 ${rows.length} 筆：\n`)
    rows.forEach((row) => console.log(`${row.key}\n  [${row.domain}] ${row.text}\n`))
    await mongoose.disconnect()
    return
  }

  if (!args.key || !args.domain) {
    throw new Error('需要 --key 與 --domain')
  }

  const update = {}
  if (typeof args.text === 'string') {
    update.text = args.text
    // 人工改過的內容視為已校訂
    update.reviewed = true
  }
  if (args.reviewed) {
    update.reviewed = true
  }
  if (Object.keys(update).length === 0) {
    throw new Error('需要 --text 或 --reviewed')
  }

  const result = await CardPair.updateOne({ key: args.key, domain: args.domain }, { $set: update })
  console.log(result.matchedCount === 0 ? '找不到這筆（確認 key 與 domain）' : '已更新')

  await mongoose.disconnect()
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
