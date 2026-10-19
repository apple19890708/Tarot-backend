// 把牌對組合辭典匯出成 doc/牌與牌關係.md，方便查閱與挑出要修改的項目。
// 用法：node scripts/exportPairs.js
// 文件由資料庫匯出，不是手寫，所以永遠與實際使用的內容一致。
require('dotenv').config({ quiet: true })

const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')

const Card = require('../src/models/Card')
const CardPair = require('../src/models/CardPair')
const { CURATED_PAIRS } = require('../src/data/curatedPairs')
const { QUESTION_DOMAINS } = require('../src/data/ruleConfig')

const GROUP_ORDER = [
  ['major', '大阿爾克那'],
  ['wands', '權杖'],
  ['cups', '聖杯'],
  ['swords', '寶劍'],
  ['pentacles', '錢幣'],
]
const ORIENTATION_LABEL = { upright: '正', reversed: '逆' }
const RELATION_LABEL = { enhance: '增強', weaken: '削弱', cause: '因果', neutral: '中性' }

function groupOf(card) {
  return card.arcanaType === 'major' ? 'major' : card.suit
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })

  const cards = await Card.find({}, 'slug nameZh arcanaType suit number').lean()
  const bySlug = new Map(cards.map((card) => [card.slug, card]))
  const name = (slug) => bySlug.get(slug)?.nameZh || slug

  const domainRows = await CardPair.find().lean()

  // 統計
  const byDomain = {}
  domainRows.forEach((row) => {
    byDomain[row.domain] = (byDomain[row.domain] || 0) + 1
  })

  const lines = []
  lines.push('# 牌與牌關係')
  lines.push('')
  lines.push(`- 匯出時間：${new Date().toISOString().slice(0, 10)}`)
  lines.push('- 產生方式：`npm run pairs:export`（由資料庫匯出，**請勿手動編輯本檔**）')
  lines.push('- 設計說明：`doc/v05-tarot-pair-dictionary-plan.md`')
  lines.push('')
  lines.push('## 這份文件是什麼')
  lines.push('')
  lines.push('占卜結果中「牌跟牌之間的關係」所使用的文字來源。查詢優先序：')
  lines.push('')
  lines.push('1. 人工精選（本檔第一節）')
  lines.push('2. 領域辭典（本檔第二節，依領域分開，由 `scripts/pairs/<領域>.js` 人工撰寫）')
  lines.push('3. 規則運算（元素與數字，不在本檔，查不到時自動使用）')
  lines.push('')
  lines.push('## 要修改內容的話')
  lines.push('')
  lines.push('| 想改什麼 | 怎麼改 |')
  lines.push('|---|---|')
  lines.push('| 人工精選的文字 | 改 `scripts/buildCuratedPairs.js` 的 `COMBOS`，再執行該腳本 |')
  lines.push('| 單筆領域辭典的文字 | `node scripts/editPair.js --key=... --domain=... --text="..."` |')
  lines.push('| 整批領域辭典 | 改 `scripts/pairs/<領域>.js`，再跑 `node scripts/pairs/seed.js <領域>` |')
  lines.push('')
  lines.push('同一組合若兩節都有，領域辭典優先於不分領域的人工精選。')
  lines.push('')
  lines.push('## 目前涵蓋範圍')
  lines.push('')
  lines.push('| 來源 | 筆數 |')
  lines.push('|---|---|')
  lines.push(`| 人工精選（不分領域） | ${CURATED_PAIRS.length} |`)
  Object.keys(byDomain)
    .sort()
    .forEach((domain) => {
      lines.push(`| 領域辭典：${QUESTION_DOMAINS[domain]?.label || domain} | ${byDomain[domain]} |`)
    })
  lines.push('')
  lines.push('---')
  lines.push('')

  // 第一節：人工精選
  lines.push('## 一、人工精選')
  lines.push('')
  lines.push('不分領域通用，沒有對應領域辭典時使用。')
  lines.push('')

  const curatedByCombo = new Map()
  CURATED_PAIRS.forEach((entry) => {
    const comboKey = `${entry.fromName}＋${entry.toName}`
    if (!curatedByCombo.has(comboKey)) {
      curatedByCombo.set(comboKey, [])
    }
    curatedByCombo.get(comboKey).push(entry)
  })

  for (const [combo, entries] of curatedByCombo) {
    lines.push(`### ${combo}`)
    lines.push('')
    lines.push('| 正逆位 | 解讀 |')
    lines.push('|---|---|')
    entries.forEach((entry) => {
      const o = `${ORIENTATION_LABEL[entry.fromOrientation]}／${ORIENTATION_LABEL[entry.toOrientation]}`
      lines.push(`| ${o} | ${entry.text} |`)
    })
    lines.push('')
  }

  // 第二節：領域辭典，依領域 → 來源牌組 → 來源牌
  lines.push('---')
  lines.push('')
  lines.push('## 二、領域辭典')
  lines.push('')

  if (domainRows.length === 0) {
    lines.push('（尚未撰寫）')
  }

  for (const domain of Object.keys(byDomain).sort()) {
    lines.push(`## 領域：${QUESTION_DOMAINS[domain]?.label || domain}`)
    lines.push('')

    const rows = domainRows.filter((row) => row.domain === domain)
    for (const [group, groupLabel] of GROUP_ORDER) {
      const inGroup = rows.filter((row) => {
        const card = bySlug.get(row.fromSlug)
        return card && groupOf(card) === group
      })
      if (inGroup.length === 0) {
        continue
      }

      lines.push(`### ${groupLabel}（作為前一張牌）`)
      lines.push('')

      const bySource = new Map()
      inGroup.forEach((row) => {
        if (!bySource.has(row.fromSlug)) {
          bySource.set(row.fromSlug, [])
        }
        bySource.get(row.fromSlug).push(row)
      })

      const sortedSources = [...bySource.keys()].sort(
        (a, b) => (bySlug.get(a)?.number ?? 0) - (bySlug.get(b)?.number ?? 0),
      )

      for (const slug of sortedSources) {
        lines.push(`#### ${name(slug)}`)
        lines.push('')
        lines.push('| 後一張牌 | 正逆位 | 判定 | 解讀 | 校訂 |')
        lines.push('|---|---|---|---|---|')

        bySource
          .get(slug)
          .sort((a, b) => a.toSlug.localeCompare(b.toSlug) || a.key.localeCompare(b.key))
          .forEach((row) => {
            const o = `${ORIENTATION_LABEL[row.fromOrientation]}／${ORIENTATION_LABEL[row.toOrientation]}`
            const reviewed = row.reviewed ? '✓' : ''
            lines.push(
              `| ${name(row.toSlug)} | ${o} | ${RELATION_LABEL[row.relation] || row.relation} | ${row.text} | ${reviewed} |`,
            )
          })
        lines.push('')
      }
    }
  }

  const outPath = path.join(__dirname, '..', 'doc', '牌與牌關係.md')
  fs.writeFileSync(outPath, `${lines.join('\n')}\n`)
  console.log(`已匯出 ${outPath}`)
  console.log(`人工精選 ${CURATED_PAIRS.length} 筆、領域辭典 ${domainRows.length} 筆`)

  await mongoose.disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
