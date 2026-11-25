// 雷諾曼規則引擎（v27 階段 3）：L1～L5、L9 的邊界、字典完整性、抽牌與 API 輸入驗證
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { cards, cardById } = require('../src/data/lenormand/cards')
const { spreadByKey } = require('../src/data/lenormand/spreads')
const { COMBOS, LENORMAND_DOMAINS, DOMAIN_ORDER } = require('../src/data/lenormand/ruleConfig')
const { QUESTION_DOMAINS } = require('../src/data/ruleConfig')
const { analyzeLenormand } = require('../src/services/lenormand/engine')
const { resolveDomain } = require('../src/services/lenormand/rules/domain')
const { shuffle, drawCardIds, buildLenormandReading, validateCommon } = require('../src/services/lenormand/reading')
const { createLenormandRouter } = require('../src/routes/lenormand')

// 依牌號組 items；overrides 可以換掉某張牌的欄位（例如 facing）
function itemsOf(spreadKey, ids, overrides = {}) {
  const spread = spreadByKey.get(spreadKey)
  return ids.map((id, index) => ({ index, card: { ...cardById.get(id), ...(overrides[id] || {}) }, position: spread.positions[index] }))
}
function analyze(spreadKey, ids, options = {}) {
  const { overrides, ...rest } = options
  return analyzeLenormand({ items: itemsOf(spreadKey, ids, overrides), spread: spreadByKey.get(spreadKey), ...rest })
}

// ---- 字典與設定 ----

test('L3 字典：約 60 組以上、id 與牌對都不重複、牌號都存在、牌性合法、有鸛鳥朝向蛇', () => {
  assert.ok(COMBOS.length >= 60, `只有 ${COMBOS.length} 組`)
  assert.equal(new Set(COMBOS.map((c) => c.id)).size, COMBOS.length)
  const pairs = COMBOS.map((c) => [...c.cards].sort((a, b) => a - b).join('-'))
  assert.equal(new Set(pairs).size, COMBOS.length, '同一對牌出現兩次')
  for (const combo of COMBOS) {
    assert.equal(combo.cards.length, 2)
    assert.notEqual(combo.cards[0], combo.cards[1])
    combo.cards.forEach((id) => assert.ok(cardById.has(id), `${combo.id} 的牌號 ${id} 不存在`))
    assert.ok(['positive', 'negative', 'neutral'].includes(combo.tone))
    assert.ok(combo.meaning && !/[。.]$/.test(combo.meaning), `${combo.id} 的短語不要句號`)
  }
  const stork = COMBOS.find((c) => c.id === 'stork-snake')
  assert.deepEqual(stork.cards, [17, 7])
  assert.equal(stork.condition, 'faces')
})

test('問題類型：不含股市，主題牌照計畫書；塔羅的關鍵詞陣列不會被凍結', () => {
  assert.equal(Object.hasOwn(LENORMAND_DOMAINS, 'stock'), false)
  assert.deepEqual([...DOMAIN_ORDER].sort(), Object.keys(LENORMAND_DOMAINS).sort())
  assert.equal(LENORMAND_DOMAINS.love.themeCardId, 24)
  assert.equal(LENORMAND_DOMAINS.money.themeCardId, 34)
  assert.equal(LENORMAND_DOMAINS.work.themeCardId, 35)
  assert.equal(LENORMAND_DOMAINS.health.themeCardId, 5)
  assert.equal(LENORMAND_DOMAINS.family.themeCardId, 4)
  assert.equal(Object.isFrozen(QUESTION_DOMAINS.love.keywords), false)
})

test('問題類型：選的優先；沒選看關鍵詞；「家人」同分時歸家庭；沒命中是 none', () => {
  assert.deepEqual(resolveDomain({ selected: 'health', question: '他喜歡我嗎' }), { key: 'health', label: '健康', source: 'selected', themeCardId: 5 })
  assert.equal(resolveDomain({ question: '他喜歡我嗎' }).key, 'love')
  assert.equal(resolveDomain({ question: '下個月的手術順利嗎' }).key, 'health')
  assert.equal(resolveDomain({ question: '和家人的關係' }).key, 'family')
  assert.equal(resolveDomain({ question: '最近運勢' }).source, 'none')
  assert.equal(resolveDomain({ question: '最近運勢' }).themeCardId, null)
  // heuristic-check 找到的誤判（真實句子）
  assert.equal(resolveDomain({ question: '這隻貓好可愛，要不要養' }).key, null)
  assert.equal(resolveDomain({ question: '他是不是還喜歡我？' }).key, 'love')
  assert.equal(resolveDomain({ question: '家人對租屋還是買房的態度會不會影響我' }).key, 'money')
  assert.equal(resolveDomain({ question: '和家人的相處要怎麼改善？' }).key, 'family')
  assert.equal(resolveDomain({ question: '最近睡不好，身體有什麼要注意的？' }).key, 'health')
  // 「毛病」「檢查工作」不是健康
  assert.notEqual(resolveDomain({ question: '主管一直挑我毛病' }).key, 'health')
  assert.equal(resolveDomain({ question: '主管一直挑我毛病' }).key, 'work')
})

// ---- L1 ----

test('L1：3 張裡多 1 張吉牌就算偏吉；吉凶都有算交錯；全中性是中性', () => {
  assert.equal(analyze('theme-3', [2, 1, 3]).tone.lean, 'positive') // 四葉草 吉、騎士、船 中性
  assert.equal(analyze('theme-3', [6, 1, 3]).tone.lean, 'negative')
  assert.equal(analyze('theme-3', [2, 1, 6]).tone.lean, 'mixed')
  const neutral = analyze('timeline-3', [1, 3, 12]).tone
  assert.equal(neutral.lean, 'neutral')
  assert.deepEqual(neutral.counts, { positive: 0, negative: 0, neutral: 3 })
  assert.deepEqual(neutral.clusters, [])
})

test('L1：九宮格同一列 2 張凶牌算集中，1 張不算；欄也一樣', () => {
  // 第一列：雲、蛇、騎士 → 2 凶；第一欄：雲、四葉草、太陽 → 1 凶
  const tone = analyze('nine-box', [6, 7, 1, 2, 3, 12, 31, 16, 9]).tone
  assert.deepEqual(
    tone.clusters.map((c) => [c.axis, c.key, c.indexes]),
    [['row', 'mind', [0, 1]]],
  )
})

// ---- L3 鸛鳥朝向蛇 ----

test('L3：鸛鳥在蛇左邊朝右 → 清除，蛇在 L1 當中性；鸛鳥朝左 → 不算', () => {
  const cleansed = analyze('timeline-3', [1, 17, 7])
  const combo = cleansed.combos.find((c) => c.id === 'stork-snake')
  assert.ok(combo)
  assert.deepEqual(combo.indexes, [1, 2])
  assert.equal(combo.cleanses, 2)
  assert.deepEqual(cleansed.tone.cleansedIndexes, [2])
  assert.equal(cleansed.tone.counts.negative, 0)

  const facingAway = analyze('timeline-3', [1, 17, 7], { overrides: { 17: { facing: 'left' } } })
  assert.equal(facingAway.combos.find((c) => c.id === 'stork-snake'), undefined)
  assert.deepEqual(facingAway.tone.cleansedIndexes, [])
  assert.equal(facingAway.tone.counts.negative, 1)
})

test('L3：鸛鳥在蛇右邊（朝右、背對蛇）不算；九宮格上下相鄰也不算（朝向只看左右）', () => {
  assert.equal(analyze('timeline-3', [7, 17, 1]).combos.find((c) => c.id === 'stork-snake'), undefined)
  // 九宮格：鸛鳥在 (1,1)、蛇在 (1,2) 上下相鄰
  const nine = analyze('nine-box', [17, 1, 3, 7, 12, 13, 16, 18, 20])
  assert.equal(nine.combos.find((c) => c.id === 'stork-snake'), undefined)
})

test('L3：一般組合不分順序、只看相鄰；鸛鳥朝向其他凶牌也化解', () => {
  assert.ok(analyze('theme-3', [25, 24, 1]).combos.some((c) => c.id === 'ring-heart'))
  assert.ok(analyze('theme-3', [24, 25, 1]).combos.some((c) => c.id === 'ring-heart'))
  // 隔一張就不算（中間放船，船和戒指、愛心都沒有組合）
  assert.equal(analyze('theme-3', [25, 3, 24]).combos.length, 0)
  // 九宮格上下相鄰也算
  assert.ok(analyze('nine-box', [25, 1, 3, 24, 12, 13, 16, 18, 20]).combos.some((c) => c.id === 'ring-heart'))
  const mountain = analyze('timeline-3', [17, 21, 1])
  const cleanse = mountain.combos.find((c) => c.id === 'cleanse-17-21')
  assert.ok(cleanse)
  assert.equal(cleanse.cleanses, 1)
})

// ---- L2 ----

test('L2：主題牌陣讀成主題被左右形容；五張的外側形容內側', () => {
  const three = analyze('theme-3', [2, 24, 8]).pairs
  assert.deepEqual(three.theme, { index: 1, cardId: 24, modifierIndexes: [0, 2], effect: 'mixed' })
  assert.deepEqual(
    three.items.map((p) => [p.from, p.to, p.kind, p.effect]),
    [
      [1, 0, 'modifier', 'brightens'],
      [1, 2, 'modifier', 'darkens'],
    ],
  )
  assert.equal(analyze('theme-3', [2, 24, 1]).pairs.theme.effect, 'brightened')
  assert.equal(analyze('theme-3', [6, 24, 1]).pairs.theme.effect, 'darkened')
  assert.equal(analyze('theme-3', [1, 24, 3]).pairs.theme.effect, 'neutral')
  const five = analyze('theme-5', [1, 2, 24, 3, 6]).pairs
  assert.deepEqual(five.theme.modifierIndexes, [1, 3])
  assert.ok(five.items.some((p) => p.from === 1 && p.to === 0 && p.kind === 'modifier'))
  assert.ok(five.items.some((p) => p.from === 3 && p.to === 4 && p.kind === 'modifier'))
})

test('L2：時間線讀轉折；九宮格每列由左到右、每欄由上到下', () => {
  const timeline = analyze('timeline-3', [8, 1, 31]).pairs
  assert.equal(timeline.theme, null)
  assert.deepEqual(
    timeline.items.map((p) => [p.kind, p.shift]),
    [
      ['sequence', 'improve'],
      ['sequence', 'improve'],
    ],
  )
  assert.equal(analyze('timeline-3', [31, 8, 36]).pairs.items[1].shift, 'steady')
  const nine = analyze('nine-box', [1, 2, 3, 4, 5, 6, 7, 8, 9]).pairs.items
  assert.equal(nine.filter((p) => p.kind === 'sequence').length, 6)
  assert.equal(nine.filter((p) => p.kind === 'stack').length, 6)
  assert.deepEqual(
    nine.filter((p) => p.line === 'past').map((p) => [p.from, p.to]),
    [
      [0, 3],
      [3, 6],
    ],
  )
  assert.deepEqual(
    nine.filter((p) => p.line === 'reality').map((p) => [p.from, p.to]),
    [
      [3, 4],
      [4, 5],
    ],
  )
})

// ---- L4 ----

test('L4：紳士在左、淑女在右相鄰 → 對視；淑女在左、紳士在右相鄰 → 背對', () => {
  const facing = analyze('theme-3', [28, 29, 24]).gaze
  assert.equal(facing.couple.relation, 'faceToFace')
  assert.deepEqual(facing.mutual, [{ a: 0, b: 1, relation: 'faceToFace' }])
  const back = analyze('theme-3', [29, 28, 24]).gaze
  assert.equal(back.couple.relation, 'backToBack')
  assert.deepEqual(back.mutual, [{ a: 0, b: 1, relation: 'backToBack' }])
})

test('L4：中間隔著牌的對視、同方向、不同列；只有一個人時沒有 couple', () => {
  const apart = analyze('theme-3', [28, 24, 29]).gaze.couple
  assert.equal(apart.relation, 'facingApart')
  assert.deepEqual(apart.between, [1])
  const same = analyze('theme-3', [28, 24, 29], { overrides: { 29: { facing: 'right' } } }).gaze.couple
  assert.equal(same.relation, 'sameDirection')
  assert.equal(analyze('nine-box', [28, 1, 3, 29, 12, 13, 16, 18, 20]).gaze.couple.relation, 'differentRows')
  assert.equal(analyze('theme-3', [28, 24, 1]).gaze.couple, null)
})

test('L4：看向與背對；邊緣看向牌陣外；代表牌的視線', () => {
  const gaze = analyze('timeline-3', [24, 1, 27], { significator: 28 }).gaze
  // 騎士在中間朝右：看向信件、背對愛心
  assert.deepEqual(gaze.looks, [{ index: 1, cardId: 1, facing: 'right', toward: 2, away: 0 }])
  assert.deepEqual(gaze.significator, { cardId: 28, index: null, toward: null, away: null })
  const edge = analyze('timeline-3', [24, 27, 1]).gaze.looks[0]
  assert.equal(edge.toward, null)
  assert.equal(edge.away, 1)
  const sig = analyze('timeline-3', [24, 29, 27], { significator: 29 }).gaze.significator
  assert.deepEqual(sig, { cardId: 29, index: 1, toward: 0, away: 2 })
})

// ---- L5 ----

test('L5：九宮格的列、欄、中心、對角線、四角、鏡射', () => {
  // 吉在主對角線（四葉草、太陽、鑽石），凶在反對角線兩端（雲、棺材）
  const ids = [2, 1, 6, 3, 31, 12, 8, 13, 52]
  const box = analyze('nine-box', ids).nineBox
  assert.deepEqual(
    box.rows.map((r) => r.key),
    ['mind', 'reality', 'heart'],
  )
  assert.deepEqual(
    box.cols.map((c) => [c.key, c.indexes]),
    [
      ['past', [0, 3, 6]],
      ['present', [1, 4, 7]],
      ['future', [2, 5, 8]],
    ],
  )
  assert.deepEqual(box.center, { index: 4, cardId: 31, tone: 'positive' })
  assert.deepEqual(box.diagonals[0], { key: 'main', indexes: [0, 4, 8], cardIds: [2, 31, 52], lean: 'positive' })
  assert.deepEqual(box.diagonals[1].indexes, [2, 4, 6])
  assert.equal(box.diagonals[1].lean, 'negative')
  assert.deepEqual(box.corners.indexes, [0, 2, 6, 8])
  // 四角：四葉草、鑽石（吉）、雲、棺材（凶）
  assert.equal(box.corners.lean, 'mixed')
  assert.deepEqual(
    box.mirrors.map((m) => [m.axis, m.a, m.b]),
    [
      ['leftRight', 0, 2],
      ['leftRight', 3, 5],
      ['leftRight', 6, 8],
      ['topBottom', 0, 6],
      ['topBottom', 1, 7],
      ['topBottom', 2, 8],
    ],
  )
  assert.equal(analyze('theme-3', [1, 2, 3]).nineBox, null)
})

// ---- L9 ----

test('L9：花色分布、主導、紅黑、人頭牌與 A；37～52 略過並記張數', () => {
  // 紳士 ♥A、愛心 ♥J、淑女 ♠A
  const suits = analyze('theme-3', [28, 24, 29]).suits
  assert.equal(suits.counted, 3)
  assert.equal(suits.skipped, 0)
  assert.deepEqual(suits.counts, { hearts: 2, diamonds: 0, clubs: 0, spades: 1 })
  assert.deepEqual(suits.dominant, ['hearts'])
  assert.equal(suits.colorLean, 'red')
  assert.deepEqual(
    suits.faces.map((f) => [f.cardId, f.rank]),
    [[24, 'J']],
  )
  assert.deepEqual(
    suits.aces.map((a) => a.cardId),
    [28, 29],
  )

  const expansion = analyze('theme-3', [37, 1, 52]).suits
  assert.equal(expansion.counted, 1)
  assert.equal(expansion.skipped, 2)
  const none = analyze('theme-3', [37, 38, 39]).suits
  assert.equal(none.counted, 0)
  assert.equal(none.skipped, 3)
  assert.deepEqual(none.dominant, [])
  assert.equal(none.colorLean, null)
  // 並列最多
  assert.deepEqual(analyze('theme-3', [1, 6, 37]).suits.dominant, ['hearts', 'clubs'])
  assert.equal(analyze('theme-3', [1, 6, 37]).suits.colorLean, 'even')
})

// ---- 回應與文字 ----

test('回應形狀照 3-12：欄位齊全、牌只有精簡欄位、tableau 預留 null、文字沒有正逆位', () => {
  const common = validateCommon({ spreadKey: 'nine-box', question: '今年的工作', significator: 29 })
  const reading = buildLenormandReading({ mode: 'manual', ...common, cardIds: [17, 7, 23, 21, 31, 35, 8, 36, 52] })
  assert.deepEqual(Object.keys(reading).sort(), ['analysis', 'cards', 'deck', 'guidance', 'mode', 'overview', 'question', 'significator', 'spread', 'text'].sort())
  assert.equal(reading.deck, 'lenormand')
  assert.deepEqual(Object.keys(reading.analysis).sort(), ['combos', 'domain', 'gaze', 'nineBox', 'pairs', 'questionType', 'suits', 'tableau', 'tone'].sort())
  assert.equal(reading.analysis.tableau, null)
  assert.equal(reading.analysis.domain.key, 'work')
  assert.equal(reading.analysis.domain.themeIndex, 5)
  assert.equal(reading.cards[0].card.meaning, undefined)
  assert.deepEqual(Object.keys(reading.cards[0]).sort(), ['card', 'index', 'position'])
  assert.equal(reading.cards[4].position.label, '現在 × 現實／問題的狀況')
  assert.match(reading.overview, /^過去 × 思想／未掌握／希望的事：鸛鳥、/)
  const keys = reading.text.sections.map((s) => s.key)
  assert.deepEqual(keys, ['tone', 'pairs', 'combos', 'gaze', 'nineBox', 'suits'])
  const allText = [reading.overview, reading.guidance, ...reading.text.sections.flatMap((s) => s.lines)].join('\n')
  assert.doesNotMatch(allText, /正位|逆位|undefined|null|NaN/)
  assert.match(allText, /鸛鳥朝向蛇/)
})

test('文字：沒有組合、沒有朝向時不出現空段落；人物牌當形容詞不用「男問卜者」', () => {
  const common = validateCommon({ spreadKey: 'theme-3' })
  const plain = buildLenormandReading({ mode: 'manual', ...common, cardIds: [37, 38, 39] })
  assert.deepEqual(
    plain.text.sections.map((s) => s.key),
    ['tone', 'pairs', 'suits'],
  )
  const person = buildLenormandReading({ mode: 'manual', ...common, cardIds: [29, 24, 28] })
  const text = person.text.sections.flatMap((s) => s.lines).join('\n')
  assert.doesNotMatch(text, /男問卜者|女問卜者/)
  assert.match(text, /背對背/)
})

// ---- 抽牌 ----

test('洗牌：Fisher–Yates，rng 可注入固定結果；預設亂數抽出不重複的牌', () => {
  // rng 一律回 0：每一步都把最後一張和第一張交換
  assert.deepEqual(shuffle([1, 2, 3, 4], () => 0), [2, 3, 4, 1])
  assert.throws(() => shuffle([1, 2, 3], () => 5), /rng/)
  const ids = drawCardIds(9)
  assert.equal(ids.length, 9)
  assert.equal(new Set(ids).size, 9)
  ids.forEach((id) => assert.ok(id >= 1 && id <= 52))
  // 多抽幾次，52 張都抽得到（不會漏掉擴充牌）
  const seen = new Set()
  for (let i = 0; i < 200; i += 1) drawCardIds(9).forEach((id) => seen.add(id))
  assert.equal(seen.size, cards.length)
})

// ---- API ----

async function withApp(run, rng) {
  const app = express()
  app.use(express.json())
  const allow = (req, _res, next) => {
    req.auth = { userId: 'u1', role: 'member' }
    next()
  }
  app.use('/api/lenormand', createLenormandRouter({ requireLenormandAccess: allow, rng }))
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  try {
    await run(`http://127.0.0.1:${server.address().port}/api/lenormand`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}
const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('API draw：固定 rng 抽出固定的牌；大藍圖沒選代表牌回 400；股市與錯的代表牌回 400', async () => {
  await withApp(
    async (base) => {
      const ok = await fetch(`${base}/readings/draw`, post({ spreadKey: 'theme-3', question: '他喜歡我嗎', significator: 29 }))
      assert.equal(ok.status, 200)
      const body = await ok.json()
      assert.equal(body.mode, 'draw')
      // rng 一律回 0：洗完的前三張是 2、3、4
      assert.deepEqual(
        body.cards.map((c) => c.card.id),
        [2, 3, 4],
      )
      assert.equal(body.analysis.domain.key, 'love')

      const noSig = await fetch(`${base}/readings/draw`, post({ spreadKey: 'grand-tableau' }))
      assert.equal(noSig.status, 400)
      assert.equal((await noSig.json()).message, '這個牌陣需要選擇代表牌。')
      assert.equal((await fetch(`${base}/readings/draw`, post({ spreadKey: 'nope' }))).status, 400)
      assert.equal((await fetch(`${base}/readings/draw`, post({ spreadKey: 'theme-3', domain: 'stock' }))).status, 400)
      assert.equal((await fetch(`${base}/readings/draw`, post({ spreadKey: 'theme-3', domain: 'toString' }))).status, 400)
      for (const significator of [27, '28', 28.5, true, 0, false]) {
        assert.equal((await fetch(`${base}/readings/draw`, post({ spreadKey: 'theme-3', significator }))).status, 400, String(significator))
      }
      assert.equal((await fetch(`${base}/readings/draw`, post({ spreadKey: 'theme-3', question: 'x'.repeat(501) }))).status, 400)
      assert.equal((await fetch(`${base}/readings/draw`, post({ spreadKey: 'theme-3', significator: null, domain: '' }))).status, 200)
      // 沒有 body、body 是陣列、原型鏈上的 key
      assert.equal((await fetch(`${base}/readings/draw`, { method: 'POST' })).status, 400)
      assert.equal((await fetch(`${base}/readings/draw`, post([]))).status, 400)
      for (const domain of ['__proto__', 'constructor']) {
        assert.equal((await fetch(`${base}/readings/draw`, post({ spreadKey: 'theme-3', domain }))).status, 400, domain)
      }
    },
    () => 0,
  )
})

test('API manual：牌號 1～52 整數、不重複、張數等於牌陣；依牌號重算、不收前端的分析', async () => {
  await withApp(async (base) => {
    const ok = await fetch(`${base}/readings/manual`, post({ spreadKey: 'timeline-3', cards: [17, 7, 31], analysis: { tone: 'fake' }, overview: 'fake' }))
    assert.equal(ok.status, 200)
    const body = await ok.json()
    assert.equal(body.mode, 'manual')
    assert.deepEqual(
      body.cards.map((c) => c.card.id),
      [17, 7, 31],
    )
    assert.notEqual(body.overview, 'fake')
    assert.equal(body.analysis.tone.lean, 'positive')

    const bad = [
      { cards: [1, 2] },
      { cards: [1, 2, 3, 4] },
      { cards: [1, 1, 2] },
      { cards: [0, 1, 2] },
      { cards: [1, 2, 53] },
      { cards: ['1', 2, 3] },
      { cards: [1.5, 2, 3] },
      { cards: 'abc' },
      // 很長的陣列先比張數就擋掉，不會逐一檢查
      { cards: Array.from({ length: 10000 }, (_, i) => i) },
      {},
    ]
    for (const extra of bad) {
      const response = await fetch(`${base}/readings/manual`, post({ spreadKey: 'timeline-3', ...extra }))
      assert.equal(response.status, 400, JSON.stringify(extra))
      assert.ok((await response.json()).message)
    }
    // 大藍圖：36 張、不重複；35 張或有重複都是 400
    const ids36 = Array.from({ length: 36 }, (_, i) => i + 17)
    assert.equal((await fetch(`${base}/readings/manual`, post({ spreadKey: 'grand-tableau', significator: 28, cards: ids36 }))).status, 200)
    assert.equal((await fetch(`${base}/readings/manual`, post({ spreadKey: 'grand-tableau', significator: 28, cards: ids36.slice(1) }))).status, 400)
    assert.equal((await fetch(`${base}/readings/manual`, post({ spreadKey: 'grand-tableau', significator: 28, cards: [...ids36.slice(1), 18] }))).status, 400)
    assert.equal((await fetch(`${base}/readings/manual`, post({ spreadKey: 'grand-tableau', cards: ids36 }))).status, 400)
  })
})
