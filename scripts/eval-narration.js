// 塔羅 AI 解讀的評估（v25 階段 3）。題目在 eval/cases.json，結果寫到 eval/results/（不進 git）。
//
//   node scripts/eval-narration.js              乾跑：組出每一題要送的提示詞，估算 token 與費用，不呼叫 AI
//   node scripts/eval-narration.js --run        印出題數與預估費用就停下來（確認用）
//   node scripts/eval-narration.js --run --yes  真的呼叫 OpenRouter（會花錢；每次都要使用者同意）
//   --only=id1,id2                              只跑這幾題（追問會連同它的 base 一起跑）
//   --recheck=eval/results/xxx.json             不呼叫 AI：用存好的結果重跑檢查（改了檢查規則之後用）
//
// 牌庫從 MongoDB 的 cards 讀（只讀牌，不碰會員資料）。每一題寫完都跑 narrationCheck 的檢查，
// 最後印出各項不合格的題數，並和上一次的結果比較。詳見 doc/v25-tarot-ai-quality-plan.md
require('dotenv').config({ quiet: true })

const fs = require('fs')
const path = require('path')
const mongoose = require('mongoose')

const Card = require('../src/models/Card')
const spreads = require('../src/data/spreads')
const { buildReading } = require('../src/services/readingService')
const { resolveCustomSpread } = require('../src/services/manualDraw')
const { buildFollowUpContext } = require('../src/services/followUp')
const { isTimingQuestion } = require('../src/services/rules/timingRules')
const { checkNarration, CHECK_CODES, PROMPT_VERSION } = require('../src/services/narrationCheck')
const narration = require('../src/services/narrationService')

const ROOT = path.resolve(__dirname, '..')
const CASES_FILE = path.join(ROOT, 'eval', 'cases.json')
const RESULTS_DIR = path.join(ROOT, 'eval', 'results')
const CONCURRENCY = 4

// 預估費用用的假設（實際以 OpenRouter 回報的 cost 為準）：Sonnet 等級每百萬 token 輸入 3、輸出 15 美元，
// 每篇輸出（含推理）約 6000 token；中文大約一個字一個 token
const PRICE = { input: 3 / 1e6, output: 15 / 1e6 }
const OUTPUT_TOKENS_GUESS = 6000

const args = process.argv.slice(2)
const RUN = args.includes('--run')
const CONFIRMED = args.includes('--yes')
const RECHECK = (args.find((arg) => arg.startsWith('--recheck=')) || '').slice('--recheck='.length)
const ONLY = (args.find((arg) => arg.startsWith('--only=')) || '').slice('--only='.length).split(',').filter(Boolean)

// 「權杖十逆」→ { name: '權杖十', orientation: 'reversed' }
function parseCard(text) {
  const mark = text.slice(-1)
  if (mark !== '正' && mark !== '逆') throw new Error(`牌要寫成「牌名＋正／逆」：${text}`)
  return { name: text.slice(0, -1), orientation: mark === '正' ? 'upright' : 'reversed' }
}

function cardsOf(list, byName) {
  return list.map((text) => {
    const { name, orientation } = parseCard(text)
    const card = byName.get(name)
    if (!card) throw new Error(`牌庫裡沒有「${name}」`)
    return { card, orientation }
  })
}

function prepareMain(item, byName) {
  const drawn = cardsOf(item.cards, byName)
  // 沒有牌陣時可以給 positions（字串陣列＝位置名稱），照使用者自訂位置的流程組成牌陣
  let spread = item.spread ? spreads.find((entry) => entry.key === item.spread) : null
  if (item.spread && !spread) throw new Error(`沒有這個牌陣：${item.spread}`)
  if (!item.spread && Array.isArray(item.positions)) {
    const custom = resolveCustomSpread(item.positions.map((label) => ({ label })), drawn.length)
    if (custom.error) throw new Error(`${item.id}：${custom.error}`)
    spread = custom.spread
  }
  if (spread && spread.cardCount !== drawn.length) throw new Error(`${item.id}：${spread.name} 要 ${spread.cardCount} 張`)
  const cards = drawn.map((entry) => entry.card)
  const reading = buildReading({ question: item.question, spread, cards, drawOrientation: (index) => drawn[index].orientation })
  const market = null
  const options = { questionType: reading.analysis.questionType, spreadKey: reading.spread.key }
  const parts = narration.buildSystemParts(market, options)
  return {
    kind: 'main',
    item,
    reading,
    cards,
    drawn,
    kinds: reading.analysis.questionType.kinds,
    sections: narration.pickPromptSections(options),
    systemChars: parts.join('\n\n').length,
    userChars: narration.buildUserMessage({ reading, cards }).length,
  }
}

function prepareFollowUp(item, base, byName) {
  const rounds = item.rounds.map((round) => {
    const drawn = cardsOf(round.cards, byName)
    return { question: round.question, cards: drawn.map((entry) => entry.card), drawn: drawn.map((entry) => ({ orientation: entry.orientation })) }
  })
  const context = buildFollowUpContext({
    question: base.reading.question,
    baseCards: base.cards,
    baseDrawn: base.drawn.map((entry) => ({ orientation: entry.orientation })),
    positionKeys: base.reading.cards.every((entry) => entry.position) ? base.reading.cards.map((entry) => entry.position.key) : null,
    rounds,
  })
  return {
    kind: 'followUp',
    item,
    base,
    context,
    kinds: rounds.some((round) => isTimingQuestion(round.question)) ? ['timing'] : [],
    sections: narration.buildFollowUpSystemParts(context).length > 1 ? ['followUp+'] : [],
    systemChars: narration.buildFollowUpSystemParts(context).join('\n\n').length,
    // 先前的解讀要等 base 寫完才有，估算時加上上限
    userChars: narration.buildFollowUpMessage({ reading: base.reading, cards: base.cards, context }).length + 6000,
  }
}

const estimateCost = (task) => (task.systemChars + task.userChars) * PRICE.input + OUTPUT_TOKENS_GUESS * PRICE.output

async function runTask(task, results) {
  let text = ''
  const started = Date.now()
  const common = { signal: new AbortController().signal, onStart: () => {}, onDelta: (delta) => (text += delta), includeUsage: true }
  try {
    const { model, usage } =
      task.kind === 'main'
        ? await narration.streamNarration({ reading: task.reading, cards: task.cards, ...common })
        : await narration.streamFollowUpNarration({
            reading: task.base.reading,
            cards: task.base.cards,
            context: task.context,
            previousNarration: results.get(task.base.item.id)?.text || '',
            ...common,
          })
    const checks =
      task.kind === 'main'
        ? checkNarration(text, { kinds: task.kinds, cardCount: task.cards.length })
        : checkNarration(text, { kinds: task.kinds, followUp: true, rounds: task.context.rounds.length })
    return { text, model, usage, checks, seconds: Math.round((Date.now() - started) / 1000) }
  } catch (error) {
    return { text, error: error.message, checks: [], seconds: Math.round((Date.now() - started) / 1000) }
  }
}

async function runPool(tasks, results) {
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++]
      const result = await runTask(task, results)
      results.set(task.item.id, result)
      const cost = result.usage?.cost != null ? ` $${Number(result.usage.cost).toFixed(4)}` : ''
      console.log(`  ${task.item.id}：${result.error ? `失敗（${result.error}）` : result.checks.join('、') || '全部合格'}（${result.seconds} 秒${cost}）`)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker))
}

// 是非題的預期答案只做粗略對照：開場第一句有沒有否定詞（只看第一句，後面「不是外部的一擊」這類說明不算）
function expectNote(task, text) {
  const want = task.item.expect?.yesNo
  if (!want || !text) return null
  const opening = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(1, 2).join('')
  const firstSentence = opening.replace(/\*/g, '').split(/[。！？]/)[0]
  const saysNo = /不會|不能|沒有|不是|傾向不/.test(firstSentence)
  const ok = want === 'no' ? saysNo : !saysNo
  return { want, opening: opening.slice(0, 80), ok }
}

function previousResult() {
  if (!fs.existsSync(RESULTS_DIR)) return null
  const files = fs.readdirSync(RESULTS_DIR).filter((name) => name.endsWith('.json')).sort()
  return files.length > 0 ? JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, files[files.length - 1]), 'utf8')) : null
}

// 用存好的結果重跑檢查與是非題對照，結果寫回同一個檔
function recheck(file) {
  const saved = JSON.parse(fs.readFileSync(path.resolve(ROOT, file), 'utf8'))
  const cases = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'))
  const itemOf = (id) => [...cases.cases, ...cases.followUps].find((item) => item.id === id) || {}
  const now = new Date(saved.date)
  for (const record of saved.records) {
    const item = itemOf(record.id)
    if (!record.text) record.checks = []
    else if (record.kind === 'main') record.checks = checkNarration(record.text, { kinds: record.kinds, cardCount: item.cards?.length || 0, now })
    else record.checks = checkNarration(record.text, { kinds: record.kinds, followUp: true, rounds: item.rounds?.length || 0, now })
    record.expect = expectNote({ item }, record.text)
  }
  saved.summary = Object.fromEntries(CHECK_CODES.map((code) => [code, saved.records.filter((record) => record.checks.includes(code)).map((record) => record.id)]))
  fs.writeFileSync(path.resolve(ROOT, file), `${JSON.stringify(saved, null, 2)}\n`)
  for (const code of CHECK_CODES) if (saved.summary[code].length > 0) console.log(`  ${code}：${saved.summary[code].length} ${saved.summary[code].join('、')}`)
  for (const record of saved.records.filter((entry) => entry.expect)) {
    console.log(`  是非題對照 ${record.id}：預期 ${record.expect.want}，開場「${record.expect.opening}」${record.expect.ok ? '' : ' ← 要人工看'}`)
  }
  console.log('已重跑檢查（沒有呼叫 AI）')
}

async function main() {
  if (RECHECK) return recheck(RECHECK)
  const file = JSON.parse(fs.readFileSync(CASES_FILE, 'utf8'))
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })
  const deck = await Card.find({}).lean()
  await mongoose.disconnect()
  const byName = new Map(deck.map((card) => [card.nameZh, card]))

  const wanted = (id) => ONLY.length === 0 || ONLY.includes(id)
  const followItems = file.followUps.filter((item) => wanted(item.id))
  const baseIds = new Set(followItems.map((item) => item.base))
  const mains = file.cases.filter((item) => wanted(item.id) || baseIds.has(item.id)).map((item) => prepareMain(item, byName))
  const mainById = new Map(mains.map((task) => [task.item.id, task]))
  const follows = followItems.map((item) => prepareFollowUp(item, mainById.get(item.base), byName))
  const tasks = [...mains, ...follows]

  console.log(`提示詞版本 ${PROMPT_VERSION}；共 ${tasks.length} 次 AI 呼叫（解讀 ${mains.length}、追問 ${follows.length}）`)
  const fullChars = narration.SYSTEM_PROMPT.length
  for (const task of tasks) {
    const saved = task.kind === 'main' ? `（完整版 ${fullChars} 字，少 ${Math.round((1 - task.systemChars / fullChars) * 100)}%）` : ''
    console.log(`  ${task.item.id}｜${task.kinds.join('+') || '—'}｜段落 ${task.sections.join('+') || '只有共用'}｜系統提示 ${task.systemChars} 字${saved}｜資料 ${task.userChars} 字`)
  }
  const estimate = tasks.reduce((sum, task) => sum + estimateCost(task), 0)
  console.log(`預估費用約 $${estimate.toFixed(2)}（假設：輸入 $3／百萬、輸出 $15／百萬 token，每篇輸出約 ${OUTPUT_TOKENS_GUESS} token；沒算快取折扣）`)

  if (!RUN) return
  if (!CONFIRMED) {
    console.log('這是確認用的輸出，沒有呼叫 AI。確定要花這筆錢就加 --yes 再跑一次。')
    return
  }
  if (!narration.isNarrationAvailable()) throw new Error('沒有設定 OPENROUTER_API_KEY')

  const results = new Map()
  console.log('\n解讀：')
  await runPool(mains, results)
  if (follows.length > 0) {
    console.log('\n追問：')
    await runPool(follows, results)
  }

  const records = tasks.map((task) => {
    const result = results.get(task.item.id)
    return {
      id: task.item.id,
      kind: task.kind,
      question: task.kind === 'main' ? task.item.question : task.item.rounds.map((round) => round.question),
      kinds: task.kinds,
      sections: task.sections,
      model: result.model || null,
      usage: result.usage || null,
      seconds: result.seconds,
      error: result.error || null,
      checks: result.checks,
      expect: expectNote(task, result.text),
      text: result.text,
      review: '',
    }
  })

  const summary = Object.fromEntries(CHECK_CODES.map((code) => [code, records.filter((record) => record.checks.includes(code)).map((record) => record.id)]))
  const totalCost = records.reduce((sum, record) => sum + (Number(record.usage?.cost) || 0), 0)
  const output = { date: new Date().toISOString(), promptVersion: PROMPT_VERSION, model: narration.MODEL, totalCost, summary, records }

  const previous = previousResult()
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  // 同一天同一版跑好幾次時不覆蓋（看同一版的穩定度要比好幾次）：已存在就加 -2、-3…
  const base = `${output.date.slice(0, 10)}-v${PROMPT_VERSION}`
  let outFile = path.join(RESULTS_DIR, `${base}.json`)
  for (let n = 2; fs.existsSync(outFile); n += 1) outFile = path.join(RESULTS_DIR, `${base}-${n}.json`)
  fs.writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`)

  console.log('\n各項不合格的題數：')
  for (const code of CHECK_CODES) {
    const before = previous?.summary?.[code]?.length
    const diff = before === undefined ? '' : `（上一次 ${before}）`
    if (summary[code].length > 0 || before) console.log(`  ${code}：${summary[code].length}${diff} ${summary[code].join('、')}`)
  }
  const failed = records.filter((record) => record.error)
  if (failed.length > 0) console.log(`失敗 ${failed.length} 題：${failed.map((record) => record.id).join('、')}`)
  for (const record of records.filter((item) => item.expect)) {
    console.log(`  是非題對照 ${record.id}：預期 ${record.expect.want}，開場「${record.expect.opening}」${record.expect.ok ? '' : ' ← 要人工看'}`)
  }
  console.log(`實際費用 $${totalCost.toFixed(4)}（OpenRouter 回報）`)
  console.log(`結果：${path.relative(ROOT, outFile)}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
