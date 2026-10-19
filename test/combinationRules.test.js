const test = require('node:test')
const assert = require('node:assert/strict')

const { analyzeCombination } = require('../src/services/combinationRules')
const { formatAnalysis } = require('../src/services/analysisFormatter')
const { buildReading } = require('../src/services/readingService')
const { buildUserMessage } = require('../src/services/narrationService')
const spreads = require('../src/data/spreads')

const major = (number, nameEn, nameZh) => ({ arcanaType: 'major', suit: null, number, nameEn, nameZh })
const minor = (suit, number, nameEn, nameZh) => ({ arcanaType: 'minor', suit, number, nameEn, nameZh })

const FOOL = major(0, 'The Fool', '愚者')
const EMPRESS = major(3, 'The Empress', '皇后')
const EMPEROR = major(4, 'The Emperor', '皇帝')
const STRENGTH = major(8, 'Strength', '力量')
const WANDS_4 = minor('wands', 4, 'Four of Wands', '權杖四')
const WANDS_5 = minor('wands', 5, 'Five of Wands', '權杖五')
const CUPS_4 = minor('cups', 4, 'Four of Cups', '聖杯四')
const CUPS_5 = minor('cups', 5, 'Five of Cups', '聖杯五')
const SWORDS_6 = minor('swords', 6, 'Six of Swords', '寶劍六')
const PENTACLES_2 = minor('pentacles', 2, 'Two of Pentacles', '錢幣二')
const WANDS_KNIGHT = minor('wands', 12, 'Knight of Wands', '權杖騎士')
const CUPS_QUEEN = minor('cups', 13, 'Queen of Cups', '聖杯王后')

const up = (card) => ({ card, orientation: 'upright' })
const rev = (card) => ({ card, orientation: 'reversed' })

test('大牌佔比分三級：日常／偏高／外在主導', () => {
  // v8：門檻從「是否過半」改成「是否高於牌堆本身的 22/78 ≈ 28%」。
  // 4 張裡 2 張大牌 = 50%，已達 40% 的主導門檻
  const half = analyzeCombination({ entries: [up(FOOL), up(EMPRESS), up(WANDS_4), up(CUPS_4)] })
  assert.equal(half.theme.dominance, 'fate')

  const over = analyzeCombination({ entries: [up(FOOL), up(EMPRESS), up(WANDS_4)] })
  assert.equal(over.theme.dominance, 'fate')

  // 5 張裡 0 張大牌 = 0%，低於自然比例
  const none = analyzeCombination({
    entries: [up(WANDS_4), up(CUPS_4), up(SWORDS_6), up(CUPS_5), up(WANDS_5)],
  })
  assert.equal(none.theme.dominance, 'personal')

  // 3 張裡 1 張大牌 = 33%，高於 28% 但未達 40%
  const elevated = analyzeCombination({ entries: [up(FOOL), up(WANDS_4), up(CUPS_4)] })
  assert.equal(elevated.theme.dominance, 'elevated')
})

test('焦點牌取分數最高者，同分取較前面', () => {
  const result = analyzeCombination({ entries: [up(WANDS_4), up(WANDS_KNIGHT), up(EMPRESS), up(FOOL)] })
  assert.equal(result.theme.focusIndex, 2)
})

test('大牌元素：名稱比對，力量用名稱而非編號', () => {
  const result = analyzeCombination({ entries: [up(STRENGTH), up(FOOL), up(EMPRESS)] })
  assert.deepEqual(result.profiles.map((p) => p.element), ['fire', 'air', 'earth'])
})

test('同數字 2 張以上被強調，宮廷牌不算數字', () => {
  const result = analyzeCombination({ entries: [up(WANDS_4), up(CUPS_4), up(WANDS_KNIGHT)] })
  assert.deepEqual(result.theme.emphasizedNumbers, [{ number: 4, count: 2, theme: '穩定' }])
  assert.equal(result.stats.numberCounts[12], undefined)
})

test('同花色 3 張以上主導，缺少的花色都會列出', () => {
  const result = analyzeCombination({ entries: [up(WANDS_4), up(WANDS_5), up(WANDS_KNIGHT)] })
  assert.deepEqual(result.theme.dominantSuits, [{ suit: 'wands', count: 3 }])
  assert.deepEqual(result.theme.missingSuits, ['cups', 'swords', 'pentacles'])
})

test('相鄰配對：友好、同元素、對立、中性加數字遞進', () => {
  const result = analyzeCombination({
    entries: [up(FOOL), up(WANDS_4), up(WANDS_5), up(CUPS_5), up(SWORDS_6), up(PENTACLES_2)],
  })
  assert.deepEqual(
    result.pairs.map((p) => p.relation),
    ['enhance', 'enhance', 'weaken', 'cause', 'weaken'],
  )
  assert.ok(result.pairs[1].tags.includes('sameElement'))
  assert.ok(result.pairs[1].tags.includes('numberProgression'))
})

test('元素增強但其中一張逆位，記為矛盾點', () => {
  const result = analyzeCombination({ entries: [up(WANDS_4), rev(WANDS_5)] })
  assert.deepEqual(result.conflicts, [{ type: 'enhanceWithBlocked', from: 0, to: 1 }])
})

test('焦點牌元素與主導花色對立，記為矛盾點', () => {
  const result = analyzeCombination({ entries: [up(major(18, 'The Moon', '月亮')), up(WANDS_4), up(WANDS_5), up(WANDS_KNIGHT)] })
  assert.ok(result.conflicts.some((c) => c.type === 'focusOpposesDominantSuit' && c.suit === 'wands'))
})

test('宮廷牌：問題涉及他人視為人物，「其他」不算', () => {
  const person = analyzeCombination({ entries: [up(CUPS_QUEEN)], question: '他對我有好感嗎' })
  assert.equal(person.courts[0].role, 'person')

  const trait = analyzeCombination({ entries: [up(CUPS_QUEEN)], question: '要不要換其他工作' })
  assert.equal(trait.courts[0].role, 'trait')
  assert.equal(trait.uncertainties.length, 0)
})

test('宮廷牌搭配空問題，視為性格並列入不確定性', () => {
  const result = analyzeCombination({ entries: [up(WANDS_KNIGHT), up(CUPS_QUEEN)], question: '' })
  assert.deepEqual(result.courts.map((c) => c.role), ['trait', 'trait'])
  assert.deepEqual(result.uncertainties, [{ type: 'courtRoleWithoutQuestion', indexes: [0, 1] }])
})

test('格式化輸出每段都有文字', () => {
  const entries = [up(EMPEROR), rev(WANDS_4), up(CUPS_QUEEN)]
  const analysis = formatAnalysis(analyzeCombination({ entries }), entries)
  assert.match(analysis.theme.text, /焦點牌是皇帝(?!正位)/)
  assert.ok(analysis.pairs.every((p) => p.text))
  assert.ok(analysis.courts.every((c) => c.text))
  assert.ok(analysis.uncertainties.every((u) => u.text))
})

test('buildReading 保留舊欄位並加上 analysis', () => {
  const spread = spreads.find((s) => s.key === 'timeline')
  const reading = buildReading({
    question: '',
    spread,
    cards: [FOOL, WANDS_4, CUPS_4],
    drawOrientation: () => 'upright',
  })
  assert.ok(reading.overview && reading.guidance && reading.cards.length === 3)
  assert.match(reading.analysis.theme.text, /焦點牌是過去的愚者(?!正位)/)
  assert.equal(reading.analysis.pairs.length, 2)
  assert.deepEqual(
    reading.cards.map((entry) => [entry.card.element, entry.card.kind]),
    [['air', 'major'], ['fire', 'pip'], ['water', 'pip']],
  )
})

test('buildReading 依位置套用指定的正逆位', () => {
  const spread = spreads.find((s) => s.key === 'timeline')
  const orientations = ['reversed', 'upright', 'reversed']
  const reading = buildReading({
    question: '',
    spread,
    cards: [FOOL, WANDS_4, CUPS_4],
    drawOrientation: (index) => orientations[index],
  })
  assert.deepEqual(reading.cards.map((entry) => entry.orientation), orientations)
})

test('AI 提示包含問題、牌義與組合分析', () => {
  const spread = spreads.find((s) => s.key === 'timeline')
  const cards = [
    { ...FOOL, keywords: ['開始'], sections: { 正位牌義: ['新的旅程'] } },
    WANDS_4,
    CUPS_4,
  ]
  const reading = buildReading({ question: '工作方向？', spread, cards, drawOrientation: () => 'upright' })
  const message = buildUserMessage({ reading, cards })
  assert.match(message, /<question>\n工作方向？\n<\/question>/)
  assert.match(message, /愚者（The Fool），正位，風元素/)
  assert.match(message, /牌義：新的旅程/)
  assert.ok(message.includes(reading.analysis.theme.text))
  // 牌對只送「比哪兩格」，辭典句子不送，否則 AI 只會改寫它
  assert.ok(reading.analysis.pairs.every((pair) => !message.includes(pair.text)))
  assert.ok(
    reading.analysis.pairs.every((pair) => {
      const name = (index) => reading.cards[index].card.nameZh
      const place = (index) => reading.cards[index].position?.label
      return [name(pair.from), name(pair.to), place(pair.from), place(pair.to)].every((part) =>
        message.includes(part),
      )
    }),
  )
})

test('數字主題：大牌 11～21 各位數相加化簡，愚者為 0，宮廷牌不套用', () => {
  const { getCardProfile } = require('../src/data/cardAttributes')
  const pick = (card) => {
    const p = getCardProfile(card)
    return [p.numerology, p.numberTheme]
  }
  assert.deepEqual(pick(FOOL), [0, '起點、未知'])
  assert.deepEqual(pick(EMPEROR), [4, '穩定'])
  assert.deepEqual(pick(major(13, 'Death', '死神')), [4, '穩定'])
  assert.deepEqual(pick(major(19, 'The Sun', '太陽')), [10, '完成或過載'])
  assert.deepEqual(pick(major(21, 'The World', '世界')), [3, '成長、合作'])
  assert.deepEqual(pick(PENTACLES_2), [2, '抉擇、平衡'])
  assert.deepEqual(pick(WANDS_KNIGHT), [null, null])
})

test('AI 提示包含每張牌的數字與數字序列', () => {
  const spread = spreads.find((s) => s.key === 'timeline')
  const cards = [PENTACLES_2, WANDS_KNIGHT, major(13, 'Death', '死神')]
  const orientations = ['reversed', 'upright', 'upright']
  const reading = buildReading({ question: '', spread, cards, drawOrientation: (i) => orientations[i] })
  const message = buildUserMessage({ reading, cards })
  assert.match(message, /數字：數字 2（抉擇、平衡）/)
  assert.match(message, /數字：宮廷牌（騎士），不套用數字主題/)
  assert.match(message, /數字：大牌編號 13，化簡為 4（穩定）/)
  assert.match(message, /數字序列：錢幣二逆位（2） → 權杖騎士正位（宮廷） → 死神正位（4）/)
})

test('SSE 解析：可處理被切開的資料、略過註解與 [DONE]', () => {
  const { createSseParser } = require('../src/services/narrationService')
  const events = []
  const parse = createSseParser((event) => events.push(event))
  parse(': OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"content":"你好')
  parse('"}}]}\n\ndata: {"choices":[{"delta":{"content":"，世界"},"finish_reason":"stop"}]}\n')
  parse('\ndata: [DONE]\n')
  assert.deepEqual(
    events.map((event) => event.choices[0].delta.content),
    ['你好', '，世界'],
  )
  assert.equal(events[1].choices[0].finish_reason, 'stop')
})

// ---- 第二版：規則 7～10 與規則 4 補充 ----

const SWORDS_7 = minor('swords', 7, 'Seven of Swords', '寶劍七')
const PENTACLES_KING = minor('pentacles', 14, 'King of Pentacles', '錢幣國王')
const TOWER = major(16, 'The Tower', '塔')
const keysOf = (key) => spreads.find((s) => s.key === key).positions.map((p) => p.key)

test('規則 7：問題領域對照的四種結果', () => {
  const aligned = analyzeCombination({ entries: [up(CUPS_4), up(CUPS_5), up(WANDS_4)], question: '我們的感情會怎樣' })
  assert.equal(aligned.question.alignment, 'aligned')
  assert.deepEqual(aligned.question.evidence, [0, 1])

  const partial = analyzeCombination({ entries: [up(CUPS_4), up(CUPS_5), up(PENTACLES_2)], question: '這個月能加薪嗎' })
  assert.equal(partial.question.alignment, 'partial')

  const mismatch = analyzeCombination({ entries: [up(CUPS_4), up(CUPS_5), up(SWORDS_6)], question: '這個月能加薪嗎' })
  assert.equal(mismatch.question.alignment, 'mismatch')
  assert.deepEqual(mismatch.question.topSuits, ['cups'])

  const noMinor = analyzeCombination({ entries: [up(FOOL), up(EMPRESS)], question: '要不要轉職' })
  assert.equal(noMinor.question.alignment, 'noMinor')

  // 對應花色與其他花色並列最多時只算「部分回應」，不算對焦
  const tied = analyzeCombination({
    entries: [up(CUPS_4), up(PENTACLES_2), up(SWORDS_6)],
    question: '我們的感情會怎樣',
  })
  assert.equal(tied.question.alignment, 'partial')
  assert.deepEqual(tied.question.topSuits, ['cups', 'pentacles', 'swords'])

  assert.equal(analyzeCombination({ entries: [up(CUPS_4)], question: '' }).question, null)
})

test('規則 7：命中多個領域時合併對應花色', () => {
  const result = analyzeCombination({ entries: [up(CUPS_4), up(WANDS_4)], question: '我和主管的相處' })
  assert.deepEqual(result.question.domains, ['work', 'social'])
  assert.deepEqual(result.question.expectedSuits, ['wands', 'pentacles', 'cups'])
  assert.equal(result.question.alignment, 'aligned')
})

test('規則 8：時間之流的正逆位走勢與起點結果', () => {
  const positionKeys = keysOf('timeline')
  const run = (entries) => analyzeCombination({ entries, positionKeys }).positions
  const trend = (entries) => run(entries).find((f) => f.type === 'orientationTrend').value

  assert.equal(trend([up(CUPS_4), up(CUPS_5), up(SWORDS_6)]), 'smooth')
  assert.equal(trend([rev(CUPS_4), rev(CUPS_5), rev(SWORDS_6)]), 'stuck')
  assert.equal(trend([up(CUPS_4), rev(CUPS_5), up(SWORDS_6)]), 'unblock')
  assert.equal(trend([rev(CUPS_4), up(CUPS_5), rev(SWORDS_6)]), 'blockAhead')
  assert.equal(trend([rev(CUPS_4), rev(CUPS_5), up(SWORDS_6)]), 'unblock')

  // 起點與結果的配對判定已移交關係對系統，規則 8 不再輸出 endpoints
  assert.equal(run([up(WANDS_4), up(CUPS_4), up(FOOL)]).some((f) => f.type === 'endpoints'), false)
})

test('規則 8：直指核心只留單一位置判定，配對型已移交', () => {
  const positionKeys = keysOf('core')
  const result = analyzeCombination({ entries: [up(TOWER), up(WANDS_4), up(CUPS_4), rev(PENTACLES_2)], positionKeys })
  assert.deepEqual(result.positions.map((f) => f.type), ['resourceBlocked', 'coreMajor'])
  // 障礙×對策改由關係對處理，不應再出現在 positions
  assert.equal(result.positions.some((f) => f.type === 'adviceVsChallenge'), false)
})

test('規則 8：指引之星的助力、負面影響與問題終局', () => {
  const positionKeys = keysOf('guiding-star')
  // question, past, negative, present, positive, future, outcome
  const entries = [up(WANDS_4), up(CUPS_4), rev(WANDS_5), up(SWORDS_6), rev(CUPS_5), up(PENTACLES_2), up(FOOL)]
  const result = analyzeCombination({ entries, positionKeys })
  const byType = Object.fromEntries(result.positions.map((f) => [f.type, f]))
  assert.equal(byType.orientationTrend.value, 'smooth')
  assert.ok(byType.supportBlocked && byType.negativeEasing)
  // 問題×終局、負面×正面都已移交關係對
  assert.equal(byType.endpoints, undefined)
  assert.equal(byType.supportVsNegative, undefined)
})

test('規則 8：沒有位置資訊時不判定', () => {
  assert.deepEqual(analyzeCombination({ entries: [up(CUPS_4), up(CUPS_5), up(SWORDS_6)] }).positions, [])
})

test('規則 9：數字階段的主要階段與走向', () => {
  // 2 起步、7 考驗、9 考驗。大牌不計入數字階段（v8），所以一律用小牌
  const forward = analyzeCombination({ entries: [up(PENTACLES_2), up(SWORDS_7), up(PENTACLES_9)] }).numberStage
  assert.deepEqual(forward.stages, { start: 1, trial: 2 })
  assert.equal(forward.dominant, 'trial')
  assert.equal(forward.trend, 'forward')

  const tie = analyzeCombination({ entries: [up(SWORDS_7), up(PENTACLES_2)] }).numberStage
  assert.equal(tie.dominant, null)
  assert.equal(tie.trend, 'backward')

  const single = analyzeCombination({ entries: [up(CUPS_4), up(WANDS_KNIGHT)] }).numberStage
  assert.equal(single.trend, null)
  assert.equal(analyzeCombination({ entries: [up(WANDS_KNIGHT)] }).numberStage, null)
})

test('規則 10：議題份量門檻 2.2／1.6 的邊界', () => {
  const intensity = (entries) => analyzeCombination({ entries }).weights.intensity
  // (3+3+2+2+1) / 5 = 2.2
  assert.equal(intensity([up(FOOL), up(EMPRESS), up(WANDS_KNIGHT), up(CUPS_QUEEN), up(CUPS_4)]), 'major')
  // (3+1+1+1+2) / 5 = 1.6
  assert.equal(intensity([up(FOOL), up(CUPS_4), up(CUPS_5), up(WANDS_4), up(WANDS_KNIGHT)]), 'medium')
  // (2+1+1+1+1) / 5 = 1.2
  assert.equal(intensity([up(WANDS_KNIGHT), up(CUPS_4), up(CUPS_5), up(WANDS_4), up(WANDS_5)]), 'daily')
})

test('規則 10：阻力份量門檻 0.5／0.3 的邊界', () => {
  const weightsOf = (entries) => analyzeCombination({ entries }).weights
  // 逆位 3 ÷ 總 6 = 0.5
  const high = weightsOf([rev(FOOL), up(WANDS_KNIGHT), up(CUPS_4)])
  assert.equal(high.reversedWeightRatio, 0.5)
  assert.equal(high.resistance, 'high')
  // 逆位 3 ÷ 總 10 = 0.3
  assert.equal(weightsOf([rev(FOOL), up(EMPRESS), up(WANDS_KNIGHT), up(CUPS_QUEEN)]).resistance, 'some')
  assert.equal(weightsOf([up(FOOL), rev(CUPS_4), up(WANDS_KNIGHT)]).resistance, 'low')
})

test('規則 10：加權元素差 1 分才成立，與依張數的主導元素不同時標記', () => {
  // 張數：水 2、火 1 → 主導水；權重：火（皇帝）3、水 2 → 差 1，加權主導火
  const shifted = analyzeCombination({ entries: [up(EMPEROR), up(CUPS_4), up(CUPS_5)] }).weights
  assert.equal(shifted.weightedDominant, 'fire')
  assert.equal(shifted.majorShiftsElement, true)

  // 權重：火 2（權杖騎士）、水 2 → 差 0，不成立
  const even = analyzeCombination({ entries: [up(WANDS_KNIGHT), up(CUPS_4), up(CUPS_5)] }).weights
  assert.equal(even.weightedDominant, null)
  assert.equal(even.majorShiftsElement, false)
})

test('規則 10：份量走向只在有時間順序的牌陣判斷', () => {
  const timeline = keysOf('timeline')
  const trendOf = (entries, positionKeys) => analyzeCombination({ entries, positionKeys }).weights.trend
  assert.equal(trendOf([up(CUPS_4), up(CUPS_5), up(TOWER)], timeline), 'rising')
  assert.equal(trendOf([up(TOWER), up(CUPS_5), up(CUPS_4)], timeline), 'falling')
  assert.equal(trendOf([up(CUPS_4), up(CUPS_5), up(TOWER), up(SWORDS_6)], keysOf('core')), null)
})

test('規則 4 補充：中性配對附加線索並寫入文字', () => {
  // 皇帝（火）→ 錢幣二（土）：中性；大轉小、正轉逆、數字 4 → 2 往下
  const entries = [up(EMPEROR), rev(PENTACLES_2)]
  const result = analyzeCombination({ entries })
  assert.equal(result.pairs[0].relation, 'neutral')
  assert.ok(['blocked', 'majorToMinor', 'numberDown'].every((tag) => result.pairs[0].tags.includes(tag)))

  const text = formatAnalysis(result, entries).pairs[0].text
  assert.match(text, /從外顯換成往內走/)
  assert.match(text, /大方向落到日常執行/)
  assert.doesNotMatch(text, /沒有明顯的互相影響/)
})

test('手動選牌驗證：張數、重複、格式、合法', () => {
  const { validateManualCards } = require('../src/services/manualDraw')
  const oid = () => new (require('mongoose').Types.ObjectId)().toString()
  const a = oid()
  const b = oid()

  assert.match(validateManualCards([]).error, /1 到 10/)
  assert.match(
    validateManualCards(Array.from({ length: 11 }, () => ({ id: oid(), orientation: 'upright' }))).error,
    /1 到 10/,
  )
  assert.match(validateManualCards([{ id: 'xxx', orientation: 'upright' }]).error, /格式不正確/)
  assert.match(validateManualCards([{ id: a, orientation: 'sideways' }]).error, /格式不正確/)
  assert.match(
    validateManualCards([{ id: a, orientation: 'upright' }, { id: a, orientation: 'reversed' }]).error,
    /不可重複/,
  )
  const ok = validateManualCards([{ id: a, orientation: 'upright' }, { id: b, orientation: 'reversed' }])
  assert.equal(ok.error, undefined)
  assert.equal(ok.drawn.length, 2)
})

test('全牌清單排序：大牌在前依編號，小牌依花色再依編號', () => {
  const { compareCards } = require('../src/services/manualDraw')
  const cards = [
    { arcanaType: 'minor', suit: 'pentacles', number: 1 },
    { arcanaType: 'major', suit: null, number: 5 },
    { arcanaType: 'minor', suit: 'wands', number: 3 },
    { arcanaType: 'major', suit: null, number: 0 },
    { arcanaType: 'minor', suit: 'wands', number: 1 },
  ]
  const sorted = [...cards].sort(compareCards)
  assert.deepEqual(
    sorted.map((c) => `${c.arcanaType}-${c.suit ?? ''}-${c.number}`),
    ['major--0', 'major--5', 'minor-wands-1', 'minor-wands-3', 'minor-pentacles-1'],
  )
})

test('buildReading 無牌陣（手動選牌）：用第 N 張、無位置解讀、其餘分析照常', () => {
  const reading = buildReading({
    question: '要不要換工作',
    cards: [EMPEROR, CUPS_4, PENTACLES_2],
    drawOrientation: (i) => (i === 1 ? 'reversed' : 'upright'),
  })
  assert.equal(reading.spread.key, 'manual')
  assert.equal(reading.spread.cardCount, 3)
  assert.match(reading.overview, /第 1 張：皇帝正位/)
  assert.match(reading.overview, /第 2 張：聖杯四逆位/)
  // 無牌陣 → 位置解讀為空，其餘分析仍產生
  assert.deepEqual(reading.analysis.positions, [])
  assert.ok(reading.analysis.weights.text && reading.analysis.numberStage.text)
  assert.ok(reading.analysis.question.text)
  // image 欄位一律帶出（無圖時為空字串）
  assert.deepEqual(reading.cards.map((e) => e.card.image), ['', '', ''])
})

test('手動選牌也能組出 AI 提示（position 為 null 不會壞）', () => {
  const cards = [
    { ...EMPEROR, keywords: ['掌控'], sections: { 正位牌義: ['建立秩序'] } },
    CUPS_4,
    PENTACLES_2,
  ]
  const reading = buildReading({
    question: '要不要換工作',
    cards,
    drawOrientation: (i) => (i === 1 ? 'reversed' : 'upright'),
  })
  const message = buildUserMessage({ reading, cards })
  // 無牌陣時只標第幾張，不帶位置名稱
  assert.match(message, /第 1 張\n牌：皇帝（The Emperor），正位/)
  assert.doesNotMatch(message, /第 1 張｜/)
  assert.ok(message.includes(reading.analysis.theme.text))
})

test('牌義解析：兩種資料格式都能分組，小標題不會被當成內文', () => {
  const { parseMeaningGroups, getCoreMessage } = require('../src/services/meaningSections')

  // 格式一：小標題自成一行，內容可多行
  const a = parseMeaningGroups(['核心訊息', '過去努力已開花結果。', '行動建議', '允許自己享受成果。', '繼續自律。'])
  assert.deepEqual(a, [
    { heading: '核心訊息', lines: ['過去努力已開花結果。'] },
    { heading: '行動建議', lines: ['允許自己享受成果。', '繼續自律。'] },
  ])
  assert.equal(getCoreMessage(a), '過去努力已開花結果。')

  // 格式二：小標題：內容（全形冒號）同一行
  const b = parseMeaningGroups(['核心訊息：現在需要架構與決斷。', '心理層面：你更知道自己要什麼。'])
  assert.deepEqual(b, [
    { heading: '核心訊息', lines: ['現在需要架構與決斷。'] },
    { heading: '心理層面', lines: ['你更知道自己要什麼。'] },
  ])

  // 逆位用核心警示當開場；空白行略過；沒有分組時回傳空陣列
  assert.equal(getCoreMessage(parseMeaningGroups(['核心警示', '你可能被綁住了。'])), '你可能被綁住了。')
  assert.deepEqual(parseMeaningGroups(['', '  ', null]), [])
})

test('buildReading 的 meaning 與 highlights 不含落單小標題', () => {
  const card = {
    ...EMPEROR,
    sections: { 正位牌義: ['核心訊息', '建立秩序。', '心理層面', '你知道要什麼。', '行動建議', '拆成步驟。'] },
  }
  const reading = buildReading({ question: '', cards: [card], drawOrientation: () => 'upright' })
  const entry = reading.cards[0]

  assert.deepEqual(entry.meaning.map((g) => g.heading), ['核心訊息', '心理層面', '行動建議'])
  // 開場用核心訊息的內容，不是小標題
  assert.match(entry.interpretation, /皇帝正位，建立秩序。$/)
  assert.doesNotMatch(entry.interpretation, /核心訊息/)
  // highlights 只有內容行
  assert.deepEqual(entry.highlights, ['建立秩序。', '你知道要什麼。', '拆成步驟。'])
})

// ---- 規則 11：量化指標 ----

test('規則 11：值域由建構保證，隨機牌組不需夾擠', () => {
  const { SELECTABLE_DOMAINS } = require('../src/data/ruleConfig')
  const pool = [FOOL, EMPRESS, EMPEROR, STRENGTH, TOWER, WANDS_4, WANDS_5, CUPS_4, CUPS_5, SWORDS_6, SWORDS_7, PENTACLES_2, WANDS_KNIGHT, CUPS_QUEEN, PENTACLES_KING]
  let seed = 42
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

  for (let round = 0; round < 1000; round++) {
    const n = 1 + Math.floor(rand() * 7)
    const entries = Array.from({ length: n }, () => {
      const card = pool[Math.floor(rand() * pool.length)]
      return rand() > 0.5 ? up(card) : rev(card)
    })
    const domain = SELECTABLE_DOMAINS[Math.floor(rand() * SELECTABLE_DOMAINS.length)]
    const { quant } = analyzeCombination({ entries, domain })

    assert.ok(quant.di >= -100 && quant.di <= 100, `DI 超出值域: ${quant.di}`)
    assert.ok(quant.confidence >= 0 && quant.confidence <= 1, `confidence 超出值域: ${quant.confidence}`)
    assert.ok(quant.momentum >= 0 && quant.momentum <= 1)
    assert.ok(quant.resistance >= 0 && quant.resistance <= 1)
    Object.values(quant.energy).forEach((v) => assert.ok(v >= 0 && v <= 1, `energy 超出值域: ${v}`))
  }
})

test('規則 11：逆位衰減不翻轉正負（守住規則 6）', () => {
  const run = (entry) => analyzeCombination({ entries: [entry], domain: 'general' }).quant
  for (const card of [EMPEROR, TOWER, CUPS_4, SWORDS_7]) {
    const upright = run(up(card))
    const reversed = run(rev(card))
    if (upright.di === 0) continue
    assert.ok(Math.sign(upright.di) === Math.sign(reversed.di), `${card.nameZh} 逆位翻轉了正負號`)
    assert.ok(Math.abs(reversed.di) < Math.abs(upright.di), `${card.nameZh} 逆位沒有衰減`)
  }
})

test('規則 11：大牌權重佔 3/5，貢獻佔比反映權重', () => {
  // 1 張大牌（權重 3）+ 2 張數字牌（權重 1）→ 大牌佔 3/5
  const { quant } = analyzeCombination({ entries: [up(EMPEROR), up(WANDS_4), up(WANDS_5)], domain: 'general' })
  const major = quant.contributions.find((c) => c.index === 0)
  assert.equal(major.weight, 0.6)
})

test('規則 11：領域投影有鑑別度，全錢幣在財務領域高於感情領域', () => {
  const entries = [up(PENTACLES_2), up(PENTACLES_KING), up(minor('pentacles', 9, 'Nine of Pentacles', '錢幣九'))]
  const money = analyzeCombination({ entries, domain: 'money' }).quant
  const love = analyzeCombination({ entries, domain: 'love' }).quant
  assert.ok(money.di > love.di, `財務 ${money.di} 應高於感情 ${love.di}`)
  assert.ok(money.energy.material > money.energy.emotion)
})

test('規則 11：領域優先序為 使用者指定 → 關鍵詞 → 均等', () => {
  const entries = [up(CUPS_4), up(CUPS_5)]
  const byUser = analyzeCombination({ entries, question: '我的感情', domain: 'money' }).quant
  assert.equal(byUser.domain, 'money')
  assert.equal(byUser.domainResolvedFrom, 'user')

  const byKeyword = analyzeCombination({ entries, question: '我的感情會怎樣' }).quant
  assert.equal(byKeyword.domain, 'love')
  assert.equal(byKeyword.domainResolvedFrom, 'keyword')

  const fallback = analyzeCombination({ entries, question: '' }).quant
  assert.equal(fallback.domain, 'general')
  assert.equal(fallback.domainResolvedFrom, 'none')
  assert.deepEqual(fallback.domainWeights, { action: 0.25, emotion: 0.25, logic: 0.25, material: 0.25 })
})

test('v9：規則 11 的阻力改看極性，與規則 10 的 reversedWeightRatio 刻意分家', () => {
  const entries = [rev(EMPEROR), up(WANDS_KNIGHT), up(CUPS_4)]
  const { quant, weights } = analyzeCombination({ entries, domain: 'general' })

  // 規則 10 仍是單純的逆位權重比，規則 11 改成「牌義拖累 + 逆位沒使出來」。
  // 兩者不再相等是刻意的；規則 10 的阻力沒有顯示在畫面上，不會讓使用者看到兩個數字。
  const parts = quant.resistanceFromMeaning + quant.resistanceFromReversal
  assert.ok(Math.abs(quant.resistance - parts) < 0.02, `阻力應等於兩個來源之和，${quant.resistance} vs ${parts}`)
  assert.ok(typeof weights.reversedWeightRatio === 'number', '規則 10 的欄位保留供相容')
})

test('v9 P1：動能與阻力要看牌本身好壞，不是只看正逆位', () => {
  const S3 = minor('swords', 3, 'Three of Swords', '寶劍三')
  const S9 = minor('swords', 9, 'Nine of Swords', '寶劍九')
  const S10 = minor('swords', 10, 'Ten of Swords', '寶劍十')
  const C9 = minor('cups', 9, 'Nine of Cups', '聖杯九')
  const C10 = minor('cups', 10, 'Ten of Cups', '聖杯十')

  // 全正位的負面牌：舊算法會給 momentum 高、resistance 0
  const bad = analyzeCombination({ entries: [up(S3), up(S9), up(S10)] }).quant
  assert.equal(bad.momentum, 0, '全是負面牌不該有動能')
  assert.ok(bad.resistance > 0.5, `負面牌應產生阻力，實際 ${bad.resistance}`)
  assert.ok(bad.resistanceFromMeaning > bad.resistanceFromReversal, '阻力應來自牌義而非逆位')

  // 全逆位的正面牌：舊算法會給 momentum 0
  const good = analyzeCombination({ entries: [rev(C9), rev(C10)] }).quant
  assert.ok(good.momentum > 0, '逆位只是打折，不該把動能歸零')
  assert.ok(good.resistanceFromReversal > 0, '逆位沒使出來的部分要算進阻力')
})

test('規則 11：位置權重生效，未來比過去更影響指向', () => {
  const keys = keysOf('timeline')
  const weightsOf = (k) => spreads.find((s) => s.key === k).positions.map((p) => p.weight)
  const futureGood = analyzeCombination({
    entries: [up(TOWER), up(WANDS_4), up(EMPRESS)],
    positionKeys: keys,
    positionWeights: weightsOf('timeline'),
    domain: 'general',
  }).quant
  const pastGood = analyzeCombination({
    entries: [up(EMPRESS), up(WANDS_4), up(TOWER)],
    positionKeys: keys,
    positionWeights: weightsOf('timeline'),
    domain: 'general',
  }).quant
  // 好牌在未來（權重 0.45）應比好牌在過去（0.2）得到更高的指向分數
  assert.ok(futureGood.di > pastGood.di, `${futureGood.di} 應大於 ${pastGood.di}`)
})

test('規則 11：邊界情況不壞（單張、全大牌、空牌組）', () => {
  assert.ok(analyzeCombination({ entries: [up(FOOL)], domain: 'general' }).quant.di !== undefined)
  const allMajor = analyzeCombination({ entries: [up(FOOL), up(TOWER), up(EMPRESS)], domain: 'work' }).quant
  assert.ok(allMajor.di >= -100 && allMajor.di <= 100)
  // 空牌組是前置條件錯誤（API 層已擋 1～10 張），應丟出明確訊息而非 TypeError
  assert.throws(() => analyzeCombination({ entries: [], domain: 'general' }), /至少一張牌/)
})

test('規則 11：22 張大牌都有極性，沒有落在預設 0', () => {
  const { getCardVector } = require('../src/data/cardDimensions')
  const { getCardProfile } = require('../src/data/cardAttributes')
  const majors = [
    [0, 'The Fool', '愚者'], [1, 'The Magician', '魔術師'], [2, 'The High Priestess', '女祭司'],
    [3, 'The Empress', '皇后'], [4, 'The Emperor', '皇帝'], [5, 'The Hierophant', '教皇'],
    [6, 'The Lovers', '戀人'], [7, 'The Chariot', '戰車'], [8, 'Strength', '力量'],
    [9, 'The Hermit', '隱士'], [10, 'Wheel of Fortune', '命運之輪'], [11, 'Justice', '正義'],
    [12, 'The Hanged Man', '吊人'], [13, 'Death', '死神'], [14, 'Temperance', '節制'],
    [15, 'The Devil', '惡魔'], [16, 'The Tower', '塔'], [17, 'The Star', '星星'],
    [18, 'The Moon', '月亮'], [19, 'The Sun', '太陽'], [20, 'Judgement', '審判'], [21, 'The World', '世界'],
  ]
  for (const [n, en, zh] of majors) {
    const card = major(n, en, zh)
    const vector = getCardVector(card, getCardProfile(card))
    assert.ok(vector.polarityKnown, `${zh} 找不到極性`)
    assert.ok(vector.polarity >= -1 && vector.polarity <= 1)
  }
})

// ---- 牌對組合辭典 ----

test('辭典：人工精選 33 組、132 筆，key 不重複', () => {
  const { CURATED_PAIRS } = require('../src/data/curatedPairs')
  assert.equal(CURATED_PAIRS.length, 132)
  assert.equal(new Set(CURATED_PAIRS.map((e) => e.key)).size, 132)
  // 每組都要有四種正逆位
  const combos = new Set(CURATED_PAIRS.map((e) => `${e.fromName}+${e.toName}`))
  assert.equal(combos.size, 33)
  assert.ok(CURATED_PAIRS.every((e) => e.text && e.domain === 'any'))
})

test('辭典：查到就用辭典文字，查不到退回規則運算', () => {
  const cards = [
    { ...EMPEROR, slug: 'major-4-the-emperor' },
    { ...CUPS_4, slug: 'minor-4-four-of-cups' },
  ]
  const key = 'major-4-the-emperor|upright>minor-4-four-of-cups|upright'

  const withDict = buildReading({
    question: '',
    cards,
    drawOrientation: () => 'upright',
    pairTexts: new Map([[key, { text: '辭典版本的說法。', source: 'curated' }]]),
  })
  assert.equal(withDict.analysis.pairs[0].text, '辭典版本的說法。')
  assert.equal(withDict.analysis.pairs[0].textSource, 'curated')

  // 沒有辭典時行為與現況相同
  const withoutDict = buildReading({ question: '', cards, drawOrientation: () => 'upright' })
  assert.equal(withoutDict.analysis.pairs[0].textSource, 'rule')
  assert.match(withoutDict.analysis.pairs[0].text, /皇帝/)
})

test('辭典：key 含方向與正逆位，四者不同才算同一筆', () => {
  const { pairKey } = require('../src/services/pairDictionary')
  const a = pairKey('major-16-the-tower', 'upright', 'major-13-death', 'upright')
  assert.equal(a, 'major-16-the-tower|upright>major-13-death|upright')
  // 換方向、換正逆位都是不同的 key
  assert.notEqual(a, pairKey('major-13-death', 'upright', 'major-16-the-tower', 'upright'))
  assert.notEqual(a, pairKey('major-16-the-tower', 'reversed', 'major-13-death', 'upright'))
})

// ---- 牌陣關係對（v6）----

test('關係對：沒有宣告 relations 時退回相鄰配對', () => {
  const { resolveRelationPairs } = require('../src/services/rules/relationPairs')
  assert.deepEqual(resolveRelationPairs(3, null), [
    { from: 0, to: 1, kind: 'sequence' },
    { from: 1, to: 2, kind: 'sequence' },
  ])
  assert.deepEqual(resolveRelationPairs(1, null), [])
  // 索引超出範圍或自己配自己的會被濾掉
  assert.deepEqual(
    resolveRelationPairs(2, [{ from: 0, to: 5 }, { from: 1, to: 1 }, { from: 0, to: 1, kind: 'crossing' }]),
    [{ from: 0, to: 1, kind: 'crossing' }],
  )
})

test('關係對：四個牌陣的權重總和為 1、版面座標不重疊、關係索引有效', () => {
  for (const spread of spreads) {
    const sum = spread.positions.reduce((acc, p) => acc + p.weight, 0)
    assert.ok(Math.abs(sum - 1) < 1e-9, `${spread.name} 權重總和為 ${sum}`)
    assert.equal(spread.positions.length, spread.cardCount, `${spread.name} 位置數不符`)

    const cells = new Set()
    for (const position of spread.positions) {
      const { col, row, overlay } = position.layout
      assert.ok(col >= 1 && col <= spread.grid.cols, `${spread.name}/${position.label} col 超出網格`)
      assert.ok(row >= 1 && row <= spread.grid.rows, `${spread.name}/${position.label} row 超出網格`)
      const cell = `${col},${row}`
      if (!overlay) {
        assert.ok(!cells.has(cell), `${spread.name}/${position.label} 與其他位置重疊`)
      }
      cells.add(cell)
    }

    for (const relation of spread.relations || []) {
      assert.ok(relation.from < spread.cardCount && relation.to < spread.cardCount, `${spread.name} 關係索引超出`)
      assert.notEqual(relation.from, relation.to)
    }
  }
})

test('關係對：塞爾特十字有 6 組，3 組索引不相鄰、5 組語意非順承', () => {
  const celtic = spreads.find((s) => s.key === 'celtic-cross')
  assert.equal(celtic.cardCount, 10)
  assert.equal(celtic.relations.length, 6)

  // 索引不相鄰：根基×意識、過去×近未來、現況×結果
  const nonAdjacent = celtic.relations.filter((r) => Math.abs(r.from - r.to) !== 1)
  assert.equal(nonAdjacent.length, 3)

  // 更重要的是：只有一組是單純的順承，其餘都是相鄰模型表達不出來的語意
  const nonSequence = celtic.relations.filter((r) => r.kind !== 'sequence')
  assert.equal(nonSequence.length, 5)

  assert.deepEqual(celtic.relations[0], { from: 0, to: 1, kind: 'crossing' })
})

test('關係對：配對依牌陣宣告產生，且帶上 kind', () => {
  const celtic = spreads.find((s) => s.key === 'celtic-cross')
  const entries = Array.from({ length: 10 }, (_, i) => up(i % 2 ? CUPS_4 : WANDS_4))
  const result = analyzeCombination({ entries, relations: celtic.relations })
  assert.equal(result.pairs.length, 6)
  assert.deepEqual(result.pairs.map((p) => p.kind), ['crossing', 'depth', 'sequence', 'contrast', 'projection', 'arc'])
  // 第 5 組是 (8,9)，確認不是相鄰流水號產生的
  assert.deepEqual([result.pairs[4].from, result.pairs[4].to], [8, 9])
})

test('關係對：kind 會改變文字開頭', () => {
  const entries = [up(TOWER), up(CUPS_4)]
  const asSequence = formatAnalysis(analyzeCombination({ entries }), entries).pairs[0].text
  const asCrossing = formatAnalysis(
    analyzeCombination({ entries, relations: [{ from: 0, to: 1, kind: 'crossing' }] }),
    entries,
  ).pairs[0].text
  assert.match(asSequence, /走到/)
  assert.match(asCrossing, /擋在/)
  assert.notEqual(asSequence, asCrossing)
})

test('第二版各區塊都有文字', () => {
  const spread = spreads.find((s) => s.key === 'core')
  const reading = buildReading({
    question: '要不要換工作',
    spread,
    cards: [TOWER, WANDS_4, CUPS_4, PENTACLES_KING],
    drawOrientation: (i) => (i === 3 ? 'reversed' : 'upright'),
  })
  const { analysis } = reading
  assert.ok(analysis.question.text && analysis.numberStage.text && analysis.weights.text)
  assert.ok(analysis.positions.length > 0 && analysis.positions.every((f) => f.text))
  assert.equal(analysis.weights.intensityLabel, '需要認真看待')
})

// ---- v7：敘述品質（需求 3～7）----

const CUPS_3 = minor('cups', 3, 'Three of Cups', '聖杯三')
// v8：大牌與宮廷牌退出數字階段後，階段測試一律改用小牌
const PENTACLES_9 = minor('pentacles', 9, 'Nine of Pentacles', '錢幣九')
const labelled = (entry, label) => ({ ...entry, label, hasPosition: true })

test('v7 需求 3：正逆各半時不可說「佔了不少」', () => {
  // 兩張高正極性的大牌逆位、兩張小牌正位：張數各半，阻力主要來自「逆位沒使出來」
  const SUN = major(19, 'The Sun', '太陽')
  const entries = [
    labelled(rev(SUN), '過去'),
    labelled(rev(EMPRESS), '現在'),
    labelled(up(WANDS_4), '未來'),
    labelled(up(CUPS_4), '終局'),
  ]
  const text = formatAnalysis(analyzeCombination({ entries }), entries).quant.text

  assert.ok(!text.includes('佔了不少'), '張數各半卻說「佔了不少」會與畫面矛盾')
  assert.match(text, /正逆各半/)
})

test('v9：阻力來自牌義時不得拿張數說話', () => {
  // 全正位的負面牌：一張逆位都沒有，不能說「逆位的牌…」
  const S3 = minor('swords', 3, 'Three of Swords', '寶劍三')
  const S9 = minor('swords', 9, 'Nine of Swords', '寶劍九')
  const entries = [labelled(up(S3), '過去'), labelled(up(S9), '現在'), labelled(up(WANDS_4), '未來')]
  const text = formatAnalysis(analyzeCombination({ entries }), entries).quant.text

  assert.match(text, /卡住的不是逆位/)
  assert.ok(!/逆位的牌/.test(text), `沒有逆位牌卻提到「逆位的牌」：${text}`)
})

test('v7 需求 3：正位的牌在拖要註明來自牌義', () => {
  const upright = [labelled(up(TOWER), '過去'), labelled(up(WANDS_4), '現在')]
  assert.match(formatAnalysis(analyzeCombination({ entries: upright }), upright).quant.text, /牌義本身就偏滯/)

  // 逆位本身已經解釋了原因，不必補註
  const reversed = [labelled(rev(TOWER), '過去'), labelled(up(WANDS_4), '現在')]
  assert.ok(!formatAnalysis(analyzeCombination({ entries: reversed }), reversed).quant.text.includes('牌義本身就偏滯'))
})

test('v7 需求 4：sequence 依牌陣順序，略過沒有數字的牌', () => {
  const entries = [up(PENTACLES_2), up(PENTACLES_KING), up(SWORDS_7)]
  const stage = analyzeCombination({ entries }).numberStage

  assert.deepEqual(stage.sequence.map((step) => step.index), [0, 2])
  assert.deepEqual(stage.sequence.map((step) => step.number), [2, 7])
  assert.deepEqual(stage.skipped, [1])
})

test('v7 需求 4：六種走向形狀', () => {
  const shapeOf = (cards) => analyzeCombination({ entries: cards.map(up) }).numberStage.shape

  assert.equal(shapeOf([PENTACLES_2, CUPS_3]), 'flat')
  assert.equal(shapeOf([PENTACLES_2, SWORDS_7]), 'rising')
  assert.equal(shapeOf([SWORDS_7, PENTACLES_2]), 'falling')
  assert.equal(shapeOf([PENTACLES_2, SWORDS_7, CUPS_5]), 'peak')
  assert.equal(shapeOf([SWORDS_7, PENTACLES_2, PENTACLES_9]), 'dip')
  assert.equal(shapeOf([PENTACLES_2, SWORDS_7, CUPS_5, PENTACLES_9]), 'zigzag')
  // 全是宮廷牌時維持原本的 null
  assert.equal(analyzeCombination({ entries: [up(WANDS_KNIGHT)] }).numberStage, null)
})

test('v7 需求 4：數字階段不再輸出分布與主軸', () => {
  const entries = [labelled(up(PENTACLES_2), '過去'), labelled(up(SWORDS_7), '現在'), labelled(up(CUPS_5), '未來')]
  const text = formatAnalysis(analyzeCombination({ entries }), entries).numberStage.text

  assert.ok(!text.includes('分布在'), '分布句已廢除')
  assert.ok(!text.includes('為主'), '主軸句已廢除')
  assert.match(text, /依牌陣順序/)
  assert.match(text, /過去 錢幣二（2．抉擇、平衡）/)
})

test('v7 需求 5：宮廷牌一律說明影響力', () => {
  const entries = [labelled(up(PENTACLES_KING), '過去'), labelled(up(WANDS_4), '現在')]
  const analysis = formatAnalysis(analyzeCombination({ entries }), entries)

  assert.match(analysis.courts[0].text, /國王是宮廷裡份量最重的階級/)
  // v8：不再輸出百分比，改成主導／次要／輔助三級的說法
  assert.match(analysis.courts[0].text, /說話最大聲|也有一定的份量|只是輔助的角色/)
  assert.ok(!/\d+ ?%/.test(analysis.courts[0].text), '不該再出現百分比')
  // 只有一張時不再多一句廢話
  assert.equal(analysis.courtSummary, '')
})

test('v7 需求 5：沒有宮廷牌也要有一句', () => {
  const entries = [labelled(up(WANDS_4), '過去'), labelled(up(CUPS_4), '現在')]
  const analysis = formatAnalysis(analyzeCombination({ entries }), entries)

  assert.equal(analysis.courts.length, 0)
  assert.match(analysis.courtSummary, /沒有宮廷牌/)
})

test('v7 需求 6：矛盾要點名位置、不用術語', () => {
  const entries = [labelled(up(WANDS_4), '問題核心'), labelled(rev(WANDS_5), '障礙')]
  const conflicts = formatAnalysis(analyzeCombination({ entries }), entries).conflicts
  const blocked = conflicts.find((item) => item.type === 'enhanceWithBlocked')

  assert.ok(blocked, '同花色一正一逆應判定為 enhanceWithBlocked')
  assert.ok(!blocked.text.includes('元素互相增強'), '術語原句應已改寫')
  assert.ok(blocked.text.includes('問題核心') && blocked.text.includes('障礙'), '要點名是哪兩個位置')
})

test('v7 需求 6：不明朗維持原本說法', () => {
  const entries = [labelled(up(PENTACLES_KING), '過去'), labelled(up(WANDS_4), '現在')]
  const uncertainties = formatAnalysis(analyzeCombination({ entries }), entries).uncertainties
  const noQuestion = uncertainties.find((item) => item.type === 'courtRoleWithoutQuestion')

  assert.ok(noQuestion)
  assert.match(noQuestion.text, /暫時視為性格或行動方式/)
})

test('v7 需求 6：規則引擎自組的文字不得出現「打折」', () => {
  const entries = [
    labelled(rev(TOWER), '問題核心'),
    labelled(up(WANDS_4), '障礙'),
    labelled(rev(PENTACLES_KING), '對策'),
    labelled(up(SWORDS_7), '資源'),
  ]
  // pairTexts 留空，所有 pairs 都走規則運算，不會混到辭典原文
  const analysis = formatAnalysis(analyzeCombination({ entries }), entries)
  const texts = [
    analysis.theme.text,
    analysis.quant.text,
    analysis.weights.text,
    analysis.numberStage.text,
    analysis.courtSummary,
    ...analysis.pairs.map((item) => item.text),
    ...analysis.courts.map((item) => item.text),
    ...analysis.conflicts.map((item) => item.text),
    ...analysis.uncertainties.map((item) => item.text),
  ]

  texts.forEach((text) => assert.ok(!String(text).includes('打折'), `仍有「打折」：${text}`))
})

test('v7 需求 7：guidance 是總結，不是逐張列舉', () => {
  const spread = spreads.find((s) => s.key === 'core')
  const { guidance } = buildReading({
    question: '要不要換工作',
    spread,
    cards: [TOWER, WANDS_4, CUPS_4, PENTACLES_KING],
    drawOrientation: (i) => (i === 3 ? 'reversed' : 'upright'),
  })

  assert.ok(!guidance.includes('重點是'), '贅詞「重點是」已移除')
  // 原本的 bug 是同一句裡印兩次（「現況重點是現況出現…」）。
  // 不同句子各自提到同一個位置是正常的（例如矛盾點講到它，落點也講到它）。
  guidance
    .split('。')
    .filter(Boolean)
    .forEach((sentence) => {
      spread.positions.forEach((position) => {
        const count = sentence.split(position.label).length - 1
        assert.ok(count <= 1, `位置「${position.label}」在同一句裡出現 ${count} 次：${sentence}`)
      })
    })
})

test('v7 需求 7：手動選牌不講「第 N 張會停在」', () => {
  const { guidance } = buildReading({
    cards: [TOWER, WANDS_4],
    drawOrientation: () => 'upright',
  })

  assert.ok(!guidance.includes('會停在'), '沒有牌陣就沒有落點可言')
})

test('v7 需求 3：全正位但走向不順時，不可說「推得動」', () => {
  // 塔正位：沒有任何逆位（momentum 高），但牌義本身負面（指向偏不順）
  const entries = [labelled(up(TOWER), '過去'), labelled(up(WANDS_4), '現在')]
  const { quant } = formatAnalysis(analyzeCombination({ entries }), entries)

  assert.equal(quant.direction, 'negative')
  assert.match(quant.text, /拖得最明顯/)
  assert.ok(!quant.text.includes('推得動'), '同一段既說「拖」又說「推得動」會自相矛盾')
  // v9：改算法之後，這種情況的阻力直接來自牌義，措辭也跟著改
  assert.match(quant.text, /卡住的不是逆位，是這些牌本身就偏滯/)
})

test('v7 修正：大牌超過 3 張就算外在主導，不再與影響力那句矛盾', () => {
  // 4 張大牌 + 6 張小牌：未過半，但張數已經不少
  const entries = [
    up(FOOL), up(EMPRESS), up(TOWER), up(STRENGTH),
    up(WANDS_4), up(WANDS_5), up(CUPS_4), up(CUPS_5), up(SWORDS_6), up(SWORDS_7),
  ]
  const result = analyzeCombination({ entries })
  assert.equal(result.theme.dominance, 'fate', '10 張裡 4 張大牌應算外在主導')

  const analysis = formatAnalysis(result, entries)
  assert.ok(!analysis.theme.text.includes('議題偏向日常'), '不可同時說日常又說影響力過半')
  assert.match(analysis.theme.text, /數量已經不少|比例偏高/)
  assert.match(analysis.weights.text, /大牌的份量超過一半/)

  // 3 張大牌仍算個人可控，但影響力過半時措辭要改成「張數不多、份量卻重」
  const three = [up(FOOL), up(EMPRESS), up(TOWER), up(WANDS_4), up(CUPS_4), up(SWORDS_6)]
  const threeAnalysis = formatAnalysis(analyzeCombination({ entries: three }), three)
  if (threeAnalysis.weights.majorWeightShare >= 0.5) {
    assert.match(threeAnalysis.weights.text, /份量卻超過一半|份量超過一半/)
  }
})

test('v7 修正：元素與數字另外成段，不再混在「整體在說什麼」', () => {
  const entries = [up(SWORDS_7), up(WANDS_4), up(CUPS_4)]
  const analysis = formatAnalysis(analyzeCombination({ entries }), entries)

  assert.ok(!analysis.theme.text.includes('元素以'), '元素已移出主題段')
  assert.ok(!analysis.theme.text.includes('缺少'), '缺少花色已移出主題段')
  assert.equal(typeof analysis.theme.elementNumberText, 'string')
})

test('v7 修正：guidance 要涵蓋議題性質、走向與卡點', () => {
  const spread = spreads.find((s) => s.key === 'core')
  const { guidance } = buildReading({
    question: '要不要換工作',
    spread,
    cards: [TOWER, WANDS_4, CUPS_4, PENTACLES_KING],
    drawOrientation: (i) => (i === 3 ? 'reversed' : 'upright'),
  })

  // 原本只有兩句，細節漏太多
  const sentences = guidance.split('。').filter(Boolean)
  assert.ok(sentences.length >= 3, `結語只有 ${sentences.length} 句，太精簡`)
  assert.match(guidance, /份量集中在/)
})

test('v7 修正：一張大牌都沒有時不說「大牌 0 張」', () => {
  const entries = [up(WANDS_4), up(CUPS_4), up(SWORDS_6)]
  const text = formatAnalysis(analyzeCombination({ entries }), entries).theme.text

  assert.ok(!text.includes('大牌'), `不該提到大牌：${text}`)
  assert.match(text, /整組都是小牌/)
})

// ---- v8：區塊之間的一致性 ----

test('v8 A1：四軸與牌組不得用同一組詞', () => {
  const { SUITS } = require('../src/data/cardAttributes')
  const { DIMENSION_LABELS } = require('../src/data/ruleConfig')
  const axisWords = Object.values(DIMENSION_LABELS)

  Object.values(SUITS).forEach((suit) => {
    assert.ok(!axisWords.includes(suit.covers), `牌組「${suit.label}」的說法與四軸撞名：${suit.covers}`)
  })
})

test('v8 A13：兩軸差距太小就不宣告單一重心', () => {
  // 火與土各一張小牌，兩軸會很接近
  const entries = [labelled(up(WANDS_4), '過去'), labelled(up(PENTACLES_2), '現在')]
  const { quant } = formatAnalysis(analyzeCombination({ entries }), entries)
  const sorted = Object.values(quant.energy).sort((a, b) => b - a)

  if (sorted[0] - sorted[1] < 0.05) {
    assert.match(quant.text, /份量差不多/)
    assert.ok(!quant.text.includes('力氣主要花在'))
  }
})

test('v8 A10：不再輸出影響力百分比', () => {
  const entries = [labelled(up(PENTACLES_KING), '過去'), labelled(rev(TOWER), '現在'), labelled(up(WANDS_4), '未來')]
  const analysis = formatAnalysis(analyzeCombination({ entries }), entries)
  const texts = [analysis.theme.text, analysis.weights.text, ...analysis.courts.map((c) => c.text)]

  texts.forEach((text) => assert.ok(!/\d+ ?%/.test(text), `仍有百分比：${text}`))
})

test('v8 A16：大牌與宮廷牌不進數字階段', () => {
  const entries = [up(PENTACLES_KING), up(TOWER), up(PENTACLES_2)]
  const stage = analyzeCombination({ entries }).numberStage

  assert.deepEqual(stage.sequence.map((s) => s.index), [2], '只剩小牌')
  assert.deepEqual(stage.skipped, [0, 1], '宮廷牌與大牌都要列入 skipped')
  // 整組沒有小牌時回 null
  assert.equal(analyzeCombination({ entries: [up(PENTACLES_KING), up(TOWER)] }).numberStage, null)
})

test('v8 A17：被剔除的若是最重的那張，必須點名', () => {
  // 錢幣國王（宮廷）帶動最大，但不進數字階段
  const entries = [labelled(up(PENTACLES_KING), '過去'), labelled(up(PENTACLES_2), '現在')]
  const analysis = formatAnalysis(analyzeCombination({ entries }), entries)
  const lead = analysis.quant.contributions[0]

  if (analysis.numberStage && analysis.numberStage.skipped.includes(lead.index)) {
    assert.match(analysis.numberStage.text, /說話最大聲的一張/)
  }
})

test('v8 A15：階段文字要帶數字主題', () => {
  const entries = [labelled(up(PENTACLES_2), '過去'), labelled(up(SWORDS_7), '現在')]
  const text = formatAnalysis(analyzeCombination({ entries }), entries).numberStage.text

  assert.match(text, /抉擇、平衡/)
  assert.match(text, /考驗、反思/)
})

test('v8：同階段不再說成原地踏步', () => {
  const entries = [labelled(up(PENTACLES_2), '過去'), labelled(up(CUPS_3), '現在')]
  const text = formatAnalysis(analyzeCombination({ entries }), entries).numberStage.text

  assert.ok(!text.includes('沒有往前也沒有退'))
  assert.match(text, /同一個主題被重複強調/)
})

test('v8 5.1：verdict 是共同結論，矛盾檢查攔得住互斥組合', () => {
  const entries = [labelled(up(FOOL), '過去'), labelled(up(WANDS_4), '現在'), labelled(up(CUPS_4), '未來')]
  const analysis = formatAnalysis(analyzeCombination({ entries }), entries)

  assert.ok(analysis.verdict, '應輸出 verdict')
  assert.equal(analysis.verdict.dominance, analysis.theme.dominance, 'verdict 與 theme 必須一致')
  assert.equal(analysis.verdict.focusIndex, analysis.theme.focusIndex)

  // 守門員本身要有效：手動餵互斥文字必須被擋下
  const { CONTRADICTIONS } = require('../src/services/analysisFormatter')
  const caught = CONTRADICTIONS.find((rule) =>
    rule.hit(['大牌只有 1 張，議題偏向日常，由個人可控。', '大牌的份量超過一半，不是你能完全掌控的。']),
  )
  assert.ok(caught, '可控與不可控同時出現時必須被攔下')
})

test('v8 5.1：大量隨機牌陣都不得觸發矛盾檢查', () => {
  const pool = [FOOL, EMPRESS, EMPEROR, STRENGTH, TOWER, WANDS_4, WANDS_5, CUPS_4, CUPS_5,
                SWORDS_6, SWORDS_7, PENTACLES_2, PENTACLES_9, WANDS_KNIGHT, CUPS_QUEEN, PENTACLES_KING, CUPS_3]

  // 固定亂數種子，失敗時可重現
  let seed = 20261014
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }

  for (let round = 0; round < 300; round += 1) {
    const size = 2 + Math.floor(rand() * 4)
    const picked = []
    while (picked.length < size) {
      const card = pool[Math.floor(rand() * pool.length)]
      if (!picked.includes(card)) picked.push(card)
    }
    const entries = picked.map((card, i) =>
      labelled(rand() > 0.5 ? up(card) : rev(card), `第 ${i + 1} 張`),
    )
    // formatAnalysis 內部會跑 assertConsistency，有矛盾就會拋錯
    assert.doesNotThrow(
      () => formatAnalysis(analyzeCombination({ entries }), entries),
      `第 ${round} 組：${picked.map((c) => c.nameZh).join('、')}`,
    )
  }
})

test('v8：只有一張有數字的小牌時，結語不講階段走向', () => {
  const spread = spreads.find((s) => s.key === 'timeline')
  const { guidance } = buildReading({
    question: '工作',
    spread,
    cards: [PENTACLES_KING, FOOL, PENTACLES_2],
    drawOrientation: () => 'upright',
  })

  assert.ok(!guidance.includes('原地踏步'))
  assert.ok(!guidance.includes('同一個主題被重複強調'), '只有一張小牌時不該談走向')
})

test('v8 E：結語改成提問，不再宣判結果', () => {
  const spread = spreads.find((s) => s.key === 'core')
  const { guidance } = buildReading({
    question: '要不要換工作',
    spread,
    cards: [TOWER, WANDS_4, CUPS_4, PENTACLES_KING],
    drawOrientation: (i) => (i === 3 ? 'reversed' : 'upright'),
  })

  assert.ok(!guidance.includes('會停在'), '宣判式的句子已移除')
  assert.match(guidance, /接下來值得自己回答/)
  // 最多兩題，問題一多就失焦
  const marks = guidance.split('接下來值得自己回答')[1].split('？').length - 1
  assert.ok(marks >= 1 && marks <= 2, `提問數應為 1～2，實際 ${marks}`)
})

test('v8 E：宮廷牌兩種讀法都要留著', () => {
  const entries = [labelled(up(PENTACLES_KING), '過去'), labelled(up(WANDS_4), '現在')]
  const text = formatAnalysis(analyzeCombination({ entries }), entries).courts[0].text

  // v10：改掉「問題沒提到別人」的否定式開場，但兩種讀法仍要都留著
  assert.match(text, /如果背後其實有個具體的人|也反映你面對他的姿態/)
  assert.ok(!text.includes('問題沒提到別人'), '不要用否定式開場')
})

test('v8 E：AI 提示要求提問節，且用詞與規則引擎一致', () => {
  const prompt = require('../src/services/narrationService').SYSTEM_PROMPT

  assert.match(prompt, /你可以問自己/, 'AI 也要產出提問節')
  assert.match(prompt, /不在預告結果/)
  assert.match(prompt, /「牌組」指權杖／聖杯／寶劍／錢幣/, '用詞要分流')
  assert.ok(!prompt.includes('主導花色'), '舊用詞已對齊')
})

test('v9 P3：兩張都負面的牌，逆逆不得寫成最慘', () => {
  // 以工作領域抽查幾組已知的極端負面配對
  const { COMBOS } = require('../scripts/pairs/work.js')
  const samples = [
    ['寶劍三', '寶劍九'],
    ['寶劍十', '寶劍三'],
    ['惡魔', '錢幣五'],
  ]

  samples.forEach(([from, to]) => {
    const combo = COMBOS.find((item) => item[0] === from && item[1] === to)
    assert.ok(combo, `找不到 ${from}→${to}`)
    const worst = combo[2][3]
    assert.ok(
      !/^既.+也.+/.test(worst),
      `${from}→${to} 的逆逆仍是「既…也…」的最慘句型：${worst}`,
    )
  })
})
