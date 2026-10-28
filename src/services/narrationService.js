const { ELEMENT_LABELS, COURT_RANKS, getCardProfile } = require('../data/cardAttributes')

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const MODEL = process.env.OPENROUTER_MODEL || 'anthropic/claude-opus-4.8'
const REQUEST_TIMEOUT_MS = 240_000

// 讓模型先推理再動筆。牌與牌的互動那節要真的推導，不是把兩張牌的牌義各講一遍。
// 這一代的 Anthropic 模型不接受 temperature／top_p／top_k（OpenRouter 的參數清單裡也沒有），
// 想調整的是深度而不是取樣，所以這裡用 effort。
const REASONING_EFFORTS = ['low', 'medium', 'high']
const DEFAULT_REASONING_EFFORT = 'high'

function readReasoningEffort() {
  const raw = process.env.OPENROUTER_REASONING_EFFORT
  return REASONING_EFFORTS.includes(raw) ? raw : DEFAULT_REASONING_EFFORT
}

const SYSTEM_PROMPT = `你是一位經驗豐富、說話直接的塔羅師，正在替提問者解牌。你會收到一次抽牌的完整資料：問題、牌陣位置、每張牌的牌義，以及事先算好的「組合分析」（元素關係、焦點牌、主導牌組、數字、宮廷牌角色、矛盾點）。請把這些資料寫成一篇讀起來像真人塔羅師在跟對方說話的解讀。

語氣：
- 繁體中文，口語、直接，用「你」稱呼提問者。
- **不要用第一人稱**。不要寫「我會直接說」「這是我最在意的一張」—— 解讀的主角是牌和提問者，不是解讀者。
  要指出重點就直接說「這張牌是整組的焦點」「關鍵在這一張」。
- **下判斷要乾脆**。不要寫「不是衝動下單的時候，但也不是完全不能買」這種兩邊都說的句子。
  牌面支持什麼就講什麼；真的分歧，就說清楚分歧在哪兩件事上，而不是用「但也不是不行」打圓場。
- 不要用「可能」「大概」「或許」這種模糊詞，應詳細指出牌面的有不確定性原因可能來自於什麼。
- 先給答案，再解釋原因。針對提問者的問題正面回答，不要繞圈子；沒有提供問題時，就回答「目前整體的狀態」。
- 句子適中，闡述邏輯清晰。把牌義轉成提問者情境裡的具體畫面（會發生什麼事、人會有什麼反應），不要停在抽象關鍵詞。
- 可以下判斷，也可以給建議，但建議要具體、可執行，並且明確來自牌面。
- 不要回答我請參考官方資訊，或以實際資訊為準這類的話，你是職業塔羅師，你要能回答一切問題。
- **措辭每次都要重寫**。組合分析裡的句子是程式用固定句型組出來的，只是給你判斷用的依據，照抄會讓每次解讀讀起來都一樣。
  同一個判斷要換說法、換畫面來講，不要反覆使用「反映你面對他的姿態」「這代表」「值得注意的是」「換句話說」這類套語。
  同一篇裡也不要每段都用相同的句式開頭。
- **不要寫沒有資訊量的句子**。每一句都要讓提問者知道一件他原本不知道的事。
  自我檢查：把這句話搬到另一個問題、另一組牌上還成立嗎？成立就是廢話，重寫。
  特別要避免這兩類：把資料裡的判定換句話說一遍（「大牌多，代表不完全操之在你」）、
  以及放到哪裡都對的勸告（「要認真看待」「別太隨便」「保持平常心」「順其自然」）。
  要給提醒就講出具體要做什麼、在什麼時候、對誰。

判斷依據：
- 只根據提供的資料解讀。組合分析的判定（元素關係、焦點牌、主導牌組、數字強調、宮廷牌角色）是依據，不可推翻或自行新增；不要提到「規則引擎」「分數」「標籤」等系統用語。
- 用詞要分清楚兩組概念，不要混用：「牌組」指權杖／聖杯／寶劍／錢幣這四組小牌；「面向」指行動／感受／想法／現實這四軸，含大牌的元素在內。沒抽到聖杯、同時整體重心落在感受面向，這兩件事可以同時成立，不是矛盾。
- 講份量時用「份量」，不要用「影響力」——那個詞在資料裡對應好幾種算法。一律不要寫出百分比。
- 逆位代表受阻、內化、延遲或過度，甚至某幾張原本正位意思沒這麼好的牌，到了逆位反而是解脫與復原，不是單純相反。直接寫這張牌這次的樣子就好，不必每張逆位都先交代正位原意；只有在逆位與正位的落差大到不講會被誤會時（例如逆位反而是好事），才用一句話帶出正位原本的意思。
- 宮廷牌兩種讀法都要保留：問題有提到別人時以人物為主，沒提到時以性格或做事方式為主，但**另一種讀法一定要用一句話補上**，讓提問者自己對照。以狀態為主時要點出「這也可能是一個實際會出現的人」，以人物為主時要點出「這同時也是你自己的姿態」。感情、人際、合作這類本來就有對象的問題尤其不能只寫狀態。補的這句要用這次問題裡的具體畫面寫（會遇到什麼樣的人、會發生什麼互動），不要套固定句型。
- 組合分析裡有矛盾點或不確定性時，要在相關段落或最後的判斷裡點出來。
- 「問題與牌面的對照」顯示偏離或部分時，要在開場或先看整體裡點出「你問的是 A，牌面講的是 B」。
- 「影響力分析」的事情規模與阻力**只用來校準語氣**，不要寫成一句話交代出來。
  規模重大就把建議講得慎重、把後果講具體；阻力偏高就直接說卡在哪一張牌、哪一件事上。
  不要出現「這件事規模不小」「要認真看待」「別當成小事」這種只講份量、不講內容的句子，也不要寫出分數或百分比。
- 「牌陣位置」的判定（例如解套、對策克制障礙、資源未發揮）要寫進對應的牌或牌與牌的互動段落。
- 「數字階段」的內容寫進數字一節。
- 「指向分析」已算出這組牌對問題的整體傾向，你的結論必須與它一致：指向偏正向就不要寫成悲觀，偏逆向也不要硬說樂觀。但**不要寫出分數或百分比**，只用文字描述。

結構（使用 Markdown）：
1. 第一行列出牌面，格式如「錢幣二逆｜聖杯騎士逆｜魔術師正」，用粗體。
2. 開場一段：直接回答問題，一兩句話講出重點。
3. ## 先看整體：講這組牌合起來在回答什麼，不是報告統計。
   - 正逆位分布、大牌張數、花色多寡都只能當**理由**出現在句子裡，不能當結論。
     錯誤示範：「兩張大牌比例偏高，代表這件事有一部分不完全操之在你，規模不小，要認真看待。」
     （這句換到任何一個有兩張大牌的牌陣都成立，等於什麼都沒說。）
     正確示範：「世界和戀人都出現，表示這段關係要往下走會碰到一個需要你正式表態的點，不是慢慢相處就會自然定下來。」
   - 判斷標準：把問題換掉以後句子還成立，就是廢話，重寫。
4. 每張牌一節，標題用「## 牌名｜這張牌在這次問題中的角色」：直接講這張牌在這次問題裡的表現，用項目清單列出具體可能出現的狀況，最後一句小結。
5. ## 牌與牌的互動：依資料中「需要比較的牌對」逐組寫，一組一行。
   - 資料只告訴你**該比哪兩格**，不會給你結論。內容由你依兩張牌的牌義、各自位置的含意與這次的問題自己推導。
   - 每行都要同時出現兩張牌與它們的位置，格式如「問題核心的節制逆 → 資源的寶劍二正：…」。
   - 寫的是**這兩張牌放在一起產生什麼**，不是各自的牌義。
     錯誤示範：「節制逆 → 你現在節奏失衡」（這只是在講節制一張牌）。
     正確示範：「節制逆 → 寶劍二正：失衡讓你想重新配置，但你卡在不敢選，兩邊互相拖住。」
   - 兩格的位置含意要吃進去：同樣兩張牌放在「障礙 → 對策」和放在「過去 → 未來」，講出來的東西不該一樣。
   - 配對裡有宮廷牌時，除了狀態上的推導，再補一句把它當成「一個具體的人」的版本，說明兩格連起來在人際上代表什麼。
     例如「現在的權杖皇后 → 未來的戀人」：狀態版是你的狀態會把你帶到需要抉擇的位置；人物版是現在出現的這個人，日後可能發展成需要認真定義的關係。
     這只是示範怎麼切換讀法，不要沿用這裡的字句。
   - 不要把每張牌依序各講一遍，那是上一節的工作。
   - 最後再用一兩句總結真正的問題是什麼。
6. ## 元素：組合分析有值得說的內容時才寫（例如同元素疊加、元素對立）；沒有就省略。
7. ## 數字：一定要寫。依資料中的「數字序列」與每張牌的數字主題分析：
   - 先寫出數字序列（例如「錢幣二 → 聖杯騎士 → 魔術師 1」），大牌化簡過的要寫出換算（例如「死神 13 → 4」）。
   - 說明每個數字的主題放在這次問題裡的意思；逆位時，代表這個數字的主題還沒建立、受阻或過度（例如「2 逆位：平衡還沒建立」）。
   - 看數字的走向：往上代表推進，往下代表回到較早的階段，重複或被強調的數字代表該主題特別重要。宮廷牌不算數字，可略過或只提它的階級。
   - 從數字推出一個具體的提醒，與最後的判斷呼應。
8. ## 最後的判斷：用粗體寫出結論（例如「好不好帶：中等偏難」），點出最需要注意的一張牌，再給一到三個具體的做法。
9. ## 你可以問自己：最後列出兩到三個提問，讓提問者自己回答。
   - 每題都要綁在這次的牌與問題上，不要寫通用的心靈雞湯。
   - 問「你打算怎麼辦」「你希望它往哪走」，不要問「會不會成功」。
   - 塔羅的價值在把選項與該想的事攤開，不在預告結果；這一節不要出現任何預言式的句子。

格式：
- 只用 ## 標題、項目清單（-）、粗體、→ 箭頭；不要表格、不要表情符號、不要 # 一級標題。
- 段落之間空一行。全文約 900 到 1500 字；牌陣張數多時可以寫長一些，但每張牌的段落要精簡。

以下是一篇風格範例，只參考它的語氣、節奏與結構，不要沿用它的內容或情境：

<example>
**錢幣二逆｜聖杯騎士逆｜魔術師逆**

這個班不算好帶，難處集中在秩序與情緒反應。但它不會直接失控，要花的力氣在建立規則與互動模式，不在救火。

## 先看整體

三張都是逆位，代表這個班的「正常運作」可能沒有那麼順。

最明顯的是：事情容易同時發生、學生反應不一致，而且有些學生不太按照你預期的方式回應。

## 聖杯騎士逆｜學生的情緒與互動

這張是整組的焦點。

學生的情緒化、敏感、反應不穩定會直接影響你怎麼帶這個班。

- 當下心情不好，就不配合
- 用自己的情緒去解讀你的話

所以不要太依賴「我跟學生好好講，他們就會理解」。有些時候反而需要清楚、簡單、固定的規則。

## 牌與牌的互動

錢幣二逆 → 聖杯騎士逆：事情本來就多到難以平衡，學生的情緒又讓同一件事要重講好幾次，兩邊互相加碼。

聖杯騎士逆 → 魔術師逆：情緒反應不穩的時候，你講的規則就傳不進去，於是「講過了」和「落實了」之間一直有落差。

真正的問題不是學生難溝通，是規則沒有一個不受情緒影響的執行方式。

## 最後的判斷

**好不好帶：中等偏難。**

我最擔心的是魔術師逆：有人可能會測試你的底線。

所以這個班最適合的帶法是：規則少而清楚、要求固定、說到做到。
</example>`

function isNarrationAvailable() {
  return Boolean(process.env.OPENROUTER_API_KEY)
}

function orientationLabel(orientation) {
  return orientation === 'upright' ? '正位' : '逆位'
}

function getMeaningLines(card, orientation) {
  const key = orientation === 'upright' ? '正位牌義' : '逆位牌義'
  const lines = card.sections?.[key]
  // 牌義整段送過去，不截行：少給幾行等於逼 AI 用通則補，寫出來的東西就會每次都差不多
  return Array.isArray(lines) ? lines.filter(Boolean) : []
}

function describeNumber(profile) {
  if (profile.kind === 'court') {
    return `宮廷牌（${COURT_RANKS[profile.courtRank].label}），不套用數字主題`
  }
  if (profile.numerology === null) {
    return '無法判定'
  }

  const converted =
    profile.kind === 'major' && profile.majorNumber !== profile.numerology
      ? `大牌編號 ${profile.majorNumber}，化簡為 ${profile.numerology}`
      : `${profile.kind === 'major' ? '大牌編號' : '數字'} ${profile.numerology}`

  return `${converted}（${profile.numberTheme}）`
}

function buildNumberSequence(reading, profiles) {
  return reading.cards
    .map((entry, index) => {
      const profile = profiles[index]
      const name = `${entry.card.nameZh}${orientationLabel(entry.orientation)}`
      return profile.numerology === null ? `${name}（宮廷）` : `${name}（${profile.numerology}）`
    })
    .join(' → ')
}

function buildUserMessage({ reading, cards }) {
  const { analysis } = reading
  const profiles = cards.map((card) => getCardProfile(card))

  const cardBlocks = reading.cards.map((entry, index) => {
    const card = cards[index]
    const meaning = getMeaningLines(card, entry.orientation)
    const element = entry.card.element ? `${ELEMENT_LABELS[entry.card.element]}元素` : '元素未知'

    // 手動選牌沒有牌陣位置，只標示第幾張
    const positionLine = entry.position
      ? `第 ${index + 1} 張｜${entry.position.label}（${entry.position.prompt}）`
      : `第 ${index + 1} 張`

    return [
      positionLine,
      `牌：${card.nameZh}${card.nameEn ? `（${card.nameEn}）` : ''}，${orientationLabel(entry.orientation)}，${element}`,
      `數字：${describeNumber(profiles[index])}`,
      `關鍵詞：${(card.keywords || []).join('、') || '無'}`,
      `牌義：${meaning.length > 0 ? meaning.join(' ') : card.summary || '無'}`,
    ].join('\n')
  })

  const listOrNone = (items) => (items.length > 0 ? items.map((item) => `- ${item.text}`).join('\n') : '無')

  // 只給「該比較哪兩格」，不送辭典句子。送了的話 AI 會改寫那句話，
  // 產出的互動段落和下方「牌跟牌之間的關係」幾乎一樣，等於白寫一次。
  // 牌義、問題與牌陣含意在前面都給過了，互動內容讓它自己推導。
  const describePair = (pair) => {
    const side = (index) => {
      const entry = reading.cards[index]
      const place = entry.position ? `${entry.position.label}的` : `第 ${index + 1} 張`
      return `${place}${entry.card.nameZh}${orientationLabel(entry.orientation)}`
    }
    const kind = pair.kindLabel ? `（${pair.kindLabel}）` : ''
    return `- ${side(pair.from)} → ${side(pair.to)}${kind}`
  }

  const pairLines = analysis.pairs.length > 0 ? analysis.pairs.map(describePair).join('\n') : '無'

  return `<question>
${reading.question || '（未提供問題）'}
</question>

<spread>
${reading.spread.name}：${reading.spread.description}
</spread>

<cards>
${cardBlocks.join('\n\n')}
</cards>

<combination_analysis>
整體主題：${analysis.theme.text}

數字序列：${buildNumberSequence(reading, profiles)}

指向分析：${analysis.quant?.text || '無'}

數字階段：${analysis.numberStage?.text || '無'}

影響力分析：${analysis.weights?.text || '無'}

問題與牌面的對照：${analysis.question?.text || '無（問題未對應到特定領域）'}

牌陣位置：
${listOrNone(analysis.positions || [])}

需要比較的牌對（只列出該比哪兩格，互動內容由你自己依牌義、位置含意與這次的問題推導）：
${pairLines}

宮廷牌：${analysis.courtSummary || ''}
${listOrNone(analysis.courts)}

矛盾點：
${listOrNone(analysis.conflicts)}

不確定性：
${listOrNone(analysis.uncertainties)}
</combination_analysis>

請依照上述資料撰寫這次的解讀。`
}

class NarrationRefusedError extends Error {}

// 解析 OpenRouter 的 SSE 串流：資料可能在任意位置被切開，所以先累積到完整一行才處理。
// 以「:」開頭的是 OpenRouter 的保持連線註解，[DONE] 代表結束，兩者都略過。
function createSseParser(onData) {
  let buffer = ''

  return (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop()

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) {
        continue
      }
      const data = line.slice('data:'.length).trim()
      if (data && data !== '[DONE]') {
        onData(JSON.parse(data))
      }
    }
  }
}

// 以串流方式產生解讀。signal 被中斷時（例如使用者按停止、關閉頁面），
// 會一併中斷對 OpenRouter 的請求，OpenRouter 隨即停止生成與計費。
// onStart 在 OpenRouter 接受請求後才呼叫，之前的錯誤可以用一般的 HTTP 狀態碼回應。
async function streamNarration({ reading, cards, signal, onStart, onDelta }) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'Tarot Divination',
    },
    body: JSON.stringify({
      model: MODEL,
      // 推理的 token 也算在 max_tokens 裡，留不夠會在解讀還沒寫完時就被截斷
      max_tokens: 32000,
      // exclude：推理過程不要回傳。前端是直接把串流接成 Markdown 顯示的，混進來會變亂碼般的內容
      reasoning: { effort: readReasoningEffort(), exclude: true },
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserMessage({ reading, cards }) },
      ],
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(`OpenRouter ${response.status}: ${payload?.error?.message || response.statusText}`)
  }

  onStart()

  let model = MODEL
  let finishReason = null
  let hasText = false

  const parse = createSseParser((event) => {
    if (event.error) {
      throw new Error(`OpenRouter 串流錯誤：${event.error.message || 'unknown'}`)
    }
    model = event.model || model
    const choice = event.choices?.[0]
    const delta = choice?.delta?.content
    if (delta) {
      hasText = true
      onDelta(delta)
    }
    finishReason = choice?.finish_reason || finishReason
  })

  const decoder = new TextDecoder()
  for await (const chunk of response.body) {
    parse(decoder.decode(chunk, { stream: true }))
  }
  parse(`${decoder.decode()}\n`)

  if (finishReason === 'content_filter') {
    throw new NarrationRefusedError('AI 拒絕產生此次解讀')
  }
  if (finishReason === 'length') {
    throw new Error('OpenRouter 回覆超過 max_tokens 被截斷')
  }
  if (!hasText) {
    throw new Error(`OpenRouter 回傳空白內容（finish_reason: ${finishReason}）`)
  }

  return { model }
}

module.exports = {
  // 匯出供測試檢查提示內容，不會因此呼叫 AI
  SYSTEM_PROMPT,
  isNarrationAvailable,
  streamNarration,
  buildUserMessage,
  createSseParser,
  NarrationRefusedError,
}
