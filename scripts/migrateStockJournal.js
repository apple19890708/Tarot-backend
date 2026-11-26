// 股票日記舊格式轉換（v26 D9；v29 項目 12 從啟動流程移到這裡，手動執行）。
// 2026-11-20 以前的股票日記寫在單一分析底下（targetId＝分析的 24 碼 id），改成一檔一本後要轉成股票鍵（tw:0050）。
// 原本每次啟動都全表掃描一次；2026-11-26 使用者決定從啟動流程移除，但沒有確認線上是否都轉完，所以留成腳本。
// 之後如果有人回報「舊的股票日記不見了」（月曆上看得到、點進股票日記頁卻沒有那篇），執行這支即可。
//
// 用法（在 Tbackend 根目錄，讀 MONGO_URI）：
//   node scripts/migrateStockJournal.js          只列出會轉幾篇、幾篇找不到分析，不寫入
//   node scripts/migrateStockJournal.js --write  真的寫入
// 可以重複執行：轉過的 targetId 不再是 24 碼 hex；條件帶上舊值，同時有別的程式在轉也不會重複改。
const { stockKeyOf } = require('../src/services/stockJournal')

// dryRun：只算數量不寫入。找不到分析（分析被刪、或不是本人的）的保留原樣
async function migrateStockJournalTargets({ JournalEntry, MarketAnalysis, dryRun = false, log = console }) {
  const old = await JournalEntry.find({ targetKind: 'stock', targetId: /^[a-f0-9]{24}$/i }).select('_id user targetId').lean()
  let converted = 0
  let orphaned = 0
  for (const entry of old) {
    const analysis = await MarketAnalysis.findOne({ _id: entry.targetId, user: entry.user }).select('target').lean()
    const key = analysis ? stockKeyOf(analysis.target) : null
    if (!key) {
      orphaned += 1
      continue
    }
    if (!dryRun) await JournalEntry.updateOne({ _id: entry._id, targetId: entry.targetId }, { $set: { targetId: key } })
    converted += 1
  }
  const verb = dryRun ? '會轉' : '已轉'
  log.log(`[股票日記] 舊格式轉換${dryRun ? '（試算，沒有寫入）' : ''}：${verb} ${converted} 篇成一檔一本，${orphaned} 篇找不到分析、保留原樣`)
  return { converted, orphaned }
}

async function main() {
  require('dotenv').config()
  const mongoose = require('mongoose')
  const mongoUri = process.env.MONGO_URI
  if (!mongoUri) {
    console.error('MONGO_URI 未設定。')
    process.exitCode = 1
    return
  }
  const dryRun = !process.argv.includes('--write')
  await mongoose.connect(mongoUri, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })
  try {
    await migrateStockJournalTargets({
      JournalEntry: require('../src/models/JournalEntry'),
      MarketAnalysis: require('../src/models/MarketAnalysis'),
      dryRun,
    })
    if (dryRun) console.log('加上 --write 才會真的寫入。')
  } finally {
    await mongoose.disconnect()
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { migrateStockJournalTargets }
