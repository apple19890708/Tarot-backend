// 批次生成牌對組合辭典。詳見 doc/v05-tarot-pair-dictionary-plan.md
//
// 用法：
//   node scripts/generatePairs.js --from=major --to=major --domain=work [--limit=50] [--dry]
//
//   --from   來源牌組：major / swords / cups / wands / pentacles / all
//   --to     目標牌組，同上，預設 all
//   --domain 領域：work / money / love / social / study
//   --limit  最多處理幾個「來源牌」，用於試跑
//   --dry    只估算數量與成本，不呼叫 AI、不寫入
//
// 可重複執行：已存在的 (key, domain) 會跳過，中斷後直接再跑一次即可續跑。
require('dotenv').config({ quiet: true })

const mongoose = require('mongoose')
const Card = require('../src/models/Card')
const CardPair = require('../src/models/CardPair')
const { getCardProfile } = require('../src/data/cardAttributes')
const { analyzeCombination } = require('../src/services/combinationRules')
const { parseMeaningGroups, getCoreMessage } = require('../src/services/meaningSections')
const { QUESTION_DOMAINS } = require('../src/data/ruleConfig')

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-5.5'
const PARTNERS_PER_REQUEST = 20
const ORIENTATION_PAIRS = [
  ['upright', 'upright'],
  ['upright', 'reversed'],
  ['reversed', 'upright'],
  ['reversed', 'reversed'],
]

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [k, v] = arg.replace(/^--/, '').split('=')
      return [k, v === undefined ? true : v]
    }),
  )
  if (!args.domain || !QUESTION_DOMAINS[args.domain]) {
    throw new Error(`--domain 必須是：${Object.keys(QUESTION_DOMAINS).join(' / ')}`)
  }
  return {
    from: args.from || 'major',
    to: args.to || 'all',
    domain: args.domain,
    limit: args.limit ? Number(args.limit) : null,
    dry: Boolean(args.dry),
  }
}

function inGroup(card, group) {
  if (group === 'all') return true
  if (group === 'major') return card.arcanaType === 'major'
  return card.suit === group
}

const orientationLabel = (o) => (o === 'upright' ? '正位' : '逆位')

function coreOf(card, orientation) {
  const key = orientation === 'upright' ? '正位牌義' : '逆位牌義'
  return getCoreMessage(parseMeaningGroups(card.sections?.[key] || [])) || card.summary || ''
}

// 規則引擎算出的關係，一併送給 AI，要求不可推翻
function relationOf(fromCard, fromOrientation, toCard, toOrientation) {
  const result = analyzeCombination({
    entries: [
      { card: fromCard, orientation: fromOrientation },
      { card: toCard, orientation: toOrientation },
    ],
  })
  return result.pairs[0]?.relation || 'neutral'
}

const RELATION_LABELS = { enhance: '增強', weaken: '削弱', cause: '因果', neutral: '中性' }

const SYSTEM_PROMPT = `你在為塔羅牌對組合辭典撰寫解讀。每一筆描述「前一張牌」接到「後一張牌」時，兩張牌合在一起代表什麼。

規則：
- 繁體中文，口語、具體，一到兩句，每筆不超過 60 字。
- 必須同時考慮兩張牌的正逆位。逆位代表受阻、內化、延遲或過度，不是單純的相反。
- 會附上規則引擎判定的關係（增強／削弱／因果／中性），你的描述不可與它衝突。
- 要寫出「這兩張牌合起來發生了什麼」，不要只是把兩張牌的牌義並排。
- 針對指定的生活領域來寫，讓讀者覺得是在講他問的那件事。
- 不要用「元素」「權重」「分數」這類系統用語，也不要加標題或編號。
- 不給保證、不預言結果。

輸出格式：純 JSON 陣列，每個元素為 { "id": 原樣帶回, "text": "解讀" }，不要加說明文字或程式碼框。`

function buildUserMessage({ fromCard, domainLabel, items }) {
  const lines = items.map(
    (item) =>
      `- id: ${item.id}\n  前：${fromCard.nameZh}${orientationLabel(item.fromOrientation)}（${item.fromCore}）\n  後：${item.toCard.nameZh}${orientationLabel(item.toOrientation)}（${item.toCore}）\n  判定：${RELATION_LABELS[item.relation]}`,
  )

  return `領域：${domainLabel}

請為以下 ${items.length} 組牌對各寫一筆解讀：

${lines.join('\n\n')}`
}

async function callAI(message) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'Tarot Pair Dictionary',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: message },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`OpenRouter ${response.status}: ${payload?.error?.message || response.statusText}`)
  }

  const raw = String(payload?.choices?.[0]?.message?.content || '').trim()
  const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  return JSON.parse(json)
}

async function main() {
  const { from, to, domain, limit, dry } = parseArgs()
  if (!dry && !process.env.OPENROUTER_API_KEY) {
    throw new Error('缺少 OPENROUTER_API_KEY')
  }

  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })

  const all = await Card.find().lean()
  const sources = all.filter((card) => inGroup(card, from)).sort((a, b) => a.slug.localeCompare(b.slug))
  const targets = all.filter((card) => inGroup(card, to))
  const picked = limit ? sources.slice(0, limit) : sources

  // 先算出所有待生成的項目，扣掉已存在的
  const existing = new Set(
    (await CardPair.find({ domain }, 'key').lean()).map((row) => row.key),
  )

  const todo = []
  for (const fromCard of picked) {
    for (const toCard of targets) {
      if (toCard.slug === fromCard.slug) continue
      for (const [fromOrientation, toOrientation] of ORIENTATION_PAIRS) {
        const key = `${fromCard.slug}|${fromOrientation}>${toCard.slug}|${toOrientation}`
        if (existing.has(key)) continue
        todo.push({ key, fromCard, toCard, fromOrientation, toOrientation })
      }
    }
  }

  console.log(`來源 ${picked.length} 張 × 目標 ${targets.length} 張 × 4 正逆位`)
  console.log(`領域：${QUESTION_DOMAINS[domain].label}　已存在 ${existing.size} 筆　待生成 ${todo.length} 筆`)

  if (todo.length === 0) {
    console.log('沒有要生成的項目。')
    await mongoose.disconnect()
    return
  }

  // 粗估：每筆輸出約 120 tokens、輸入攤平後約 110 tokens，依 Opus 5.5 $4/$20 per MTok
  const estimate = (todo.length * 110 * 4 + todo.length * 120 * 20) / 1_000_000
  console.log(`預估成本：約 US$${estimate.toFixed(2)}（實際可能 ±30%）`)

  if (dry) {
    console.log('--dry 模式，未呼叫 AI。')
    await mongoose.disconnect()
    return
  }

  let done = 0
  let failed = 0

  // 以「同一張來源牌 + 同一組正逆位」分批，讓來源牌的牌義只送一次
  for (let i = 0; i < todo.length; i += PARTNERS_PER_REQUEST) {
    const batch = todo.slice(i, i + PARTNERS_PER_REQUEST)
    const fromCard = batch[0].fromCard

    const items = batch.map((entry, index) => ({
      id: String(index),
      entry,
      toCard: entry.toCard,
      fromOrientation: entry.fromOrientation,
      toOrientation: entry.toOrientation,
      fromCore: coreOf(entry.fromCard, entry.fromOrientation),
      toCore: coreOf(entry.toCard, entry.toOrientation),
      relation: relationOf(entry.fromCard, entry.fromOrientation, entry.toCard, entry.toOrientation),
    }))

    try {
      const results = await callAI(
        buildUserMessage({ fromCard, domainLabel: QUESTION_DOMAINS[domain].label, items }),
      )
      const byId = new Map(results.map((row) => [String(row.id), row.text]))

      const ops = items
        .filter((item) => byId.get(item.id))
        .map((item) => ({
          updateOne: {
            filter: { key: item.entry.key, domain },
            update: {
              $set: {
                key: item.entry.key,
                fromSlug: item.entry.fromCard.slug,
                fromOrientation: item.fromOrientation,
                toSlug: item.entry.toCard.slug,
                toOrientation: item.toOrientation,
                domain,
                text: String(byId.get(item.id)).trim(),
                relation: item.relation,
                source: 'ai',
                model: MODEL,
                reviewed: false,
              },
            },
            upsert: true,
          },
        }))

      if (ops.length > 0) {
        await CardPair.bulkWrite(ops)
      }
      done += ops.length
      failed += items.length - ops.length
      console.log(`  ${fromCard.nameZh}：+${ops.length}（累計 ${done} / ${todo.length}）`)
    } catch (error) {
      failed += batch.length
      console.error(`  ${fromCard.nameZh} 批次失敗：${error.message}`)
    }
  }

  console.log(`\n完成：寫入 ${done} 筆，失敗 ${failed} 筆`)
  if (failed > 0) {
    console.log('失敗的項目沒有寫入，重跑同一道指令即可續補。')
  }

  await mongoose.disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
