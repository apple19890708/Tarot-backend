const test = require('node:test')
const assert = require('node:assert')

const Reading = require('../src/models/Reading')
const spreads = require('../src/data/spreads')
const { toReadingInput } = require('../src/services/readingHistory')

const CARD_A = '507f1f77bcf86cd799439011'
const CARD_B = '507f1f77bcf86cd799439012'
const CARD_C = '507f1f77bcf86cd799439013'

// 不連資料庫：mongoose 的 document 不呼叫 save 就不需要連線
function makeRecord(overrides = {}) {
  return new Reading({
    user: '507f1f77bcf86cd7994390ff',
    question: '這份工作適合我嗎',
    spreadKey: 'timeline',
    spreadName: '時間線',
    cards: [
      { cardId: CARD_A, orientation: 'upright', nameZh: '愚者' },
      { cardId: CARD_B, orientation: 'reversed', nameZh: '魔術師' },
      { cardId: CARD_C, orientation: 'upright', nameZh: '女祭司' },
    ],
    ...overrides,
  })
}

test('紀錄摘要只給列表需要的欄位，不含 AI 文字', () => {
  const summary = makeRecord({
    narration: { text: '很長的一段解讀', model: 'test-model' },
  }).toSummaryJSON()

  assert.strictEqual(summary.question, '這份工作適合我嗎')
  assert.strictEqual(summary.cardCount, 3)
  assert.deepStrictEqual(
    summary.cards.map((card) => `${card.nameZh}${card.orientation === 'upright' ? '正' : '逆'}`),
    ['愚者正', '魔術師逆', '女祭司正'],
  )
  // 有沒有 AI 解讀是布林值，列表不把整段文字送出去
  assert.strictEqual(summary.hasNarration, true)
  assert.strictEqual(summary.text, undefined)
  assert.strictEqual(summary.narration, undefined)
})

test('沒有 AI 解讀時 hasNarration 為 false', () => {
  assert.strictEqual(makeRecord().toSummaryJSON().hasNarration, false)
})

test('還原牌陣紀錄：牌與正逆位照原順序，牌陣由 key 查回來', () => {
  const { drawn, spread } = toReadingInput(makeRecord(), spreads)

  assert.deepStrictEqual(drawn, [
    { id: CARD_A, orientation: 'upright' },
    { id: CARD_B, orientation: 'reversed' },
    { id: CARD_C, orientation: 'upright' },
  ])
  assert.strictEqual(spread.key, 'timeline')
  assert.strictEqual(spread.positions.length, 3)
})

test('還原自訂位置：沒有牌陣 key 時用存下來的 positions 重組臨時牌陣', () => {
  const record = makeRecord({
    spreadKey: null,
    spreadName: '自訂牌陣',
    positions: [
      { label: '我的想法', prompt: '我怎麼看這件事' },
      { label: '對方的想法', prompt: '' },
      { label: '結果', prompt: '' },
    ],
  })

  const { spread } = toReadingInput(record, spreads)

  assert.strictEqual(spread.key, 'custom')
  assert.deepStrictEqual(
    spread.positions.map((position) => position.label),
    ['我的想法', '對方的想法', '結果'],
  )
  // 沒寫說明時用位置名稱頂上，後續流程才不會拿到空字串
  assert.strictEqual(spread.positions[1].prompt, '對方的想法')
})

test('沒有牌陣也沒有自訂位置時，退回無位置的自選牌', () => {
  const { spread } = toReadingInput(makeRecord({ spreadKey: null, positions: undefined }), spreads)
  assert.strictEqual(spread, null)
})

test('牌陣張數與紀錄對不上時退回無位置，不讓整筆紀錄打不開', () => {
  const record = makeRecord({
    spreadKey: 'celtic-cross',
    cards: [{ cardId: CARD_A, orientation: 'upright', nameZh: '愚者' }],
  })

  assert.strictEqual(toReadingInput(record, spreads).spread, null)
})

test('牌陣已經不存在時也退回無位置', () => {
  const record = makeRecord({ spreadKey: 'spread-that-was-removed' })
  assert.strictEqual(toReadingInput(record, spreads).spread, null)
})

// v29 項目 3：列表用 .select(LIST_FIELDS).lean() 查，摘要要能吃投影後的形狀
test('紀錄摘要（純函式）：投影後的 narration 是 {} 或 { createdAt } 算有解讀，null／沒有這個欄位算沒有', () => {
  const Reading = require('../src/models/Reading')
  const { readingSummary, LIST_FIELDS } = Reading
  const base = { _id: 'r1', question: 'q', cards: [{ cardId: 'c1', orientation: 'upright', nameZh: '愚者' }], createdAt: new Date(0) }
  assert.strictEqual(readingSummary({ ...base, narration: { createdAt: new Date() } }).hasNarration, true)
  assert.strictEqual(readingSummary({ ...base, narration: {} }).hasNarration, true)
  assert.strictEqual(readingSummary({ ...base, narration: null }).hasNarration, false)
  assert.strictEqual(readingSummary(base).hasNarration, false)
  assert.strictEqual(readingSummary({ ...base, followUps: [{ createdAt: new Date() }, {}] }).followUpCount, 2)
  // 列表查的欄位涵蓋摘要用到的每一個，而且不含 AI 全文與行情
  for (const field of ['question', 'domain', 'spreadKey', 'spreadName', 'cards', 'createdAt', 'narration.createdAt', 'followUps.createdAt']) {
    assert.ok(LIST_FIELDS.split(' ').includes(field), field)
  }
  assert.ok(!LIST_FIELDS.includes('narration.text') && !LIST_FIELDS.includes('narration.market'))

  const { lenormandSummary, LIST_FIELDS: LENORMAND_FIELDS } = require('../src/models/LenormandReading')
  const { cardById } = require('../src/data/lenormand/cards')
  const lenormandBase = { _id: 'l1', spreadKey: 'theme-3', cards: [1, 24, 25], createdAt: new Date(0) }
  assert.strictEqual(lenormandSummary({ ...lenormandBase, narration: {} }, cardById).hasNarration, true)
  assert.strictEqual(lenormandSummary(lenormandBase, cardById).hasNarration, false)
  assert.strictEqual(lenormandSummary(lenormandBase, cardById).cards[1].nameZh, '愛心')
  assert.ok(!LENORMAND_FIELDS.includes('narration.text'))
})
