// 把人工撰寫的牌對解讀寫入辭典（完全不呼叫 AI）。
//
// 用法：
//   node scripts/pairs/seed.js money      只寫入財務
//   node scripts/pairs/seed.js            寫入所有已撰寫的領域
//   node scripts/pairs/seed.js --progress 只顯示進度，不寫入
//
// 內容放在同目錄的 <domain>.js，格式為 [來源牌, 目標牌, [正正, 正逆, 逆正, 逆逆]]。
// 可以分批增補：已寫入的會被更新，沒寫到的不受影響。
require('dotenv').config({ quiet: true })

const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')

const Card = require('../../src/models/Card')
const CardPair = require('../../src/models/CardPair')
const { analyzeCombination } = require('../../src/services/combinationRules')
const { QUESTION_DOMAINS } = require('../../src/data/ruleConfig')

const ORIENTATIONS = [
  ['upright', 'upright'],
  ['upright', 'reversed'],
  ['reversed', 'upright'],
  ['reversed', 'reversed'],
]

// 撰寫階段。每階段算出該範圍內「一個領域應有幾筆」，用來顯示進度。
// 一組牌對會產生 4 筆（正正／正逆／逆正／逆逆）。
const STAGES = [
  { key: 'major', label: '大牌×大牌', combos: 22 * 21 },
  { key: 'swords', label: '寶劍階段', combos: 14 * 22 * 2 + 14 * 13 },
  { key: 'cups', label: '聖杯階段', combos: 14 * 22 * 2 + 14 * 13 },
  { key: 'wands', label: '權杖階段', combos: 14 * 22 * 2 + 14 * 13 },
  { key: 'pentacles', label: '錢幣階段', combos: 14 * 22 * 2 + 14 * 13 },
  // 跨花色小牌：四個花色階段都沒收到的那一塊（每張小牌 × 其他三個花色的 42 張）
  { key: 'cross', label: '跨花色階段', combos: 56 * 42 },
]

// 某個階段涵蓋哪些牌對：大牌階段是大牌兩兩配，其餘是「該花色 ×（大牌＋同花色）」雙向。
const SUIT_KEYS = ['wands', 'cups', 'swords', 'pentacles']

function stageFilter(stage, slugsOf) {
  const major = slugsOf('major')
  if (stage.key === 'major') {
    return { fromSlug: { $in: major }, toSlug: { $in: major } }
  }
  // 跨花色：兩端都是小牌，再用 $nor 把四組同花色的排掉
  if (stage.key === 'cross') {
    const minors = SUIT_KEYS.flatMap(slugsOf)
    return {
      fromSlug: { $in: minors },
      toSlug: { $in: minors },
      $nor: SUIT_KEYS.map((key) => ({
        fromSlug: { $in: slugsOf(key) },
        toSlug: { $in: slugsOf(key) },
      })),
    }
  }
  const suit = slugsOf(stage.key)
  const both = [...suit, ...major]
  return {
    $or: [
      { fromSlug: { $in: suit }, toSlug: { $in: both } },
      { fromSlug: { $in: both }, toSlug: { $in: suit } },
    ],
  }
}

function loadDomainFiles(only) {
  return fs
    .readdirSync(__dirname)
    .filter((file) => file.endsWith('.js') && file !== 'seed.js')
    .map((file) => file.replace(/\.js$/, ''))
    .filter((domain) => (only ? domain === only : true))
    .filter((domain) => {
      if (!QUESTION_DOMAINS[domain]) {
        console.warn(`略過 ${domain}.js：不是有效的領域`)
        return false
      }
      return true
    })
}

async function main() {
  const args = process.argv.slice(2)
  const progressOnly = args.includes('--progress')
  const only = args.find((arg) => !arg.startsWith('--')) || null

  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })

  const cards = await Card.find({}).lean()
  const byName = new Map(cards.map((card) => [card.nameZh, card]))
  const slugsOf = (group) =>
    cards.filter((c) => (group === 'major' ? c.arcanaType === 'major' : c.suit === group)).map((c) => c.slug)

  if (progressOnly) {
    for (const stage of STAGES) {
      const target = stage.combos * 4
      console.log(`${stage.label}（每領域 ${stage.combos} 組 / ${target} 筆）：`)
      for (const domain of Object.keys(QUESTION_DOMAINS)) {
        const n = await CardPair.countDocuments({ domain, ...stageFilter(stage, slugsOf) })
        const pct = ((n / target) * 100).toFixed(1)
        const bar = '█'.repeat(Math.round((n / target) * 20)).padEnd(20, '░')
        console.log(`  ${QUESTION_DOMAINS[domain].label.padEnd(6)} ${bar} ${n} / ${target}（${pct}%）`)
      }
      console.log('')
    }
    await mongoose.disconnect()
    return
  }

  const domains = loadDomainFiles(only)
  if (domains.length === 0) {
    console.log('沒有找到要寫入的領域檔案。')
    await mongoose.disconnect()
    return
  }

  for (const domain of domains) {
    const { COMBOS } = require(path.join(__dirname, `${domain}.js`))
    const ops = []
    const problems = []
    const seen = new Set()

    for (const [fromName, toName, texts] of COMBOS) {
      const fromCard = byName.get(fromName)
      const toCard = byName.get(toName)
      if (!fromCard || !toCard) {
        problems.push(`找不到牌：${fromName} 或 ${toName}`)
        continue
      }
      if (fromName === toName) {
        problems.push(`${fromName} 不能與自己配對`)
        continue
      }
      if (!Array.isArray(texts) || texts.length !== 4 || texts.some((t) => !t || !t.trim())) {
        problems.push(`${fromName}→${toName} 需要 4 段非空文字`)
        continue
      }
      const comboKey = `${fromName}>${toName}`
      if (seen.has(comboKey)) {
        problems.push(`${comboKey} 重複定義`)
        continue
      }
      seen.add(comboKey)

      ORIENTATIONS.forEach(([fromOrientation, toOrientation], i) => {
        const key = `${fromCard.slug}|${fromOrientation}>${toCard.slug}|${toOrientation}`
        const relation = analyzeCombination({
          entries: [
            { card: fromCard, orientation: fromOrientation },
            { card: toCard, orientation: toOrientation },
          ],
        }).pairs[0].relation

        ops.push({
          updateOne: {
            filter: { key, domain },
            update: {
              $set: {
                key,
                fromSlug: fromCard.slug,
                fromOrientation,
                toSlug: toCard.slug,
                toOrientation,
                domain,
                text: texts[i].trim(),
                relation,
                source: 'curated',
                model: '',
                reviewed: true,
              },
            },
            upsert: true,
          },
        })
      })
    }

    if (problems.length > 0) {
      problems.forEach((p) => console.error(`  ✗ ${p}`))
      throw new Error(`${domain} 資料有問題，整個領域都未寫入`)
    }

    const result = ops.length > 0 ? await CardPair.bulkWrite(ops) : { upsertedCount: 0, modifiedCount: 0 }
    const label = QUESTION_DOMAINS[domain].label

    console.log(
      `${label}：本次 ${ops.length} 筆（新增 ${result.upsertedCount}、更新 ${result.modifiedCount}）`,
    )

    // 按階段列出累計進度，並提示這個階段還差哪些來源牌
    for (const stage of STAGES) {
      const target = stage.combos * 4
      const n = await CardPair.countDocuments({ domain, ...stageFilter(stage, slugsOf) })
      if (n === 0) {
        continue
      }
      console.log(`　${stage.label}：${n} / ${target}（${((n / target) * 100).toFixed(1)}%）`)

      const scope = cards.filter((c) => (stage.key === 'major' ? c.arcanaType === 'major' : c.suit === stage.key))
      const done = new Set(COMBOS.map(([from]) => from))
      const remaining = scope
        .sort((a, b) => a.number - b.number)
        .map((c) => c.nameZh)
        .filter((name) => !done.has(name))
      if (remaining.length > 0 && n < target) {
        console.log(`　　尚未撰寫的來源牌（${remaining.length} 張）：${remaining.join('、')}`)
      }
    }
  }

  await mongoose.disconnect()
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
