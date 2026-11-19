// 統計 AI 解讀的檢查結果與使用者回饋（v25 階段 2、4），依提示詞版本分組。唯讀，不改任何資料。
//   node scripts/narrationQualityStats.js
// 只做彙總（各版本的篇數、各檢查代碼出現幾次、有幫助／沒幫助與原因），不讀出解讀內容與問題。
require('dotenv').config({ quiet: true })

const mongoose = require('mongoose')
const Reading = require('../src/models/Reading')

async function stats(field) {
  return Reading.aggregate([
    { $match: { [`${field}.text`]: { $exists: true } } },
    {
      $project: {
        version: { $ifNull: [`$${field}.promptVersion`, 1] },
        checks: { $ifNull: [`$${field}.checks`, []] },
        feedback: `$${field}.feedback.value`,
        reason: `$${field}.feedback.reason`,
      },
    },
    {
      $facet: {
        total: [{ $group: { _id: '$version', count: { $sum: 1 } } }],
        checks: [{ $unwind: '$checks' }, { $group: { _id: { version: '$version', code: '$checks' }, count: { $sum: 1 } } }],
        feedback: [
          { $match: { feedback: { $ne: null } } },
          { $group: { _id: { version: '$version', value: '$feedback', reason: '$reason' }, count: { $sum: 1 } } },
        ],
      },
    },
  ])
}

function print(title, [result]) {
  console.log(`\n== ${title} ==`)
  for (const { _id: version, count } of result.total.sort((a, b) => a._id - b._id)) {
    console.log(`提示詞版本 ${version}：${count} 篇${version === 1 ? '（v25 之前，沒有檢查資料）' : ''}`)
    const checks = result.checks.filter((item) => item._id.version === version).sort((a, b) => b.count - a.count)
    for (const item of checks) console.log(`  ${item._id.code}：${item.count}（${Math.round((item.count / count) * 100)}%）`)
    const feedback = result.feedback.filter((item) => item._id.version === version)
    for (const item of feedback) console.log(`  回饋 ${item._id.value === 'up' ? '有幫助' : '沒幫助'}${item._id.reason ? `／${item._id.reason}` : ''}：${item.count}`)
  }
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })
  try {
    print('AI 解讀', await stats('narration'))
    print('追問的延伸回答', await stats('followUpNarration'))
  } finally {
    await mongoose.disconnect()
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
