// 篩出辭典裡「預設逆位＝更壞」的條目（唯讀，不寫資料庫）。
//
// 用法：
//   node scripts/auditPolarity.js            五個領域全掃
//   node scripts/auditPolarity.js work --list 列出條目
//
// ── 判準怎麼來的 ──
// 第一版用關鍵詞判斷每段文字的好壞，失敗得很徹底：
// 「這種位子坐不穩」被『穩』判成正面、「這很難得」被『很難』判成負面。
// 而且前提本身就錯 —— 正面牌逆位代表「那份好沒展現出來」，
// 辭典寫成「既沒團隊也沒熱情」是對的，不是缺陷。
//
// 改用一條塔羅上站得住、而且不必判斷語氣的規則：
//
//   一張本質負面的牌（polarity < 0），逆位是「那股負面能量沒有全力展開」，
//   也就是相對的鬆口氣，不會比正位更慘。
//   所以當兩張牌本質都負面時，四格的嚴重程度應該是 [0] 正正最重、[3] 逆逆最輕。
//
// 既有辭典的 [3] 幾乎一律寫成「既…也…，<最壞的收尾>」，
// 也就是預設逆逆最慘。兩張負面牌的組合落入這個句型，就是預設錯了。
require('dotenv').config({ quiet: true })

const path = require('path')
const { getCardVector } = require('../src/data/cardDimensions')
const { getCardProfile } = require('../src/data/cardAttributes')
const { QUESTION_DOMAINS } = require('../src/data/ruleConfig')

// 極性要夠明確才納入判定，灰色地帶的牌不碰
const CLEAR_NEGATIVE = -0.4

function polarityOf(card) {
  const vector = getCardVector(card, getCardProfile(card))
  return vector.polarityKnown ? vector.polarity : null
}

// 「既…也…」是我寫辭典時用來表達「兩邊都不行」的句型，
// 出現在兩張負面牌的逆逆格，就代表把逆位當成了更壞
const WORST_PATTERN = /^既.+也.+/

function auditDomain(domain, cardsByName, showList) {
  const { COMBOS } = require(path.join(__dirname, 'pairs', `${domain}.js`))
  const findings = []
  let bothNegative = 0

  for (const [fromName, toName, texts] of COMBOS) {
    const from = cardsByName.get(fromName)
    const to = cardsByName.get(toName)
    if (!from || !to) continue

    const fromPolarity = polarityOf(from)
    const toPolarity = polarityOf(to)
    if (fromPolarity === null || toPolarity === null) continue
    if (fromPolarity > CLEAR_NEGATIVE || toPolarity > CLEAR_NEGATIVE) continue

    bothNegative += 1

    // 兩張都是本質負面的牌，逆逆應該是四格裡最輕的一格
    if (WORST_PATTERN.test(texts[3])) {
      findings.push({
        pair: `${fromName}（${fromPolarity}）→ ${toName}（${toPolarity}）`,
        upright: texts[0],
        reversed: texts[3],
      })
    }
  }

  const label = QUESTION_DOMAINS[domain].label
  console.log(
    `${label.padEnd(6)} 兩張都負面的組合 ${String(bothNegative).padStart(4)}　其中逆逆被寫成最慘 ${String(findings.length).padStart(4)}`,
  )

  if (showList) {
    findings.slice(0, 25).forEach((f) => {
      console.log(`   ${f.pair}`)
      console.log(`      正正：${f.upright}`)
      console.log(`      逆逆：${f.reversed}`)
    })
    if (findings.length > 25) console.log(`   …另有 ${findings.length - 25} 筆`)
  }

  return findings.length
}

async function main() {
  const args = process.argv.slice(2)
  const showList = args.includes('--list')
  const only = args.find((arg) => !arg.startsWith('--')) || null
  const domains = only ? [only] : Object.keys(QUESTION_DOMAINS)

  const mongoose = require('mongoose')
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })
  const Card = require('../src/models/Card')
  const cards = await Card.find({}).lean()
  const cardsByName = new Map(cards.map((card) => [card.nameZh, card]))

  console.log('判準：兩張牌本質都負面時，逆逆（負面能量沒全力展開）不該是四格裡最慘的一格。\n')

  let total = 0
  for (const domain of domains) {
    total += auditDomain(domain, cardsByName, showList)
  }
  console.log(`\n合計 ${total} 筆需要改寫。`)

  await mongoose.disconnect()
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
