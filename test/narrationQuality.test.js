// v25 塔羅 AI 解讀的品質與穩定度：問題分類、分段提示詞、寫完的檢查、回饋、推理強度。
// 都不呼叫 AI。詳見 doc/v25-tarot-ai-quality-plan.md
const test = require('node:test')
const assert = require('node:assert')
const mongoose = require('mongoose')

const spreads = require('../src/data/spreads')
const { buildReading } = require('../src/services/readingService')
const { analyzeQuestionType, isChoiceQuestion, pickKeyCards } = require('../src/services/rules/questionType')
const { checkNarration, PROMPT_VERSION } = require('../src/services/narrationCheck')
const narration = require('../src/services/narrationService')
const Reading = require('../src/models/Reading')

const NOW = new Date('2026-11-19T04:00:00Z')

const major = (nameEn, nameZh, number) => ({ nameEn, nameZh, arcanaType: 'major', number, keywords: [], sections: {} })
const CARDS = [major('The Fool', '愚者', 0), major('The Magician', '魔術師', 1), major('The Empress', '皇后', 3)]
const spreadOf = (key) => spreads.find((spread) => spread.key === key)

// ---- 階段 1：問題分類 ----

test('選擇題：「A 還是 B」「選哪一個」算；「還是」當「仍然」時不算', () => {
  for (const question of ['該留在現在的公司還是去新創？', '這兩個對象選哪一個比較好', 'A 方案或是 B 方案', '兩份工作二選一']) {
    assert.ok(isChoiceQuestion(question), question)
  }
  for (const question of ['他還是會回來嗎？', '我還是放不下他', '我們還是朋友嗎', '還是算了吧', '哪個月會有消息？', '哪個時候適合開口']) {
    assert.ok(!isChoiceQuestion(question), question)
  }
})

test('問題類型：是非、時間、選擇可以同時成立；都不是時為 open；主題沿用已決定的領域', () => {
  assert.deepEqual(analyzeQuestionType({ question: '他會不會離職？' }).kinds, ['yesNo'])
  assert.deepEqual(analyzeQuestionType({ question: '什麼時候會有新工作？' }).kinds, ['timing'])
  assert.deepEqual(analyzeQuestionType({ question: '留在台北還是回台中發展？' }).kinds, ['choice'])
  assert.deepEqual(analyzeQuestionType({ question: '我下半年的運勢' }).kinds, ['open'])
  assert.deepEqual(analyzeQuestionType({ question: '多久會復合，會不會太晚？' }).kinds, ['yesNo', 'timing'])
  const type = analyzeQuestionType({ question: '我和他的關係', domain: 'love', othersInvolved: true })
  assert.equal(type.topic, 'love')
  assert.equal(type.othersInvolved, true)
})

test('最關鍵的牌：結果或未來位置＋焦點牌；沒有結果位置時用最後一張；重複只算一次', () => {
  assert.deepEqual(pickKeyCards({ positionKeys: ['past', 'present', 'future'], focusIndex: 0, count: 3 }), [0, 2])
  assert.deepEqual(pickKeyCards({ positionKeys: ['present', 'challenge', 'outcome', 'advice'], focusIndex: 2, count: 4 }), [2])
  assert.deepEqual(pickKeyCards({ positionKeys: null, focusIndex: 0, count: 3 }), [0, 2])
})

test('組合分析帶出問題類型與最關鍵的牌，交給 AI 的資料寫在組合分析開頭', () => {
  const reading = buildReading({ question: '他會不會離職？', spread: spreadOf('timeline'), cards: CARDS, drawOrientation: () => 'upright' })
  assert.deepEqual(reading.analysis.questionType.kinds, ['yesNo'])
  assert.ok(reading.analysis.keyCards.includes(2), '未來位置一定在')
  const message = narration.buildUserMessage({ reading, cards: CARDS, now: NOW })
  assert.match(message, /<combination_analysis>\n問題類型：是非題\n\n這次最關鍵的牌：[^\n]*皇后正位/)
})

// ---- 階段 1：分段的系統提示 ----

test('系統提示：一般問題只有共用段落；是非、時間、選擇、關係依類型附加；股市版接在最後', () => {
  const { buildSystemParts, BASE_PROMPT, PROMPT_SECTIONS, MARKET_INSTRUCTIONS } = narration
  assert.deepEqual(buildSystemParts(null, { questionType: { kinds: ['open'], topic: 'work' } }), [BASE_PROMPT])
  const parts = buildSystemParts(null, { questionType: { kinds: ['yesNo', 'timing'], topic: 'work' } })
  assert.equal(parts[0], BASE_PROMPT)
  assert.equal(parts[1], `${PROMPT_SECTIONS.yesNo}\n\n${PROMPT_SECTIONS.timing}`)
  assert.ok(buildSystemParts(null, { questionType: { kinds: ['open'], topic: 'love' } })[1].includes(PROMPT_SECTIONS.relationship))
  assert.ok(buildSystemParts(null, { spreadKey: 'relationship' })[1].includes(PROMPT_SECTIONS.relationship))
  assert.ok(buildSystemParts(null, { questionType: { kinds: ['choice'] } })[1].includes('**建議：選 ○○。**'))
  const market = buildSystemParts({ items: [] }, { questionType: { kinds: ['yesNo'] } })
  assert.ok(market[1].endsWith(MARKET_INSTRUCTIONS))
})

test('系統提示：是非題、時間題的規則只在對應段落，不在共用段落；共用段落比原本完整版短', () => {
  const { BASE_PROMPT, PROMPT_SECTIONS, SYSTEM_PROMPT } = narration
  assert.doesNotMatch(BASE_PROMPT, /是非判斷」有內容時|時間推算」有內容時|優先把宮廷牌讀成具體的人/)
  assert.match(PROMPT_SECTIONS.yesNo, /開場第一句就直接回答會或不會/)
  assert.match(PROMPT_SECTIONS.timing, /一定要給出大約的時間點或時間範圍/)
  assert.match(PROMPT_SECTIONS.relationship, /優先把宮廷牌讀成具體的人/)
  assert.ok(BASE_PROMPT.length < SYSTEM_PROMPT.length)
  // 結構與範例都在共用段落
  assert.match(BASE_PROMPT, /## 最後的判斷/)
  assert.match(BASE_PROMPT, /<example>/)
})

test('送給 OpenRouter 的系統訊息：只有共用段落加快取標記，依類型的段落不加', () => {
  const message = narration.systemMessage(['共用', '是非題段落'])
  assert.deepEqual(message, {
    role: 'system',
    content: [
      { type: 'text', text: '共用', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: '是非題段落' },
    ],
  })
  // 已經是陣列的系統內容，buildRequestBody 不再包一層
  const body = narration.buildRequestBody({ messages: [message] })
  assert.deepEqual(body.messages[0], message)
})

test('追問的系統提示：有是非判斷或時間推算時才附加對應段落', () => {
  const { buildFollowUpSystemParts, FOLLOW_UP_BASE, FOLLOW_UP_SECTIONS } = narration
  assert.deepEqual(buildFollowUpSystemParts({ rounds: [{ yesNoText: '', timingText: '' }] }), [FOLLOW_UP_BASE])
  assert.deepEqual(buildFollowUpSystemParts({ rounds: [{ timingText: '約三個月' }] }), [FOLLOW_UP_BASE, FOLLOW_UP_SECTIONS.timing])
  assert.equal(buildFollowUpSystemParts({ rounds: [], combinedYesNoText: '傾向會' })[1], FOLLOW_UP_SECTIONS.yesNo)
  assert.match(FOLLOW_UP_BASE, /## 綜合來看/)
  assert.doesNotMatch(FOLLOW_UP_BASE, /時間點一律從 <today>/)
})

// ---- 階段 5：推理強度 ----

test('推理強度：牌多時用 OPENROUTER_REASONING_EFFORT_LARGE；沒設定或不合法時和一般相同', () => {
  const saved = { large: process.env.OPENROUTER_REASONING_EFFORT_LARGE, base: process.env.OPENROUTER_REASONING_EFFORT }
  try {
    delete process.env.OPENROUTER_REASONING_EFFORT
    delete process.env.OPENROUTER_REASONING_EFFORT_LARGE
    assert.equal(narration.pickReasoningEffort({ large: true }), 'medium')
    process.env.OPENROUTER_REASONING_EFFORT_LARGE = 'high'
    assert.equal(narration.pickReasoningEffort({ large: true }), 'high')
    assert.equal(narration.pickReasoningEffort({ large: false }), 'medium')
    process.env.OPENROUTER_REASONING_EFFORT_LARGE = 'extreme'
    assert.equal(narration.pickReasoningEffort({ large: true }), 'medium')
    assert.equal(narration.buildRequestBody({ messages: [], effort: 'high' }).reasoning.effort, 'high')
    assert.equal(narration.buildRequestBody({ messages: [] }).reasoning.effort, 'medium')
  } finally {
    for (const [key, value] of [['OPENROUTER_REASONING_EFFORT_LARGE', saved.large], ['OPENROUTER_REASONING_EFFORT', saved.base]]) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

// ---- 階段 2：寫完的檢查 ----

const GOOD = `**愚者正｜魔術師正｜皇后正**

不會，至少這一季不會。牌面顯示位子還坐得穩。

## 牌面速覽

| 位置 | 牌 | 這張在說什麼 |
|---|---|---|
| 過去 | 愚者正 | 一開始什麼都敢試 |

## 事件發展

${'事情一路往前推，中間沒有被打斷，最後落在一個穩定的位置。'.repeat(12)}

## 過去｜愚者正

**一開始什麼都敢試。**${'這段經歷讓後面的決定比較大膽。'.repeat(6)}

## 現在｜魔術師正

**手上的資源都用得上。**${'現在的工具與人脈正好派上用場。'.repeat(6)}

## 未來｜皇后正

**會穩穩地收成。**${'接下來的收穫來自前面的累積。'.repeat(6)}

## 牌與牌的互動

- **過去的愚者正 → 現在的魔術師正**：敢試的心態遇上用得上的資源。

## 數字與元素

- **數字**：0 → 1 → 3，一路往上推進。
- **元素**：風與土，想得到也做得到。
- **提醒**：把想法落到紙上。

## 最後的判斷

**不會離開：位子坐得穩。**

- 這個月內把手上的專案收尾（來自皇后正）。`

test('檢查：結構完整、開場回答是非題、字數合理時全部合格', () => {
  assert.deepEqual(checkNarration(GOOD, { kinds: ['yesNo'], cardCount: 3, now: NOW }), [])
})

test('檢查：缺段落、順序錯、位置節數不夠都算 missing-section', () => {
  assert.ok(checkNarration(GOOD.replace('## 數字與元素', '## 其他'), { cardCount: 3, now: NOW }).includes('missing-section'))
  assert.ok(checkNarration(GOOD, { cardCount: 4, now: NOW }).includes('missing-section'))
  const swapped = GOOD.replace('## 事件發展', '## 暫存').replace('## 最後的判斷', '## 事件發展').replace('## 暫存', '## 最後的判斷')
  assert.ok(checkNarration(swapped, { cardCount: 3, now: NOW }).includes('missing-section'))
})

test('檢查：是非題開場沒有回答會不會；「機會」「社會」不算回答', () => {
  const vague = GOOD.replace('不會，至少這一季不會。牌面顯示位子還坐得穩。', '這組牌帶來很多機會，也和社會的變化有關。')
  assert.deepEqual(checkNarration(vague, { kinds: ['yesNo'], cardCount: 3, now: NOW }), ['yesno-first-line'])
  // 不是是非題時不檢查
  assert.deepEqual(checkNarration(vague, { kinds: ['open'], cardCount: 3, now: NOW }), [])
  // 只有一張牌（第一行沒有「｜」）也要跳過牌面那一行
  const single = '**皇帝正**\n\n不會。\n'
  assert.ok(!checkNarration(single, { kinds: ['yesNo'], cardCount: 1, now: NOW }).includes('yesno-first-line'))
})

test('檢查：時間題沒有給時間、或把已經過去的月份講成今年', () => {
  assert.deepEqual(checkNarration(GOOD, { kinds: ['timing'], cardCount: 3, now: NOW }), ['timing-no-date'])
  const withDate = GOOD.replace('## 最後的判斷', '大約三個月後，2027 年 2 月前後。\n\n## 最後的判斷')
  assert.deepEqual(checkNarration(withDate, { kinds: ['timing'], cardCount: 3, now: NOW }), [])
  // 2026-11-14 實際發生過：11 月問時間，答「今年夏末秋初」
  const past = GOOD.replace('## 最後的判斷', '時間落在今年夏末秋初。\n\n## 最後的判斷')
  assert.deepEqual(checkNarration(past, { kinds: ['timing'], cardCount: 3, now: NOW }), ['timing-past-date'])
  assert.ok(checkNarration(past.replace('今年夏末秋初', '今年 8 月'), { kinds: ['timing'], cardCount: 3, now: NOW }).includes('timing-past-date'))
  assert.deepEqual(checkNarration(past.replace('今年夏末秋初', '今年 12 月'), { kinds: ['timing'], cardCount: 3, now: NOW }), [])
})

test('檢查：寫出百分比或分數、出現已拿掉的段落、夾雜其他文字', () => {
  assert.deepEqual(checkNarration(GOOD.replace('一路往上推進', '推力 65%'), { cardCount: 3, now: NOW }), ['leaked-score'])
  assert.deepEqual(checkNarration(GOOD.replace('一路往上推進', '指向分數 0.42'), { cardCount: 3, now: NOW }), ['leaked-score'])
  // 2026-11-19 評估時誤判：問考試，「分數」是考試的分數
  assert.deepEqual(checkNarration(GOOD.replace('一路往上推進', '名次或分數會比你自己預估的漂亮'), { cardCount: 3, now: NOW }), [])
  // 股市版的表格本來就有漲跌幅
  const marketText = GOOD.replace('一路往上推進', '近 5 日 -2.08%')
  assert.ok(!checkNarration(marketText, { cardCount: 3, market: true, now: NOW }).includes('leaked-score'))
  assert.deepEqual(checkNarration(`${GOOD}\n\n## 你可以問自己\n\n- 你想要什麼？`, { cardCount: 3, now: NOW }), ['removed-section'])
  assert.deepEqual(checkNarration(GOOD.replace('一路往上推進', 'одна 推進'), { cardCount: 3, now: NOW }), ['foreign-script'])
})

test('檢查：太短、太長、結尾停在句子中間', () => {
  const short = GOOD.replace(/(事情一路往前推，中間沒有被打斷，最後落在一個穩定的位置。)+/, '很順。')
    .replace(/(這段經歷讓後面的決定比較大膽。)+/, '')
    .replace(/(現在的工具與人脈正好派上用場。)+/, '')
    .replace(/(接下來的收穫來自前面的累積。)+/, '')
  assert.ok(checkNarration(short, { cardCount: 3, now: NOW }).includes('too-short'))
  const long = GOOD.replace('## 牌與牌的互動', `${'很長的一段。'.repeat(600)}\n\n## 牌與牌的互動`)
  assert.ok(checkNarration(long, { cardCount: 3, now: NOW }).includes('too-long'))
  assert.deepEqual(checkNarration(`${GOOD}\n\n接下來你要先把`, { cardCount: 3, now: NOW }), ['truncated'])
})

test('檢查：追問的延伸回答要有「追問 N」與「綜合來看」', () => {
  const answer = `## 追問 1｜他會回來嗎\n\n**會。**補充牌的聖杯六是回頭的牌，和原本過去位置的愚者連在一起看，對方記得的是一開始那段輕鬆的相處，回頭的念頭已經出現，只差一個開口的機會。\n\n## 綜合來看\n\n**整體往好的方向走。**原牌陣的皇后講的是收成，補充牌又補上回頭的力量，兩邊方向一致。接下來兩週先等對方開口，不要主動追問。`
  assert.deepEqual(checkNarration(answer, { followUp: true, rounds: 1, now: NOW }), [])
  assert.deepEqual(checkNarration(answer.replace('## 綜合來看', '## 總結'), { followUp: true, rounds: 1, now: NOW }), ['missing-section'])
})

test('存檔前自動檢查並記下提示詞版本；只改回饋時不重算', async () => {
  const doc = new Reading({
    user: new mongoose.Types.ObjectId(),
    question: '他什麼時候會回覆？',
    cards: [0, 1, 2].map(() => ({ cardId: new mongoose.Types.ObjectId(), orientation: 'upright' })),
    narration: { text: GOOD },
  })
  await doc.validate()
  assert.deepEqual(doc.narration.checks, ['timing-no-date'])
  assert.equal(doc.narration.promptVersion, PROMPT_VERSION)

  // 已經在資料庫裡的舊紀錄（hydrate＝從資料庫讀出來的樣子）：只改回饋時版本與檢查不變
  const stored = Reading.hydrate({
    _id: new mongoose.Types.ObjectId(),
    user: new mongoose.Types.ObjectId(),
    question: '他什麼時候會回覆？',
    cards: doc.cards.map((card) => card.toObject()),
    narration: { text: GOOD, checks: [], promptVersion: 1 },
  })
  stored.narration.feedback = { value: 'down', reason: 'timing' }
  await stored.validate()
  assert.equal(stored.narration.promptVersion, 1)
  assert.deepEqual(stored.narration.checks, [])
  assert.equal(stored.narration.feedback.reason, 'timing')
  // 重新產生（文字換了）才重算
  stored.narration.text = `${GOOD}\n\n約三個月。`
  await stored.validate()
  assert.equal(stored.narration.promptVersion, PROMPT_VERSION)

  // 回饋的值只收認得的
  stored.narration.feedback = { value: 'meh' }
  await assert.rejects(stored.validate())
})

test('時間題：不採用的時間線索不要寫出數字（2026-11-19 使用者回報「約七年，但不是要等七年」）', () => {
  assert.match(narration.PROMPT_SECTIONS.timing, /就不要寫出那個數字/)
  assert.match(narration.FOLLOW_UP_SECTIONS.timing, /不要寫出那個數字/)
  assert.equal(PROMPT_VERSION >= 3, true)
})

test('檢查：「助力」「不在時間線上」這類用詞（2026-11-19 使用者回報）；提示詞要求用口語', () => {
  const text = GOOD.replace('一路往上推進', '聖杯三與寶劍八不在時間線上，只當參考，助力暫時使不上')
  assert.deepEqual(checkNarration(text, { cardCount: 3, now: NOW }), ['jargon'])
  assert.match(narration.BASE_PROMPT, /不要寫「助力」/)
  assert.match(narration.BASE_PROMPT, /不要寫「不在時間線上」/)
})

// ---- 2026-11-19：自訂位置同名分組、「有提到別人」、位置先對到問題 ----

const { positionGroups, groupRelations } = require('../src/services/rules/relationPairs')
const { resolveCustomSpread } = require('../src/services/manualDraw')
const { analyzeCombination } = require('../src/services/combinationRules')

const GROUP_LABELS = ['主觀感受', '主觀感受', '客觀事實', '客觀事實', '客觀事實', '塔羅建議']
const SIX = [
  major('The Fool', '愚者', 0),
  major('The Magician', '魔術師', 1),
  major('The Empress', '皇后', 3),
  major('The Emperor', '皇帝', 4),
  major('The Lovers', '戀人', 6),
  major('The Chariot', '戰車', 7),
]

test('位置分組：名稱完全相同才同組；沒有重複名稱時回傳 null', () => {
  const groups = positionGroups(GROUP_LABELS.map((label) => ({ label })))
  assert.deepStrictEqual(groups, [
    { label: '主觀感受', indexes: [0, 1] },
    { label: '客觀事實', indexes: [2, 3, 4] },
    { label: '塔羅建議', indexes: [5] },
  ])
  assert.strictEqual(positionGroups(['現況', '阻礙', '建議'].map((label) => ({ label }))), null)
  assert.strictEqual(positionGroups(['客觀事實 1', '客觀事實 2'].map((label) => ({ label }))), null)
  assert.strictEqual(positionGroups([null, null]), null)
})

test('位置分組的牌對：組內相鄰是「同組」，組與組之間只比一對「對照」', () => {
  assert.deepStrictEqual(groupRelations(GROUP_LABELS.map((label) => ({ label }))), [
    { from: 0, to: 1, kind: 'group' },
    { from: 1, to: 2, kind: 'contrast' },
    { from: 2, to: 3, kind: 'group' },
    { from: 3, to: 4, kind: 'group' },
    { from: 4, to: 5, kind: 'contrast' },
  ])
  // 不相鄰的同名位置也算一組
  assert.deepStrictEqual(groupRelations(['A', 'B', 'A'].map((label) => ({ label }))), [
    { from: 0, to: 2, kind: 'group' },
    { from: 2, to: 1, kind: 'contrast' },
  ])
})

test('自訂位置有同名時，讀牌結果的牌對與交給 AI 的資料都標出分組', () => {
  const { spread } = resolveCustomSpread(GROUP_LABELS.map((label) => ({ label })), SIX.length)
  const reading = buildReading({ question: '我對一個人感到不舒服', spread, cards: SIX, drawOrientation: () => 'upright' })
  assert.deepStrictEqual(
    reading.analysis.pairs.map((pair) => [pair.from, pair.to, pair.kindLabel]),
    [[0, 1, '同組'], [1, 2, '對照'], [2, 3, '同組'], [3, 4, '同組'], [4, 5, '對照']],
  )
  const message = narration.buildUserMessage({ reading, cards: SIX, now: NOW })
  assert.match(message, /位置分組（名稱相同的是同一組，不是前後順序）：主觀感受＝第 1 張、第 2 張；客觀事實＝第 3 張、第 4 張、第 5 張；塔羅建議＝第 6 張/)
  assert.match(message, /主觀感受的愚者正位 → 主觀感受的魔術師正位（同組）/)

  // 沒有同名時維持相鄰的「順承」，也不出現分組那一行
  const plain = resolveCustomSpread(['一', '二', '三'].map((label) => ({ label })), 3).spread
  const other = buildReading({ question: '', spread: plain, cards: CARDS, drawOrientation: () => 'upright' })
  assert.deepStrictEqual(other.analysis.pairs.map((pair) => pair.kindLabel), ['順承', '順承'])
  assert.doesNotMatch(narration.buildUserMessage({ reading: other, cards: CARDS, now: NOW }), /位置分組/)
})

test('有提到別人：「對一個人」「這個人」「某人」算；獨自的「一個人」與「人生」不算', () => {
  const others = (question) => analyzeCombination({ entries: CARDS.map((card) => ({ card, orientation: 'upright' })), question }).questionType.othersInvolved
  for (const question of ['我對一個人感到不舒服，但怕是自己的刻板印象造成', '看清楚這個人的本質並給我建議', '那個人對我是什麼想法', '某人最近是不是在躲我']) {
    assert.strictEqual(others(question), true, question)
  }
  for (const question of ['我一個人住會不會比較好', '我害怕面對一個人的生活', '這個人生階段該怎麼走', '我對一個人生活感到焦慮', '這個人工智慧專案會成功嗎', '我的個人成長方向']) {
    assert.strictEqual(others(question), false, question)
  }
})

test('提示詞：位置先對到問題、先決定牌在講誰、同名位置分組（版本 5 起）', () => {
  assert.ok(PROMPT_VERSION >= 5)
  const base = narration.buildSystemParts(null, { questionType: { kinds: ['open'] } }).join('\n')
  assert.match(base, /這個位置在這次的問題裡要回答什麼/)
  assert.match(base, /這張牌在講誰/)
  assert.match(base, /\*\*位置分組\*\*/)
})

test('共用提示詞整理（版本 6 起）：最重要的三件事在最前面、沒有給人看的日期註記、規則部分不超過 4000 字', () => {
  assert.ok(PROMPT_VERSION >= 6)
  const rules = narration.BASE_PROMPT.split('<example>')[0]
  assert.ok(rules.indexOf('最重要的三件事') < rules.indexOf('語氣：'))
  assert.doesNotMatch(narration.BASE_PROMPT, /使用者要求|使用者回報|20\d\d-\d\d-\d\d/)
  assert.ok(rules.length <= 4000, `規則部分 ${rules.length} 字`)
})

// ---- 2026-11-19：模擬範例看到的資料問題 ----

const { extractChoiceOptions } = require('../src/services/rules/questionType')
const { detectYesNo } = require('../src/services/rules/yesNoRules')

test('選項：從「A 還是 B」切出兩個選項；切不出來時回傳 null', () => {
  assert.deepStrictEqual(extractChoiceOptions('該留在現在的公司，還是接受新創的 offer？'), ['留在現在的公司', '接受新創的 offer'])
  assert.deepStrictEqual(extractChoiceOptions('要搬去台中還是留在台北比較好？'), ['搬去台中', '留在台北'])
  assert.deepStrictEqual(extractChoiceOptions('這次轉職，我該選 A 公司還是 B 公司'), ['A 公司', 'B 公司'])
  assert.deepStrictEqual(extractChoiceOptions('買房或是繼續租房？'), ['買房', '繼續租房'])
  assert.strictEqual(extractChoiceOptions('這兩個對象選哪一個比較好'), null)
  assert.strictEqual(extractChoiceOptions('他還是會回來嗎'), null)
})

test('二擇一牌陣：交給 AI 的資料寫出甲、乙各是哪個選項', () => {
  const spread = spreadOf('two-choice')
  const cards = [...SIX.slice(0, 5)]
  const reading = buildReading({ question: '該留在現在的公司，還是接受新創的 offer？', spread, cards, drawOrientation: () => 'upright' })
  const message = narration.buildUserMessage({ reading, cards, now: NOW })
  assert.match(message, /選項：甲＝留在現在的公司；乙＝接受新創的 offer（照問題裡的順序）/)
  const vague = buildReading({ question: '這兩份工作選哪一個', spread, cards, drawOrientation: () => 'upright' })
  assert.match(narration.buildUserMessage({ reading: vague, cards, now: NOW }), /問題裡切不出兩個選項/)
})

test('該不該做：判成建議題，答案用建議／不建議；「應該會」是推測不算', () => {
  for (const question of ['如果要復合，應該由我先開口嗎？', '這段期間要不要先減少正職的加班？', '我應該辭職嗎', '值得投資這檔股票嗎']) {
    assert.strictEqual(detectYesNo(question)?.yesMeans, 'advice', question)
  }
  assert.notStrictEqual(detectYesNo('這件事應該是誤會嗎')?.yesMeans, 'advice')
  assert.strictEqual(detectYesNo('會不會被裁員')?.yesMeans, 'change')
  const reading = buildReading({ question: '我應該辭職嗎', spread: null, cards: CARDS, drawOrientation: () => 'upright' })
  assert.match(reading.analysis.yesNo.text, /這是問該不該做的問題/)
  assert.match(reading.analysis.yesNo.text, /牌面的答案：(建議做|傾向建議做|兩邊拉扯，看你怎麼做|傾向不建議|不建議)。/)
  assert.doesNotMatch(reading.analysis.yesNo.text, /往「會」/)
})

test('前任、另一半、爸媽算有提到別人', () => {
  const others = (question) => analyzeCombination({ entries: CARDS.map((card) => ({ card, orientation: 'upright' })), question }).questionType.othersInvolved
  for (const question of ['我跟前任還有機會復合嗎？', '我和另一半的關係會好轉嗎', '爸媽會支持我轉行嗎']) {
    assert.strictEqual(others(question), true, question)
  }
})

test('交給 AI 的是語氣校準一行，不是影響力分析的句子；三張被大牌拉高時降一級', () => {
  const reading = buildReading({ question: '', spread: null, cards: CARDS, drawOrientation: () => 'upright' })
  const message = narration.buildUserMessage({ reading, cards: CARDS, now: NOW })
  assert.match(message, /語氣校準（只用來決定語氣輕重，不要寫出來）：事情份量(中等|輕)/)
  assert.doesNotMatch(message, /影響力分析：|分級容易被單張大牌拉高/)
})

test('皇后依花色描述；「心裡有別人嗎」的「會」是擔心的事發生；財運算財務', () => {
  const queen = (nameEn, nameZh, suit) => ({ nameEn, nameZh, arcanaType: 'minor', suit, rank: 'queen', number: 13, keywords: [], sections: {} })
  const cards = [queen('Queen of Swords', '寶劍皇后', 'swords'), ...CARDS.slice(0, 2)]
  const reading = buildReading({ question: '', spread: null, cards, drawOrientation: () => 'upright' })
  const court = reading.analysis.courts.find((item) => item.text.includes('寶劍皇后'))
  if (court) assert.doesNotMatch(court.text, /用感受和照顧/)
  assert.strictEqual(detectYesNo('他現在心裡有別人嗎？')?.yesMeans, 'unfavorable')
  const money = buildReading({ question: '明年的財運如何？', spread: null, cards: CARDS, drawOrientation: () => 'upright' })
  assert.strictEqual(money.analysis.questionType.topic, 'money')
})

// ---- 2026-11-19：50 題自動檢查看到的判斷問題 ----

const { isTimingQuestion } = require('../src/services/rules/timingRules')
const { analyzeYesNo } = require('../src/services/rules/yesNoRules')
const { getCardProfile } = require('../src/data/cardAttributes')

test('時間題：「哪段時間」「哪個時候」算問時間', () => {
  for (const question of ['哪段時間最需要注意開銷？', '哪個時候適合換工作', '哪幾個月要小心']) assert.ok(isTimingQuestion(question), question)
})

test('是非題：「如果…」是前提，看逗號後面；退休金不是退休；「要…嗎」是建議題', () => {
  assert.strictEqual(detectYesNo('如果我轉職做設計，會成功嗎？')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('如果下台，接班的會是內部的人嗎？')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('退休金拿去買基金安全嗎？')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('會不會被裁員')?.yesMeans, 'change')
  assert.strictEqual(detectYesNo('要找人一起合作嗎？')?.yesMeans, 'advice')
  assert.notStrictEqual(detectYesNo('要多久才會好？')?.yesMeans, 'advice')
  for (const question of ['他家人會反對嗎？', '和家人的關係會變差嗎？', '薪水會比預期低嗎？']) {
    assert.strictEqual(detectYesNo(question)?.yesMeans, 'unfavorable', question)
  }
  assert.strictEqual(detectYesNo('客戶會不會臨時改需求？')?.yesMeans, 'change')
})

test('擔心題：受阻的好牌（正向牌逆位）不算壞事會發生', () => {
  const card = { nameEn: 'The Sun', nameZh: '太陽', arcanaType: 'major', number: 19, keywords: [], sections: {} }
  const result = analyzeYesNo({ question: '他心裡有別人嗎？', items: [{ index: 0, card, profile: getCardProfile(card), orientation: 'reversed' }] })
  assert.strictEqual(result.verdict, 'unclear')
})

test('領域：男朋友算感情（不是朋友）、副業與基金算財務、案子算工作；「該不該」不再算學業', () => {
  const topic = (question) => buildReading({ question, spread: null, cards: CARDS, drawOrientation: () => 'upright' }).analysis.questionType.topic
  assert.strictEqual(topic('男朋友最近很冷淡，他在想什麼？'), 'love')
  assert.strictEqual(topic('為什麼我的副業一直沒有起色？'), 'money')
  assert.strictEqual(topic('退休金拿去買基金安全嗎？'), 'money')
  assert.strictEqual(topic('這個案子能順利結案嗎？'), 'work')
  assert.notStrictEqual(topic('我該不該離開現在住的城市？'), 'study')
})

test('負面影響位的好牌排第一時，指向分析要補「好事在這裡反而是要防的地方」', () => {
  const spread = spreadOf('guiding-star')
  const good = { nameEn: 'The Sun', nameZh: '太陽', arcanaType: 'major', number: 19, keywords: [], sections: {} }
  const plain = (n) => ({ nameEn: `Two of Cups ${n}`, nameZh: `聖杯二${n}`, arcanaType: 'minor', suit: 'cups', number: 2, keywords: [], sections: {} })
  const index = spread.positions.findIndex((position) => position.key === 'negative')
  const cards = spread.positions.map((_, i) => (i === index ? good : plain(i)))
  const reading = buildReading({ question: '', spread, cards, drawOrientation: () => 'upright' })
  if (/往順利拉最多的是負面影響/.test(reading.analysis.quant.text)) {
    assert.match(reading.analysis.quant.text, /好事在這裡反而是要防的地方/)
  }
  assert.doesNotMatch(JSON.stringify(reading.analysis), /跨越好幾個階段/)
})

test('第四批 50 題：沒有逗號的前提、「之後」前提、擔心的事優先、「我該…嗎」、家人與身邊的人', () => {
  assert.strictEqual(detectYesNo('如果我把他換掉去買別的 ETF 會比較好嗎')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('換工作之後薪水會增加嗎？')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('會不會在三個月之後離職')?.yesMeans, 'change')
  assert.strictEqual(detectYesNo('他會不會繼續騙我？')?.yesMeans, 'unfavorable')
  assert.strictEqual(detectYesNo('放棄之後會後悔嗎？')?.yesMeans, 'unfavorable')
  assert.strictEqual(detectYesNo('工作會不會繼續')?.yesMeans, 'stay')
  assert.strictEqual(detectYesNo('老闆會不會把我調去別的部門？')?.yesMeans, 'change')
  assert.strictEqual(detectYesNo('那個人會一直待在公司嗎？')?.yesMeans, 'stay')
  assert.strictEqual(detectYesNo('期末考會不會考差？')?.yesMeans, 'unfavorable')
  assert.strictEqual(detectYesNo('我該揭穿他嗎？')?.yesMeans, 'advice')
  assert.notStrictEqual(detectYesNo('這該怎麼辦嗎')?.yesMeans, 'advice')
  const others = (question) => analyzeCombination({ entries: CARDS.map((card) => ({ card, orientation: 'upright' })), question }).questionType.othersInvolved
  for (const question of ['我和婆婆的關係為什麼這麼差？', '和網友見面安全嗎？', '我和前夫之間還有可能嗎？', '房東會不會漲房租？']) {
    assert.strictEqual(others(question), true, question)
  }
})

test('版本 10：感受牌落在事實位的示範、是非題開場第一句不接保留', () => {
  assert.ok(PROMPT_VERSION >= 10)
  assert.match(narration.BASE_PROMPT, /感受類的牌（聖杯）落在「客觀事實」/)
  assert.match(narration.PROMPT_SECTIONS.yesNo, /開場第一句只放答案和最主要的一個理由/)
  // 共用提示詞不能因為加示範又長回去
  assert.ok(narration.BASE_PROMPT.split('<example>')[0].length <= 4000)
})

test('第五批 100 題：「…後」前提、要等…嗎是建議、會更適合不是建議、選誰、各類關鍵詞', () => {
  assert.strictEqual(detectYesNo('這次搬家後生活會變好嗎？')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('要延後上市嗎？')?.yesMeans, 'advice')
  assert.strictEqual(detectYesNo('要等年底促銷嗎？')?.yesMeans, 'advice')
  assert.ok(!isTimingQuestion('要等年底促銷嗎？'))
  assert.ok(isTimingQuestion('要等多久才會好？'))
  assert.strictEqual(detectYesNo('薪水要再談嗎？')?.yesMeans, 'advice')
  assert.strictEqual(detectYesNo('新的心理師會更適合我嗎？')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('我會不會被房東趕走？')?.yesMeans, 'change')
  assert.strictEqual(detectYesNo('這次公司重組，我的位置會不會變？')?.yesMeans, 'change')
  assert.strictEqual(detectYesNo('離婚後悔嗎')?.yesMeans, 'unfavorable')
  const reading = (question) => buildReading({ question, spread: null, cards: CARDS, drawOrientation: () => 'upright' }).analysis.questionType
  assert.ok(reading('兩個人都喜歡，我該選誰').kinds.includes('choice'))
  assert.strictEqual(reading('這次的提案會通過嗎？').topic, 'work')
  assert.strictEqual(reading('他什麼時候會跟我求婚？').topic, 'love')
  assert.strictEqual(reading('學測能考上第一志願嗎？').topic, 'study')
  assert.strictEqual(reading('我媽為什麼一直催婚？').othersInvolved, true)
})

test('第六批 500 題：出狀況是擔心的事、中斷與喊停是變動、一直這樣下去是維持', () => {
  assert.strictEqual(detectYesNo('會不會又出狀況？')?.yesMeans, 'unfavorable')
  assert.strictEqual(detectYesNo('我們的合作會不會中斷？')?.yesMeans, 'change')
  assert.strictEqual(detectYesNo('這個計畫會不會喊停？')?.yesMeans, 'change')
  assert.strictEqual(detectYesNo('這段感情會一直這樣下去嗎？')?.yesMeans, 'stay')
  assert.strictEqual(detectYesNo('要不要暫停一下？')?.yesMeans, 'advice')
})

test('第七批 10000 題：開場白＋前提子句、新說法（告吹、解散、守得住、長久、應不應該、需不需要、是不是該、要等到…嗎）', () => {
  assert.strictEqual(detectYesNo('想問一下，如果轉行，關係會順利嗎?')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('最近心情有點亂，轉行之後，日子會變好嗎？')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('想了很久，如果跳槽孩子會比較好嗎')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('最近心情有點亂，搬家後財務會變好嗎')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('假設放棄，課業能撐住嗎')?.yesMeans, 'stay')
  assert.strictEqual(detectYesNo('萬一離職，存款會變差嗎？')?.yesMeans, 'unfavorable')
  assert.strictEqual(detectYesNo('這次公司重組，我的位置會不會變？')?.yesMeans, 'change')
  assert.strictEqual(detectYesNo('我們的婚事會不會告吹?')?.yesMeans, 'change')
  assert.strictEqual(detectYesNo('我的副業會不會畫下句點')?.yesMeans, 'change')
  assert.strictEqual(detectYesNo('請問我的副業守得住嗎?')?.yesMeans, 'stay')
  assert.strictEqual(detectYesNo('我和同事的關係能長久嗎？')?.yesMeans, 'stay')
  for (const question of ['想問一下，應不應該換手機？', '我需不需要搬出去住', '是不是該跟他道歉？', '是不是該減少社交？', '要等到明年嗎？']) {
    assert.strictEqual(detectYesNo(question)?.yesMeans, 'advice', question)
  }
  assert.notStrictEqual(detectYesNo('要等到什麼時候才會好？')?.yesMeans, 'advice')
})

test('第八批 10000 題：否定＋吧、口語尾音、還是＝仍然、期限說法', () => {
  assert.strictEqual(detectYesNo('我不會被裁員吧')?.yesMeans, 'change')
  assert.strictEqual(detectYesNo('應該不會出狀況吧')?.yesMeans, 'unfavorable')
  assert.strictEqual(detectYesNo('他沒有在騙我吧？')?.yesMeans, 'unfavorable')
  assert.strictEqual(detectYesNo('這個計畫能順利嘛')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('我們的合作守得住ㄇ')?.yesMeans, 'stay')
  assert.strictEqual(detectYesNo('這段感情會成功齁')?.yesMeans, 'favorable')
  assert.strictEqual(detectYesNo('這次的比賽能順利啦'), null)
  const qt = (question) => buildReading({ question, spread: null, cards: CARDS, drawOrientation: () => 'upright' }).analysis.questionType
  assert.ok(!qt('事情還是沒進展，會有轉機嗎？').kinds.includes('choice'))
  assert.ok(!qt('公司還是會裁員嗎？').kinds.includes('choice'))
  assert.ok(qt('我跟她之間是友情還是愛情？').kinds.includes('choice'))
  assert.ok(qt('要去還是不去？').kinds.includes('choice'))
  for (const question of ['幾號會放榜？', '要到幾月才會好轉？', '他哪天會回覆我？']) assert.ok(isTimingQuestion(question), question)
})

test('版本 15 口語化：位置判定、障礙說明、提示詞範例不再用「其他格」「阻力」「推力」（2026-11-20）', () => {
  assert.ok(PROMPT_VERSION >= 15)
  const challenge = spreads.flatMap((spread) => spread.positions).find((position) => position.key === 'challenge' && position.label === '障礙')
  assert.strictEqual(challenge.prompt, '現在擋在你前面的是什麼')
  assert.doesNotMatch(narration.BASE_PROMPT, /做了就算數的推力|時間線上一下/)
  assert.match(narration.BASE_PROMPT, /那股衝勁/)
  const mixed = buildReading({ question: '', spread: spreadOf('timeline'), cards: CARDS, drawOrientation: (i) => (i === 0 ? 'reversed' : 'upright') })
  const text = JSON.stringify(mixed.analysis)
  assert.doesNotMatch(text, /其他格|時間線上/)
})
