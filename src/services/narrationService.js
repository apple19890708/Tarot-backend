const { ELEMENT_LABELS, COURT_RANKS, getCardProfile } = require('../data/cardAttributes')
const { formatMarketForPrompt } = require('./market/marketService')

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
- **全文只用繁體中文**。除了牌的英文名稱與常見英文縮寫，不要夾雜其他語言或文字（例如俄文等西里爾字母、日文假名、簡體字）；數字一律寫成中文或阿拉伯數字。
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
- 「牌陣位置」的判定（例如解套、對策克制障礙、資源未發揮）要化成「事情會怎麼走」裡的情節，不要單獨列出。
- 「數字階段」只在能解釋劇情時用半句帶過，不要列數字序列。
- 「指向分析」已算出這組牌對問題的整體傾向，你的結論必須與它一致：指向偏正向就不要寫成悲觀，偏逆向也不要硬說樂觀。但**不要寫出分數或百分比**，只用文字描述。

畫面上已經有的內容（不要重講）：
提問者會在同一頁看到這篇解讀，旁邊還有每張牌的牌義卡片，下方有事先算好的「判斷依據」與結語，內容包括：
- 每張牌的完整牌義
- 整體走向（順利／不順）、推力與阻力、每張牌把結果往哪邊拉
- 各位置的判斷、牌與牌之間的關係、宮廷牌是什麼樣的人
- 時間線上的數字階段、元素分布、沒出現的牌組
- 一段結語，以及「這週能做的第一件事是什麼」這類提問
這些是你的**依據**，不是你要交的內容。你要寫的是畫面上沒有的部分：把這些判斷串成這件事接下來會怎麼發展、放進提問者的實際處境、給出具體做法。
- 不要列數字序列，不要報正逆位張數、大牌張數、元素分布。數字或元素只在能解釋劇情時用半句帶過（例如「兩個 7 疊在一起，這段要過的就是反覆掙扎的那一關」）。
- 不要把每組牌對都寫一遍。
- 不要改寫下方已有的句子（例如「時間線上一下前進、一下後退」「這塊沒出現，可能是容易被忽略的地方」「像個急著行動的人」）。

結構（使用 Markdown）：
1. 第一行列出牌面，格式如「錢幣二逆｜聖杯騎士逆｜魔術師正」，用粗體。
2. 開場一段：直接回答問題，一兩句話講出重點。
3. ## 事情會怎麼走：把這組牌講成一段有前因後果的發展，這是整篇最重要的一節。
   - 有時間位置（過去、現在、未來、結果）時，照時間順序講：之前發生了什麼、現在卡在哪、接下來會遇到什麼、最後落在哪。
   - 障礙、助力、資源這類不是時間點的牌，當成過程中推一把或卡一下的力量放進故事裡，講清楚它在哪個時間點、對誰起作用。
   - 沒有時間位置的牌陣，就講各股力量怎麼互相牽動、誰壓過誰。
   - 牌與牌的互動寫在這裡，只挑最關鍵的一兩組（資料的「需要比較的牌對」是候選，不必全寫）。寫的是**兩張放在一起產生什麼**，不是各自的牌義；兩格的位置含意要吃進去，同樣兩張牌放在「障礙 → 對策」和「過去 → 未來」講出來的東西不該一樣。
     錯誤示範：「節制逆 → 你現在節奏失衡」（這只是在講節制一張牌）。
     正確示範：「節制逆 → 寶劍二正：失衡讓你想重新配置，但你卡在不敢選，兩邊互相拖住。」
   - 正逆位分布、大牌多寡都只能當**理由**出現在句子裡，不能當結論。判斷標準：把問題換掉以後句子還成立，就是廢話，重寫。
4. 每個位置一節，依牌陣順序，標題用「## 位置｜牌名」（例如「## 正面影響｜塔正」；手動選牌沒有位置時用「## 第 1 張｜牌名」）。
   - 牌義卡片上已經有這張牌本身的意思，這裡寫的是**這張牌落在這個位置**代表什麼：先看位置在問什麼（資料裡每格都附了位置說明），再用牌回答它，放進這次的問題裡講成具體的場面。不要重述牌義卡片上的關鍵詞。
   - **位置會改變牌的讀法**，尤其是牌的調性和位置相反時：
     - 負面意味重的牌落在正向位置（助力、正面影響、資源、對策、建議）：不是「這格沒用」，而是幫助會以不舒服的形式出現。
       例如塔落在正面影響：幫你的是一次打破現狀的衝擊，舊的結構垮掉，你才有空間重來；寶劍三落在資源：你手上的本錢是那次看清真相的痛，它讓你不會再被同樣的事騙。
     - 正面的牌落在負面位置（障礙、負面影響、恐懼）：不是「沒什麼麻煩」，而是麻煩出在好事本身。
       例如太陽落在障礙：太順、太樂觀，讓你忽略了該防的風險；聖杯十落在負面影響：為了維持表面的和樂，該講的話一直沒講。
     - 這只是示範怎麼依位置轉換讀法，不要沿用這裡的字句。
   - 焦點牌、把結果拉最多的牌、結果位置的牌寫得詳細一點（可用項目清單列出可能出現的場面）；其他位置兩三句講清楚就好。
   - 宮廷牌除了狀態版，再補一句把它當成「一個具體的人」的版本，用這次問題裡的畫面寫（會遇到什麼樣的人、會發生什麼互動）。
5. ## 最後的判斷：用粗體寫出結論（例如「好不好帶：中等偏難」），點出最需要注意的一張牌，再給一到三個具體的做法。
   - 每個做法都要講清楚做什麼、什麼時候、對誰，並說明是從哪張牌推出來的。
6. ## 你可以問自己：列出兩到三個提問，讓提問者自己回答。
   - 每題都要綁在這次的牌與問題裡的具體的人或抉擇上，不要寫通用的心靈雞湯。
   - 不要和下方結語的提問重複（結語已經問了「這週能做的第一件事」這類），要問得更貼近這次處境。
   - 問「你打算怎麼辦」「你要選哪一邊」，不要問「會不會成功」。
   - 塔羅的價值在把選項與該想的事攤開，不在預告結果；這一節不要出現任何預言式的句子。

格式：
- 只用 ## 標題、項目清單（-）、粗體、→ 箭頭；不要表格、不要表情符號、不要 # 一級標題。
- 段落之間空一行。全文約 900 到 1500 字；牌陣張數多時可以寫長一些，但非關鍵位置要精簡。

以下是一篇風格範例，只參考它的語氣、節奏與結構，不要沿用它的內容或情境：

<example>
**錢幣二逆｜聖杯騎士逆｜魔術師逆**

這個班不算好帶，難處集中在秩序與情緒反應。但它不會直接失控，要花的力氣在建立規則與互動模式，不在救火。

## 事情會怎麼走

開學頭幾週，事情會一件疊一件：作業、家長聯絡、臨時活動同時來，你手上的節奏先亂掉。

這時候學生的情緒反應會把亂放大——同一個規定，有人當下心情不好就不配合，有人把你的提醒聽成針對他，於是同一件事要講好幾次。

錢幣二逆 → 聖杯騎士逆：事情本來就多到顧不過來，學生的情緒又讓每件事都多花一倍力氣，兩邊互相加碼。

撐到學期中，問題會落在「講過了」和「做到了」之間的落差：規則是有的，但沒有一套不受情緒影響的執行方式，所以每次都要重新拉扯。

## 現況｜錢幣二逆

事情多到顧不過來，而且你還在試著每件都顧到——這正是亂的來源。

## 挑戰｜聖杯騎士逆

這張是整組的焦點，班上的氣氛主要由它決定。

- 當下心情不好，就不配合
- 用自己的情緒去解讀你的話
- 一個人鬧情緒，旁邊幾個跟著起鬨

如果把它當成一個具體的人：班上會有一兩個情緒帶頭的學生，搞定他們，其他人就跟著穩下來。

## 對策｜魔術師逆

對策位抽到逆位的魔術師，解法不在多想幾招，而在把手上已有的規則真的執行到底；招式越多，學生越覺得只是說說。

## 最後的判斷

**好不好帶：中等偏難。**

最需要注意的是魔術師逆：有人會測試你的底線，看規則是不是說說而已。

- 開學第一週就把三條最重要的規則寫在黑板上，第一次有人違反就照規則處理，不要先講道理。
- 找出那一兩個帶頭的學生，私下先談，讓他們知道你注意到了。

## 你可以問自己

- 哪一條規則是你這學期絕對不退讓的？如果只能守一條，是哪一條？
- 那個最常帶頭鬧情緒的學生，你打算先跟他建立關係，還是先讓他知道底線？
</example>`

// 問題和股市有關、而且查到了市場資料時，附加在系統提示後面。
// 這時解讀以數據分析為主、牌面為輔，結構也換成這一套（取代上面的「結構」與字數要求）。
const MARKET_INSTRUCTIONS = `這次的問題和股市有關，資料裡附上了 <market_data>（查詢當下的報價與技術指標）。這次的解讀以**市場數據分析為主、牌面為輔**，以下規則優先於上面的結構與字數要求：

數據的使用：
- 價格、漲跌、指標數字**只能用 <market_data> 裡有的**，不可以自行編造或回憶任何價格、新聞、財報、法人買賣超、目標價。資料沒有的就不提。
- 數字照資料寫，不要改寫成其他精度；提到價位時要說明它來自哪裡（例如「MA20 的 46,680」「近 20 日低點 41,855」）。
- 資料是盤中時，要提醒收盤前還會變動；資料是收盤時，要寫出是哪一天的收盤。
- <market_data> 的備註寫著查不到或從缺的，要在開場一句話交代，並說明這會讓判斷少了哪一塊。
- 數據和牌面方向不一致時，**以數據為準**，牌面用來提醒操作心態與風險，不可以拿牌面推翻數據。上面「指向分析的結論必須一致」那條，在這裡只適用於牌面補充那一節。

分析的方法：
- 趨勢：看現價與 MA5／MA20／MA60 的相對位置、均線排列（多頭排列、空頭排列或糾結）、近 5／20／60 日漲跌。
- 動能：RSI 高於 70 偏過熱、低於 30 偏超賣；KD 看黃金交叉或死亡交叉、是否鈍化；MACD 看柱體正負與擴大或收斂。
- 量能：放量或量縮，搭配漲跌判斷是追價、恐慌賣壓還是觀望。
- 支撐與壓力：只用資料裡的「支撐」「壓力」與均線、近 20／60 日高低點。
- 資料裡的「判讀」（均線排列、站上或跌破月線、RSI、KD、MACD、量能）已經算好，畫面上也會顯示同一份；你的分析要和它一致，重點是解釋這些訊號放在一起代表什麼，不要逐條重念。
- 判斷要明確：給出短線（數日到兩週）的方向判斷——偏多、偏空或區間整理——以及支持這個判斷的兩三個最關鍵的數據理由。
- 預測要寫成有條件的情境，每個情境都要有觸發價位：「站回某價位就……，跌破某價位就……」。

歷史回測與機器學習（資料裡有才寫）：
- 引用訊號當理由時，要附上這個訊號在這檔標的的歷史表現（出現次數、10 日上漲機率），並和基準比較。有沒有優勢以資料裡每個訊號的「結論」為準（依出現次數算出合理範圍，次數少時要差更多才算），不要自己用差幾個百分點重判；結論是沒有明顯優勢的，要直說「這個訊號在這檔股票上沒有明顯優勢」，不能拿它當主要理由。樣本不足的訊號要註明。
- 策略回測：說出哪個策略過去表現最好、技術策略有沒有贏過買進持有、代價是多大的回落；如果都輸給買進持有，要直說技術操作在這檔股票上不划算。
- 資料裡的「操作建議（規則計算）」是畫面上也會顯示的結論。你的方向判斷、停損與目標價**必須和它一致**，不可以給出相反的方向或不同的停損；你的工作是解釋為什麼、補上情境細節，以及牌面對操作心態的提醒。
- 籌碼（法人買賣超、融資）與估值（本益比百分位）有提供時要納入：法人連續買賣超是重要佐證；估值偏貴要提醒追高風險。
- 分段驗證：前後期方向相反的訊號、兩段沒有都贏過買進持有的策略，要說明它們可能只是剛好適合過去。
- 機器學習：寫出上漲機率，並同時寫出樣本外準確率與基準。標示不可靠時，要明講「模型沒有贏過基準，不要拿這個機率做決定」，結論不能建立在它上面。

結構（使用 Markdown，取代上面的結構）：
1. 第一行列出牌面，格式同上，用粗體。
2. 開場一段：直接給結論（方向判斷＋最關鍵的一個價位），一兩句話。
3. ## 行情現況：用資料講現在的價位、漲跌、在均線的哪一側、近期跌了或漲了多少。有多個標的時分開寫，最後一句比較它們的強弱。
4. ## 技術面判斷：趨勢、動能、量能各一段，最後列出支撐與壓力價位（項目清單）。
4-1. ## 歷史回測與模型：資料裡有回測或機器學習時才寫這節。先講目前訊號過去的勝率與基準的差距，再講策略比較，最後講模型的機率與可信度。用數字說話，三到六個項目即可。
5. ## 牌面怎麼補充：整組牌只用一節講完，不要每個位置各開一節。挑最關鍵的兩三張，講它們對「你這次的操作」提醒了什麼（進場的心態、忽略的風險、該守的紀律）。牌不能拿來預測價格。
6. ## 情境與操作：列出兩到三個情境，每個都要有觸發價位、代表的意義、對應的做法（進場、加碼、減碼、停損或觀望）。停損價位要具體。
7. ## 最後的判斷：用粗體寫出結論（例如「短線方向：偏空，等站回 MA5 再說」），再點出最需要盯的一個價位與一個指標。

格式：只用 ## 標題、項目清單（-）、粗體、→ 箭頭；不要表格、不要表情符號。全文約 900 到 1500 字。不要寫「你可以問自己」那一節。`

function buildSystemPrompt(market) {
  return market ? `${SYSTEM_PROMPT}\n\n${MARKET_INSTRUCTIONS}` : SYSTEM_PROMPT
}

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

function buildUserMessage({ reading, cards, market = null }) {
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

${market ? `<market_data>\n${formatMarketForPrompt(market)}\n</market_data>\n\n` : ''}請依照上述資料撰寫這次的解讀。`
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
// market：buildMarketSnapshot 的結果；問題和股市無關時為 null
async function streamNarration({ reading, cards, market = null, signal, onStart, onDelta }) {
  return streamChat({
    messages: [
      { role: 'system', content: buildSystemPrompt(market) },
      { role: 'user', content: buildUserMessage({ reading, cards, market }) },
    ],
    signal,
    onStart,
    onDelta,
  })
}

// 對 OpenRouter 發出串流請求，塔羅解讀與個股 AI 分析共用。回傳 { model }
// OpenRouter 超過這麼久沒有送任何東西（連處理中的註解都沒有）就當成卡住，主動中止，不要等到整體逾時
const IDLE_TIMEOUT_MS = 90_000

class AiStalledError extends Error {}

async function streamChat({ messages, signal, onStart, onDelta, idleTimeoutMs = IDLE_TIMEOUT_MS }) {
  const idle = new AbortController()
  let idleTimer = null
  const touch = () => {
    if (idleTimer) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => idle.abort(new AiStalledError(`AI 超過 ${Math.round(idleTimeoutMs / 1000)} 秒沒有回應`)), idleTimeoutMs)
  }
  touch()
  try {
    return await streamChatInner({ messages, signal: AbortSignal.any([signal, idle.signal]), onStart, onDelta, touch })
  } catch (error) {
    // 卡住而中止的，丟出看得懂的錯誤（不要被當成使用者停止）
    if (idle.signal.aborted && !signal.aborted) throw idle.signal.reason
    throw error
  } finally {
    if (idleTimer) clearTimeout(idleTimer)
  }
}

async function streamChatInner({ messages, signal, onStart, onDelta, touch }) {
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
      messages,
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
    touch()
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
  MARKET_INSTRUCTIONS,
  buildSystemPrompt,
  isNarrationAvailable,
  streamNarration,
  streamChat,
  buildUserMessage,
  createSseParser,
  NarrationRefusedError,
}
