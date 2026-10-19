// 下載公共領域 RWS 1909 牌卡圖到 public/cards/，並把路徑回填到資料庫 Card.image。
// 用法：node scripts/fetchCardImages.js
// 圖片來源為 Wikimedia Commons 的 Special:FilePath（會轉址到實際檔案），皆為公共領域。
require('dotenv').config({ quiet: true })

const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')

const Card = require('../src/models/Card')
const { resolveImageSource } = require('./cardImageSources')

const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'cards')
const WIKI_BASE = 'https://commons.wikimedia.org/wiki/Special:FilePath/'
// 限制寬度，避免下載原始超大圖；Wikimedia 支援 ?width=
const IMAGE_WIDTH = 500

async function downloadImage(wikiFile, destPath) {
  const url = `${WIKI_BASE}${encodeURIComponent(wikiFile)}?width=${IMAGE_WIDTH}`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'TarotDivination/1.0 (public-domain card images)' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  fs.writeFileSync(destPath, buffer)
  return buffer.length
}

async function main() {
  if (!process.env.MONGO_URI) {
    console.error('缺少 MONGO_URI，請先設定 .env')
    process.exit(1)
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })

  const cards = await Card.find().lean()
  console.log(`資料庫共 ${cards.length} 張牌`)

  let ok = 0
  const skipped = []

  for (const card of cards) {
    const source = resolveImageSource(card)
    if (!source) {
      skipped.push(`${card.nameZh}（${card.nameEn} / ${card.arcanaType} / ${card.suit} / ${card.number}）：無對應`)
      continue
    }

    const destPath = path.join(OUTPUT_DIR, source.localFile)
    const relativePath = `/cards/${source.localFile}`

    try {
      if (!fs.existsSync(destPath)) {
        const size = await downloadImage(source.wikiFile, destPath)
        console.log(`✓ ${card.nameZh} → ${source.localFile}（${Math.round(size / 1024)} KB）`)
      } else {
        console.log(`• ${card.nameZh} → ${source.localFile}（已存在，略過下載）`)
      }
      await Card.updateOne({ _id: card._id }, { $set: { image: relativePath } })
      ok += 1
    } catch (error) {
      skipped.push(`${card.nameZh}（${source.wikiFile}）：下載失敗 ${error.message}`)
    }
  }

  console.log(`\n完成：${ok} 張已回填 image，${skipped.length} 張未處理`)
  if (skipped.length > 0) {
    console.log('未處理清單：')
    skipped.forEach((line) => console.log(`  - ${line}`))
  }

  await mongoose.disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
