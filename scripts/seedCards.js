require('dotenv').config()

const path = require('path')
const mongoose = require('mongoose')

const Card = require('../src/models/Card')
const { collectCardFiles, parseCardFile } = require('../src/utils/tarotParser')

async function seedCards() {
  const mongoUri = process.env.MONGO_URI

  if (!mongoUri) {
    throw new Error('請先在 backend/.env 設定 MONGO_URI。')
  }

  const workspaceRoot = path.resolve(__dirname, '..', '..')
  const cardFiles = collectCardFiles(workspaceRoot)
  const cards = cardFiles.map((filePath) => parseCardFile(filePath, workspaceRoot))

  await mongoose.connect(mongoUri)
  await Card.deleteMany({})
  await Card.insertMany(cards)

  console.log(`Seed completed: ${cards.length} cards imported.`)
}

seedCards()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect()
  })