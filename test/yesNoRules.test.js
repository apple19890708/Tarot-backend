const test = require('node:test')
const assert = require('node:assert')

const { getCardProfile } = require('../src/data/cardAttributes')
const { getChangeValue, MAJOR_CHANGE, PIP_CHANGE, COURT_CHANGE } = require('../src/data/cardChange')
const { YES_NO } = require('../src/data/ruleConfig')
const { analyzeCombination } = require('../src/services/combinationRules')
const { formatAnalysis } = require('../src/services/analysisFormatter')
const { detectYesNo, analyzeYesNo } = require('../src/services/rules/yesNoRules')
const { SYSTEM_PROMPT, FOLLOW_UP_PROMPT, buildFollowUpMessage, buildUserMessage } = require('../src/services/narrationService')
const {
  validateFollowUps,
  buildFollowUpContext,
  keepAnsweredSections,
  mergeFollowUpAnswer,
  FOLLOW_UP_MAX_ROUNDS,
} = require('../src/services/followUp')
const { analyzeTiming, isTimingQuestion } = require('../src/services/rules/timingRules')
const { getCardTiming } = require('../src/data/cardTiming')

const SUIT_ZH = { wands: '權杖', cups: '聖杯', swords: '寶劍', pentacles: '錢幣' }
const NUM_EN = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
const cap = (text) => text[0].toUpperCase() + text.slice(1)

const major = (nameEn, nameZh, number) => ({ nameEn, nameZh, arcanaType: 'major', number, keywords: [], sections: {} })
const pip = (suit, number) => ({
  nameEn: `${NUM_EN[number - 1]} of ${cap(suit)}`,
  nameZh: `${SUIT_ZH[suit]}${number}`,
  arcanaType: 'minor',
  suit,
  number,
  keywords: [],
  sections: {},
})
const court = (rank, suit) => ({
  nameEn: `${cap(rank)} of ${cap(suit)}`,
  nameZh: `${SUIT_ZH[suit]}${{ page: '侍者', knight: '騎士', queen: '皇后', king: '國王' }[rank]}`,
  arcanaType: 'minor',
  suit,
  number: { page: 11, knight: 12, queen: 13, king: 14 }[rank],
  keywords: [],
  sections: {},
})
const U = 'upright'
const R = 'reversed'
const items = (list) => list.map(([card, orientation], index) => ({ index, card, orientation, profile: getCardProfile(card) }))

const QUESTION = 'Nvdia 黃仁勳 會因為這次風波下台嗎'

test('是非題辨識：會不會、是否、能不能、有沒有、…嗎；開放式問題不算', () => {
  for (const question of ['他會不會離職', '是否該接這份工作', '我能不能錄取', '他有沒有喜歡我', '這次會成功嗎', '接下來能不能夠順利']) {
    assert.ok(detectYesNo(question), question)
  }
  for (const question of ['', '我的感情接下來如何發展', '這份工作要注意什麼']) {
    assert.strictEqual(detectYesNo(question), null, question)
  }
})

test('是非題的「會」指什麼：變動、維持、壞事、好事；同時問走和留不算是非題', () => {
  assert.strictEqual(detectYesNo(QUESTION).yesMeans, 'change')
  assert.strictEqual(detectYesNo('我們會不會分手').yesMeans, 'change')
  assert.strictEqual(detectYesNo('他能不能保住位子').yesMeans, 'stay')
  assert.strictEqual(detectYesNo('這段關係會繼續嗎').yesMeans, 'stay')
  assert.strictEqual(detectYesNo('這次投資會不會虧').yesMeans, 'unfavorable')
  assert.strictEqual(detectYesNo('這次面試會不會上').yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('他會離開還是留下嗎'), null)
})

test('變動值表：78 張牌正逆位都有值，而且都在 −1～1', () => {
  const pairs = [
    ...Object.values(MAJOR_CHANGE),
    ...Object.values(PIP_CHANGE).flatMap((suit) => Object.values(suit)),
    ...Object.values(COURT_CHANGE).flatMap((suit) => Object.values(suit)),
  ]
  Object.values(PIP_CHANGE).forEach((suit) => assert.strictEqual(Object.keys(suit).length, 10))
  Object.values(COURT_CHANGE).forEach((suit) => assert.strictEqual(Object.keys(suit).length, 4))
  pairs.forEach((pair) => {
    assert.strictEqual(pair.length, 2)
    pair.forEach((value) => assert.ok(value >= -1 && value <= 1))
  })
  // 英文名對不上時用中文名
  const emperor = { nameEn: '', nameZh: '皇帝', arcanaType: 'major', number: 4 }
  assert.strictEqual(getChangeValue(emperor, getCardProfile(emperor), 'reversed'), 0.8)
})

test('在位的牌正位是守住、逆位是失勢（逆位要翻向，不是只打折）', () => {
  const emperor = major('The Emperor', '皇帝', 4)
  const kingCups = court('king', 'cups')
  assert.ok(getChangeValue(emperor, getCardProfile(emperor), U) < -0.5)
  assert.ok(getChangeValue(emperor, getCardProfile(emperor), R) > 0.5)
  assert.ok(getChangeValue(kingCups, getCardProfile(kingCups), U) < 0)
  assert.ok(getChangeValue(kingCups, getCardProfile(kingCups), R) > 0)
})

// 2026-11-13 使用者回報的兩組牌：問「會因為這次風波下台嗎」，原本兩次都答不會
test('使用者回報的第二組（權杖十逆、聖杯七正、聖杯國王逆）：傾向會下台', () => {
  const result = analyzeYesNo({ question: QUESTION, items: items([[pip('wands', 10), R], [pip('cups', 7), U], [court('king', 'cups'), R]]) })
  assert.strictEqual(result.yesMeans, 'change')
  assert.ok(['leanYes', 'yes'].includes(result.verdict), result.verdict)
  // 往「會」拉的是權杖十逆與聖杯國王逆
  const towardYes = result.contributions.filter((item) => item.share > 0).map((item) => item.index)
  assert.deepStrictEqual(towardYes.sort(), [0, 2])
})

test('使用者回報的第一組（錢幣皇后正、寶劍五逆、聖杯七正）：不會給「會」，錢幣皇后把答案往不會拉', () => {
  const result = analyzeYesNo({ question: QUESTION, items: items([[court('queen', 'pentacles'), U], [pip('swords', 5), R], [pip('cups', 7), U]]) })
  assert.ok(['leanNo', 'unclear'].includes(result.verdict), result.verdict)
  assert.strictEqual(result.contributions[0].index, 0)
  assert.ok(result.contributions[0].share < 0)
})

test('典型牌面：變動與失勢的牌答會，穩坐的牌答不會；問法換成「保得住嗎」答案相反', () => {
  const leaving = items([[major('The Emperor', '皇帝', 4), R], [major('The Tower', '塔', 16), U], [major('Death', '死神', 13), U]])
  const staying = items([[major('The Emperor', '皇帝', 4), U], [pip('pentacles', 4), U], [major('Strength', '力量', 8), U]])
  assert.strictEqual(analyzeYesNo({ question: QUESTION, items: leaving }).verdict, 'yes')
  assert.strictEqual(analyzeYesNo({ question: QUESTION, items: staying }).verdict, 'no')
  assert.strictEqual(analyzeYesNo({ question: '他的位子保得住嗎', items: leaving }).verdict, 'no')
  assert.strictEqual(analyzeYesNo({ question: '他的位子保得住嗎', items: staying }).verdict, 'yes')
})

test('好事會不會發生：正向牌正位偏會、逆位偏不會；問壞事時相反', () => {
  const good = [major('The Sun', '太陽', 19), major('The Star', '星星', 17), pip('cups', 10)]
  const upright = items(good.map((card) => [card, U]))
  const reversed = items(good.map((card) => [card, R]))
  assert.strictEqual(analyzeYesNo({ question: '這次面試會不會上', items: upright }).verdict, 'yes')
  assert.ok(['leanNo', 'no'].includes(analyzeYesNo({ question: '這次面試會不會上', items: reversed }).verdict))
  assert.strictEqual(analyzeYesNo({ question: '這次投資會不會虧', items: upright }).verdict, 'no')
})

test('結果位置加重：同樣兩張牌，變動牌放在結果時分數比較高', () => {
  const tower = major('The Tower', '塔', 16)
  const emperor = major('The Emperor', '皇帝', 4)
  const towerLast = analyzeYesNo({ question: QUESTION, items: items([[emperor, U], [tower, U]]), positionKeys: ['present', 'outcome'] })
  const emperorLast = analyzeYesNo({ question: QUESTION, items: items([[tower, U], [emperor, U]]), positionKeys: ['present', 'outcome'] })
  assert.ok(towerLast.score > emperorLast.score)
  assert.ok(YES_NO.outcomeBoost > 1)
})

test('不是是非題時 yesNo 為 null；是非題時判斷依據有答案與文字', () => {
  const entries = [
    { card: pip('wands', 10), orientation: R, position: null, hasPosition: false },
    { card: pip('cups', 7), orientation: U, position: null, hasPosition: false },
    { card: court('king', 'cups'), orientation: R, position: null, hasPosition: false },
  ]
  const open = formatAnalysis(analyzeCombination({ entries, question: '這件事接下來怎麼發展' }), entries)
  assert.strictEqual(open.yesNo, null)

  const closed = formatAnalysis(analyzeCombination({ entries, question: QUESTION }), entries)
  assert.strictEqual(closed.yesNo.verdictLabel, '傾向會')
  assert.match(closed.yesNo.text, /這是是非題，「會」指的是事情會變動（下台）。牌面的答案：傾向會。/)
  assert.match(closed.yesNo.text, /往「會」拉最多的是(權杖10逆位|聖杯國王逆位)/)
})

test('提示詞：是非題先回答、只照牌面、不拿小牌當理由；指向分析不是會不會', () => {
  assert.match(SYSTEM_PROMPT, /開場第一句就直接回答/)
  assert.match(SYSTEM_PROMPT, /只照牌面回答，不要用你對現實世界的認識推翻牌面/)
  assert.match(SYSTEM_PROMPT, /不要拿「都是小牌」「沒有大牌」當成不會發生的理由/)
  assert.match(SYSTEM_PROMPT, /講的是這件事\*\*順不順\*\*，不是「會不會發生」/)
})

// ---- 抽牌追問 ----
const ID = (n) => `507f1f77bcf86cd7994390${String(n).padStart(2, '0')}`
const BASE = [{ id: ID(1), orientation: U }, { id: ID(2), orientation: R }]

test('追問清單的檢查：最多三次、每次 1～3 張、要有問題、不能和桌上的牌重複', () => {
  const round = (ids, question = '那他會自己請辭嗎') => ({ question, cards: ids.map((id) => ({ id: ID(id), orientation: U })) })
  assert.deepStrictEqual(validateFollowUps(undefined, BASE), { followUps: [] })
  assert.strictEqual(validateFollowUps([round([3]), round([4, 5, 6])], BASE).followUps.length, 2)
  assert.strictEqual(FOLLOW_UP_MAX_ROUNDS, 3)
  assert.ok(validateFollowUps([round([3]), round([4]), round([5]), round([6])], BASE).error)
  assert.ok(validateFollowUps([round([3, 4, 5, 6])], BASE).error)
  assert.ok(validateFollowUps([round([])], BASE).error)
  assert.ok(validateFollowUps([round([3], '   ')], BASE).error)
  assert.ok(validateFollowUps([round([3], '字'.repeat(201))], BASE).error)
  // 和原牌陣重複、和前一次追問重複
  assert.ok(validateFollowUps([round([1])], BASE).error)
  assert.ok(validateFollowUps([round([3]), round([3])], BASE).error)
  assert.ok(validateFollowUps([{ question: '問', cards: [{ id: 'x', orientation: U }] }], BASE).error)
  assert.ok(validateFollowUps('not-an-array', BASE).error)
})

test('追問的資料：每次追問各自的是非判斷，以及加上補充牌後對原本問題的是非判斷', () => {
  const baseCards = [court('queen', 'pentacles'), pip('swords', 5), pip('cups', 7)]
  const baseDrawn = [{ orientation: U }, { orientation: R }, { orientation: U }]
  const context = buildFollowUpContext({
    question: QUESTION,
    baseCards,
    baseDrawn,
    rounds: [
      { question: '董事會會不會換掉他', cards: [major('The Tower', '塔', 16), major('The Emperor', '皇帝', 4)], drawn: [{ orientation: U }, { orientation: R }] },
      { question: '接下來要注意什麼', cards: [pip('cups', 2)], drawn: [{ orientation: U }] },
    ],
  })
  assert.match(context.rounds[0].yesNoText, /牌面的答案：會。/)
  assert.strictEqual(context.rounds[1].yesNoText, null)
  // 原本偏不會，加上塔與皇帝逆之後翻成會的方向
  assert.match(context.combinedYesNoText, /牌面的答案：(傾向會|會)。/)
  assert.match(context.combinedYesNoText, /往「會」拉最多的是(塔正位|皇帝逆位)/)
})

test('追問的提示詞與訊息：帶原牌陣、先前的解讀、每次追問與補充牌、合併的是非判斷', () => {
  const baseCards = [court('queen', 'pentacles'), pip('swords', 5), pip('cups', 7)]
  const entries = baseCards.map((card, index) => ({ card, orientation: [U, R, U][index], position: null, hasPosition: false }))
  const analysis = formatAnalysis(analyzeCombination({ entries, question: QUESTION }), entries)
  const reading = {
    question: QUESTION,
    spread: { name: '自選牌', description: '由你自己挑選的牌' },
    cards: entries.map((entry) => ({ ...entry, card: { nameZh: entry.card.nameZh, nameEn: entry.card.nameEn } })),
    analysis,
  }
  const context = buildFollowUpContext({
    question: QUESTION,
    baseCards,
    baseDrawn: entries,
    rounds: [{ question: '董事會會不會換掉他', cards: [major('The Tower', '塔', 16)], drawn: [{ orientation: U }] }],
  })
  const message = buildFollowUpMessage({ reading, cards: baseCards, context, previousNarration: '先前的解讀內容' })
  assert.match(message, /<question>\nNvdia 黃仁勳/)
  assert.match(message, /<previous_narration>\n先前的解讀內容/)
  assert.match(message, /追問 1（這次要回答）：董事會會不會換掉他/)
  assert.match(message, /補充牌 1：塔（The Tower），正位/)
  assert.match(message, /加上補充牌後的是非判斷/)
  assert.doesNotMatch(message, /請依照上述資料撰寫這次的解讀。/)
  assert.match(message, /請依照上述資料撰寫追問的延伸回答。$/)
  // 沒看過 AI 解讀時要講明
  assert.match(buildFollowUpMessage({ reading, cards: baseCards, context }), /提問者還沒有看過 AI 解讀/)

  assert.match(FOLLOW_UP_PROMPT, /## 追問 N｜追問的內容/)
  assert.match(FOLLOW_UP_PROMPT, /## 綜合來看/)
  assert.match(FOLLOW_UP_PROMPT, /不要重講先前解讀已經講過的內容/)
  assert.match(FOLLOW_UP_PROMPT, /維持、變得更肯定，還是改變了/)
})

// ---- 2026-11-13 使用者要求的調整 ----

test('沒有明確答案的比例壓在 10% 左右：門檻跟著 √張數 縮放，1～7 張都在 6%～14%', () => {
  const deck = [
    ...['The Fool', 'The Magician', 'The Empress', 'The Emperor', 'The Lovers', 'The Chariot', 'Strength', 'The Hermit', 'Wheel of Fortune', 'Death', 'The Tower', 'The Star', 'The Moon', 'The Sun', 'The World'].map((name, number) => major(name, name, number)),
    ...['wands', 'cups', 'swords', 'pentacles'].flatMap((suit) => [
      ...Array.from({ length: 10 }, (_, i) => pip(suit, i + 1)),
      ...['page', 'knight', 'queen', 'king'].map((rank) => court(rank, suit)),
    ]),
  ]
  // 固定亂數種子，結果每次一樣
  let seed = 7
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (const size of [1, 3, 5, 7]) {
    for (const question of [QUESTION, '這次面試會不會上']) {
      let unclear = 0
      const runs = 3000
      for (let k = 0; k < runs; k += 1) {
        const pool = [...deck]
        const list = Array.from({ length: size }, () => [pool.splice(Math.floor(random() * pool.length), 1)[0], random() < 0.5 ? R : U])
        if (analyzeYesNo({ question, items: items(list) }).verdict === 'unclear') unclear += 1
      }
      const ratio = unclear / runs
      assert.ok(ratio >= 0.04 && ratio <= 0.14, `${size} 張、${question}：${ratio}`)
    }
  }
})

test('兩邊拉扯時不說「給不出答案」，講結果還握在提問者手上', () => {
  const entries = [
    { card: major('The Moon', '月亮', 18), orientation: U, position: null, hasPosition: false },
  ]
  // 月亮在變動軸上剛好是基準值（看不清，沒有方向）
  const analysis = formatAnalysis(analyzeCombination({ entries, question: QUESTION }), entries)
  assert.strictEqual(analysis.yesNo.verdict, 'unclear')
  assert.strictEqual(analysis.yesNo.verdictLabel, '兩邊拉扯，看你怎麼做')
  assert.doesNotMatch(analysis.yesNo.text, /給不出|無法判斷|沒有明確答案/)
  assert.match(analysis.yesNo.text, /接下來怎麼做會決定往哪邊走/)
  assert.match(SYSTEM_PROMPT, /不要寫「牌面不給肯定答案」「無法判斷」「沒有答案」/)
  assert.match(FOLLOW_UP_PROMPT, /不要寫「牌面不給肯定答案」「無法判斷」/)
})

test('時間類問題：辨識多久、什麼時候、何時；花色決定單位、數字決定數量，大牌給星座月份', () => {
  for (const question of ['還要多久才能回到成本價', '他什麼時候會聯絡我', '何時適合出場', '要等幾個月']) {
    assert.ok(isTimingQuestion(question), question)
  }
  assert.ok(!isTimingQuestion('他會不會被換掉'))

  const profileOf = (card) => getCardProfile(card)
  assert.match(getCardTiming(pip('wands', 3), profileOf(pip('wands', 3)), U).text, /約三天/)
  assert.match(getCardTiming(pip('swords', 2), profileOf(pip('swords', 2)), U).text, /約兩週/)
  assert.match(getCardTiming(pip('cups', 3), profileOf(pip('cups', 3)), U).text, /約三個月/)
  assert.match(getCardTiming(pip('pentacles', 1), profileOf(pip('pentacles', 1)), U).text, /約一年/)
  assert.match(getCardTiming(pip('cups', 3), profileOf(pip('cups', 3)), R).text, /延遲/)
  const devil = major('The Devil', '惡魔', 15)
  assert.match(getCardTiming(devil, profileOf(devil), U).text, /摩羯座.*12 月下旬到 1 月中旬/)
  const tower = major('The Tower', '塔', 16)
  assert.match(getCardTiming(tower, profileOf(tower), U).text, /突然/)
  assert.match(getCardTiming(court('knight', 'wands'), profileOf(court('knight', 'wands')), U).text, /很快/)
})

test('時間推算：結果位置的牌是主要的時間牌；沒有位置時看最後一張；不是時間類問題回 null', () => {
  const list = items([[pip('wands', 3), U], [pip('cups', 2), U], [pip('pentacles', 4), R]])
  const byOutcome = analyzeTiming({ question: '還要多久', items: list, positionKeys: ['past', 'outcome', 'advice'] })
  assert.strictEqual(byOutcome.mainIndex, 1)
  assert.match(byOutcome.text, /^主要的時間牌：聖杯2正位：約兩個月/)
  assert.match(byOutcome.text, /其他牌的時間線索：權杖3正位：約三天/)
  assert.strictEqual(analyzeTiming({ question: '還要多久', items: list }).mainIndex, 2)
  assert.strictEqual(analyzeTiming({ question: '他會不會回來', items: list }), null)

  const entries = [{ card: major('The Devil', '惡魔', 15), orientation: U, position: null, hasPosition: false }]
  const analysis = formatAnalysis(analyzeCombination({ entries, question: '還要多久才能回到成本價' }), entries)
  assert.match(analysis.timing.text, /摩羯座/)
  assert.match(SYSTEM_PROMPT, /一定要給出大約的時間點或時間範圍/)
})

test('追問問時間時，那一次的時間推算交給 AI', () => {
  const context = buildFollowUpContext({
    question: QUESTION,
    baseCards: [pip('cups', 7)],
    baseDrawn: [{ orientation: U }],
    rounds: [{ question: '你覺得還要多久才能回到我當初買的價位', cards: [major('The Devil', '惡魔', 15)], drawn: [{ orientation: U }] }],
  })
  assert.match(context.rounds[0].timingText, /主要的時間牌：惡魔正位：摩羯座/)
  assert.match(FOLLOW_UP_PROMPT, /一定要給出大約的時間點或範圍/)
})

test('只回答新的追問：保留前幾次已經寫好的段落，中間缺一節就從那裡重寫；新寫的接在後面', () => {
  const text = '## 追問 1｜換股\n第一段\n\n## 追問 2｜多久\n第二段\n\n## 綜合來看\n舊的結論'
  assert.deepStrictEqual(keepAnsweredSections(text, 2), { kept: 2, text: '## 追問 1｜換股\n第一段\n\n## 追問 2｜多久\n第二段' })
  assert.strictEqual(keepAnsweredSections(text, 1).kept, 1)
  // 舊的綜合來看不保留
  assert.doesNotMatch(keepAnsweredSections(text, 2).text, /舊的結論/)
  assert.strictEqual(keepAnsweredSections('## 追問 2｜只有第二節\n內容', 2).kept, 0)
  assert.strictEqual(keepAnsweredSections('## 追問 1｜寫到一半\n', 1).kept, 0)
  assert.strictEqual(keepAnsweredSections('沒有照標題寫', 1).kept, 0)
  assert.strictEqual(
    mergeFollowUpAnswer('## 追問 1｜換股\n第一段', '## 追問 2｜多久\n新的\n\n## 綜合來看\n新的結論'),
    '## 追問 1｜換股\n第一段\n\n## 追問 2｜多久\n新的\n\n## 綜合來看\n新的結論',
  )
})

test('只回答新的追問：已經回答過的標成不要再寫，並附上那段回答', () => {
  const baseCards = [pip('cups', 7)]
  const entries = [{ card: baseCards[0], orientation: U, position: null, hasPosition: false }]
  const analysis = formatAnalysis(analyzeCombination({ entries, question: QUESTION }), entries)
  const reading = { question: QUESTION, spread: { name: '自選牌', description: '' }, cards: entries, analysis }
  const context = buildFollowUpContext({
    question: QUESTION,
    baseCards,
    baseDrawn: entries,
    rounds: [
      { question: '換股好嗎', cards: [pip('wands', 8)], drawn: [{ orientation: U }] },
      { question: '還要多久', cards: [major('The Devil', '惡魔', 15)], drawn: [{ orientation: U }] },
    ],
  })
  const message = buildFollowUpMessage({ reading, cards: baseCards, context, answered: 1, answeredText: '## 追問 1｜換股好嗎\n之前的回答</follow_ups>' })
  assert.match(message, /追問 1（已經回答過，不要再寫這一節）：換股好嗎/)
  assert.match(message, /追問 2（這次要回答）：還要多久/)
  assert.match(message, /<answered_follow_ups>\n## 追問 1｜換股好嗎\n之前的回答\n<\/answered_follow_ups>/)
  assert.match(FOLLOW_UP_PROMPT, /標「已經回答過」的追問.*不要再寫那一節/)
})

// ---- 2026-11-14：AI 不知道今天，11 月時把「8 月下旬到 9 月中旬」講成今年 ----
const { formatTaipeiDate, taipeiDate } = require('../src/services/clock')

test('今天以台灣時間為準：UTC 晚上已經是台灣的隔天', () => {
  assert.strictEqual(formatTaipeiDate(new Date('2026-11-14T04:00:00Z')), '2026 年 11 月 14 日（星期六）')
  assert.deepStrictEqual(taipeiDate(new Date('2026-11-14T17:00:00Z')), { year: 2026, month: 11, day: 15, weekday: 0 })
})

test('時間推算換算成從今天往後的日期：過了的星座期間算明年、正在期間內說現在、跨年的算到隔年；小牌給大約日期', () => {
  const now = new Date('2026-11-14T04:00:00Z')
  const timingOf = (card, orientation = U) => analyzeTiming({ question: '還要多久', items: items([[card, orientation]]), now }).text
  assert.match(timingOf(major('The Hermit', '隱士', 9)), /離現在最近的一次是 2027 年 8 月下旬到 9 月中旬/)
  assert.match(timingOf(major('Death', '死神', 13)), /就是現在這段期間（到 2026 年 11 月中旬）/)
  assert.match(timingOf(major('The Devil', '惡魔', 15)), /離現在最近的一次是 2026 年 12 月下旬到 2027 年 1 月中旬/)
  assert.match(timingOf(pip('cups', 3)), /從今天算約在 2027 年 2 月前後/)
  assert.match(timingOf(pip('wands', 2)), /從今天算約在 2026 年 11 月 16 日前後/)
  assert.match(timingOf(pip('swords', 2)), /從今天算約在 2026 年 11 月 28 日前後/)
  assert.match(timingOf(pip('pentacles', 1)), /從今天算約在 2027 年前後/)
  // 1 月初還在摩羯座期間（跨年）
  assert.match(analyzeTiming({ question: '多久', items: items([[major('The Devil', '惡魔', 15), U]]), now: new Date('2027-01-05T04:00:00Z') }).text, /就是現在這段期間（到 2027 年 1 月中旬）/)
})

test('交給 AI 的資料開頭寫明今天的日期與星期，追問也一樣', () => {
  const entries = [{ card: pip('cups', 7), orientation: U, position: null, hasPosition: false }]
  const analysis = formatAnalysis(analyzeCombination({ entries, question: QUESTION }), entries)
  const reading = { question: QUESTION, spread: { name: '自選牌', description: '' }, cards: entries, analysis }
  const message = buildUserMessage({ reading, cards: [entries[0].card], now: new Date('2026-11-14T04:00:00Z') })
  assert.match(message, /^<today>\n現在是台灣時間 2026 年 11 月 14 日（星期六）。/)
  assert.match(message, /已經過去的月份要算到明年/)
  const context = buildFollowUpContext({ question: QUESTION, baseCards: [entries[0].card], baseDrawn: entries, rounds: [] })
  assert.match(buildFollowUpMessage({ reading, cards: [entries[0].card], context }), /^<today>\n現在是台灣時間 \d{4} 年/)
  assert.match(FOLLOW_UP_PROMPT, /時間點一律從 <today> 的日期往後算/)
})
