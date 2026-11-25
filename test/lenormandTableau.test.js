// 雷諾曼大藍圖（v27 階段 5）：L6 代表牌與距離、L7 宮位、L8 主題牌、L10 騎士跳、L11 鏡射、抽牌一定含代表牌
const test = require('node:test')
const assert = require('node:assert/strict')
const zlib = require('zlib')

const { cardById } = require('../src/data/lenormand/cards')
const { spreadByKey } = require('../src/data/lenormand/spreads')
const { analyzeLenormand } = require('../src/services/lenormand/engine')
const { drawCardIds, buildLenormandReading, validateCommon } = require('../src/services/lenormand/reading')

const GT = spreadByKey.get('grand-tableau')
// 9×4：index → 第 index%9+1 欄、第 floor(index/9)+1 列
const at = (col, row) => (row - 1) * 9 + (col - 1)

// 37～52 先放（擴充牌，沒有特殊組合以外的干擾），再補傳統牌湊滿 36 張；place 指定某張牌放在哪一格
function layoutWith(place = {}, exclude = []) {
  const fixed = new Map(Object.entries(place).map(([index, id]) => [Number(index), id]))
  const used = new Set([...fixed.values(), ...exclude])
  const filler = [...Array.from({ length: 16 }, (_, i) => 37 + i), ...Array.from({ length: 36 }, (_, i) => i + 1)].filter((id) => !used.has(id))
  return Array.from({ length: 36 }, (_, index) => (fixed.has(index) ? fixed.get(index) : filler.shift()))
}
function analyze(ids, { significator = 29, question = '', domain = null } = {}) {
  const items = ids.map((id, index) => ({ index, card: cardById.get(id), position: GT.positions[index] }))
  return analyzeLenormand({ items, spread: GT, question, domain, significator })
}

test('L6：代表牌在中間，周圍九宮 8 格、距離分組、方位由近到遠', () => {
  const ids = layoutWith({ [at(5, 2)]: 29 })
  const t = analyze(ids).tableau
  assert.deepEqual(t.center, { mode: 'significator', cardId: 29, present: true, index: at(5, 2), house: at(5, 2) + 1, col: 5, row: 2 })
  assert.equal(t.surroundings.length, 8)
  assert.deepEqual(t.distances.near.sort((a, b) => a - b), t.surroundings)
  assert.equal(t.distances.near.length + t.distances.middle.length + t.distances.far.length, 35)
  // 中：2～3 步；遠：4 步（第 1 欄、第 9 欄）
  assert.ok(t.distances.far.includes(at(1, 2)) && t.distances.far.includes(at(9, 4)))
  assert.ok(t.distances.middle.includes(at(3, 4)))
  assert.deepEqual(t.directions.past, [at(4, 2), at(3, 2), at(2, 2), at(1, 2)])
  assert.deepEqual(t.directions.future, [at(6, 2), at(7, 2), at(8, 2), at(9, 2)])
  assert.deepEqual(t.directions.conscious, [at(5, 1)])
  assert.deepEqual(t.directions.subconscious, [at(5, 3), at(5, 4)])
})

test('L6：代表牌在角落只有 3 格九宮、沒有過去與意識；在邊緣 5 格', () => {
  const corner = analyze(layoutWith({ [at(1, 1)]: 28 }), { significator: 28 }).tableau
  assert.deepEqual(corner.surroundings, [at(2, 1), at(1, 2), at(2, 2)].sort((a, b) => a - b))
  assert.deepEqual(corner.directions.past, [])
  assert.deepEqual(corner.directions.conscious, [])
  assert.equal(corner.directions.future.length, 8)
  assert.equal(corner.directions.subconscious.length, 3)
  const edge = analyze(layoutWith({ [at(5, 4)]: 29 })).tableau
  assert.equal(edge.surroundings.length, 5)
  assert.deepEqual(edge.directions.subconscious, [])
})

test('L6：代表牌沒出現 → 以第 28／29 宮當中心，標明未出現', () => {
  const ids = layoutWith({}, [29])
  assert.ok(!ids.includes(29))
  const t = analyze(ids).tableau
  assert.equal(t.center.mode, 'house')
  assert.equal(t.center.present, false)
  assert.equal(t.center.index, 28) // 第 29 宮 = index 28 = 第 2 欄第 4 列
  assert.deepEqual([t.center.col, t.center.row, t.center.house], [2, 4, 29])
  const reading = buildLenormandReading({ mode: 'manual', ...validateCommon({ spreadKey: 'grand-tableau', significator: 29 }), cardIds: ids })
  assert.match(reading.guidance, /代表你的「淑女」沒有出現，改以第 29 宮（本人／對象）當中心/)
  // L2 不讀沒出現的代表牌
  assert.equal(reading.analysis.pairs.items.filter((p) => p.line === 'significator').length, 0)
})

test('L7：中心與主題牌的宮位、落在自己宮位的牌；擴充牌不算', () => {
  // 熊（15）放在第 15 宮（index 14）；蓮花（37）放在第 37 格不存在，放在第 1 宮也不算自己的宮位
  const ids = layoutWith({ 14: 15, 0: 37, [at(3, 3)]: 29, [at(8, 4)]: 24 })
  const t = analyze(ids, { domain: 'love' }).tableau
  assert.deepEqual(t.houses.center, { index: at(3, 3), house: at(3, 3) + 1 })
  assert.ok(t.houses.own.some((own) => own.index === 14 && own.cardId === 15))
  assert.ok(t.houses.own.every((own) => own.cardId <= 36))
  const love = ids.indexOf(24)
  assert.deepEqual(t.houses.theme, { index: love, house: love + 1 })
})

test('L8：主題牌有出現時看宮位、距離、方位、周圍；沒出現時改讀對應宮位', () => {
  const ids = layoutWith({ [at(2, 2)]: 29, [at(4, 1)]: 24 })
  const theme = analyze(ids, { question: '他喜歡我嗎' }).tableau.themeCard
  assert.deepEqual(
    { ...theme, surroundings: undefined },
    { cardId: 24, present: true, index: at(4, 1), house: at(4, 1) + 1, distance: 'middle', steps: 2, direction: { horizontal: 'future', vertical: 'conscious' }, surroundings: undefined },
  )
  assert.equal(theme.surroundings.length, 5)

  const absent = analyze(layoutWith({ [at(2, 2)]: 29 }, [34]), { domain: 'money' }).tableau
  assert.equal(absent.themeCard.present, false)
  assert.equal(absent.themeCard.index, 33) // 魚＝第 34 宮
  assert.equal(absent.themeCard.house, 34)
  assert.equal(absent.houses.theme, null)
  // 主題牌沒出現時，騎士跳與鏡射從它的宮位那一格出發
  assert.equal(absent.knighting.find((k) => k.from === 'theme').origin, 33)
  const reading = buildLenormandReading({ mode: 'manual', ...validateCommon({ spreadKey: 'grand-tableau', significator: 29, domain: 'money' }), cardIds: layoutWith({ [at(2, 2)]: 29 }, [34]) })
  assert.match(reading.text.sections.find((s) => s.key === 'themeCard').lines[0], /關鍵牌沒有出現在牌面上，改讀它的宮位第 34 宮（豐富）/)

  // 沒有問題類型：沒有主題牌，騎士跳與鏡射只有中心
  const none = analyze(ids, { question: '最近運勢' }).tableau
  assert.equal(none.themeCard, null)
  assert.deepEqual(
    none.knighting.map((k) => k.from),
    ['center'],
  )
})

test('代表牌或關鍵牌沒出現：騎士跳、鏡射不把宮位那格的牌叫成代表牌；關鍵牌就在中心時不重複', () => {
  // 淑女沒出現、愛心沒出現（問感情）
  const ids = layoutWith({}, [29, 24])
  const reading = buildLenormandReading({ mode: 'manual', ...validateCommon({ spreadKey: 'grand-tableau', significator: 29, domain: 'love' }), cardIds: ids })
  const knight = reading.text.sections.find((s) => s.key === 'knighting').lines.join(' ')
  const mirror = reading.text.sections.find((s) => s.key === 'mirrors').lines.join(' ')
  assert.match(knight, /從中心（第 29 宮）「/)
  assert.match(knight, /從關鍵牌的宮位（第 24 宮）「/)
  assert.doesNotMatch(knight + mirror, /代表牌「|從關鍵牌「/)

  // 淑女沒出現、愛心剛好在第 29 宮（中心那一格）
  const same = layoutWith({ 28: 24 }, [29])
  const t = analyze(same, { domain: 'love' }).tableau
  assert.equal(t.center.index, 28)
  assert.equal(t.themeCard.index, 28)
  assert.equal(t.themeCard.steps, 0)
  assert.deepEqual(
    t.knighting.map((k) => k.from),
    ['center'],
  )
  assert.equal(t.mirrors.length, 1)
  const text = buildLenormandReading({ mode: 'manual', ...validateCommon({ spreadKey: 'grand-tableau', significator: 29, domain: 'love' }), cardIds: same })
  assert.match(text.text.sections.find((s) => s.key === 'themeCard').lines[0], /就在中心這一格/)
})

test('引擎直接呼叫時沒有代表牌會丟出明確的錯誤；所有關鍵牌都是傳統牌（有宮位）', () => {
  assert.throws(() => analyze(layoutWith({}), { significator: null }), /大藍圖需要代表牌/)
  const { LENORMAND_DOMAINS } = require('../src/data/lenormand/ruleConfig')
  for (const [key, domain] of Object.entries(LENORMAND_DOMAINS)) assert.ok(domain.themeCardId >= 1 && domain.themeCardId <= 36, key)
  assert.throws(() => drawCardIds(36, (max) => max, 29), /rng/)
})

test('L10：騎士跳在中間 8 格（4 列只有 6 格）、角落 2 格、邊緣較少', () => {
  const middle = analyze(layoutWith({ [at(5, 2)]: 29 })).tableau.knighting[0]
  // 第 5 欄第 2 列：橫 ±2 直 ±1 → 4 格；橫 ±1 直 ±2 → 只有往下 2 列的 2 格（往上會超出）
  assert.deepEqual(middle.targets, [at(3, 1), at(7, 1), at(3, 3), at(7, 3), at(4, 4), at(6, 4)].sort((a, b) => a - b))
  const corner = analyze(layoutWith({ [at(1, 1)]: 29 })).tableau.knighting[0]
  assert.deepEqual(corner.targets, [at(3, 2), at(2, 3)].sort((a, b) => a - b))
  const edge = analyze(layoutWith({ [at(9, 4)]: 29 })).tableau.knighting[0]
  assert.deepEqual(edge.targets, [at(7, 3), at(8, 2)].sort((a, b) => a - b))
})

test('L11：左右、上下、對角鏡射；第 5 欄左右鏡射到自己時略過', () => {
  const t = analyze(layoutWith({ [at(2, 1)]: 29 })).tableau.mirrors[0]
  assert.deepEqual(t, { from: 'center', origin: at(2, 1), leftRight: at(8, 1), topBottom: at(2, 4), diagonal: at(8, 4) })
  const mid = analyze(layoutWith({ [at(5, 3)]: 29 })).tableau.mirrors[0]
  assert.deepEqual(mid, { from: 'center', origin: at(5, 3), leftRight: null, topBottom: at(5, 2), diagonal: null })
  const reading = buildLenormandReading({ mode: 'manual', ...validateCommon({ spreadKey: 'grand-tableau', significator: 29 }), cardIds: layoutWith({ [at(5, 3)]: 29 }) })
  assert.match(reading.text.sections.find((s) => s.key === 'mirrors').lines[0], /在中間欄，左右鏡射是自己/)
})

test('其他規則：L2 只讀代表牌與主題牌的左右相鄰；九宮格與凶牌集中不適用', () => {
  const ids = layoutWith({ [at(5, 2)]: 29, [at(1, 1)]: 24 })
  const a = analyze(ids, { domain: 'love' })
  assert.deepEqual(
    a.pairs.items.map((p) => [p.line, p.from, p.to]),
    [
      ['significator', at(4, 2), at(5, 2)],
      ['significator', at(5, 2), at(6, 2)],
      ['theme', at(1, 1), at(2, 1)], // 角落沒有左邊
    ],
  )
  assert.equal(a.pairs.theme, null)
  assert.equal(a.nineBox, null)
  assert.deepEqual(a.tone.clusters, [])
  // 大藍圖的牌性只看中心周圍（第 5 欄第 2 列：周圍 8 張）
  assert.equal(a.tone.scope, 'near')
  assert.equal(a.tone.total, 8)
})

test('draw：一定含代表牌、位置隨 rng 變、36 張不重複；含擴充牌', () => {
  // rng 一律回 0：代表牌插在第 0 格
  const first = drawCardIds(36, () => 0, 29)
  assert.equal(first.length, 36)
  assert.equal(new Set(first).size, 36)
  assert.equal(first[0], 29)
  // rng 一律回 max-1：代表牌插在最後一格
  const last = drawCardIds(36, (max) => max - 1, 29)
  assert.equal(last[35], 29)
  // 預設亂數：多抽幾次，代表牌每次都在，位置不固定
  const positions = new Set()
  for (let i = 0; i < 200; i += 1) {
    const ids = drawCardIds(36, undefined, 28)
    assert.ok(ids.includes(28))
    assert.equal(new Set(ids).size, 36)
    positions.add(ids.indexOf(28))
  }
  assert.ok(positions.size > 10, `代表牌只出現在 ${positions.size} 個位置`)
})

test('manual：36 張含擴充牌也能分析，文字沒有怪字；回應 gzip 後在 10KB 以內', () => {
  const ids = Array.from({ length: 36 }, (_, i) => i + 17) // 17～52，含 16 張擴充牌，沒有紳士
  const reading = buildLenormandReading({ mode: 'manual', ...validateCommon({ spreadKey: 'grand-tableau', significator: 29, question: '工作會順利嗎' }), cardIds: ids })
  assert.equal(reading.cards.length, 36)
  assert.equal(reading.cards[0].position.house, 1)
  assert.equal(reading.analysis.suits.skipped, 16)
  assert.equal(reading.analysis.tableau.center.present, true)
  const allText = [reading.overview, reading.guidance, ...reading.text.sections.flatMap((s) => s.lines)].join('\n')
  assert.doesNotMatch(allText, /undefined|null|NaN|正位|逆位/)
  const raw = JSON.stringify(reading)
  assert.ok(zlib.gzipSync(raw).length < 10 * 1024, `gzip 後 ${zlib.gzipSync(raw).length} bytes`)
  assert.ok(raw.length < 40 * 1024, `原始 ${raw.length} bytes`)
})
