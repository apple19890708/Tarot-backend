// 人工精選的牌對組合（第一層，永遠蓋過 AI 生成）
// 本檔由 scripts/buildCuratedPairs.js 產生，不要直接編輯；
// 要改內容請改該腳本的 COMBOS 後重新執行。
// 組合數：33　筆數：132（每組四種正逆位）

const CURATED_PAIRS = [
  {
    "key": "major-16-the-tower|upright>major-13-death|upright",
    "domain": "any",
    "fromName": "塔",
    "toName": "死神",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "劇變之後緊接著徹底的結束，這不是能挽回的調整，而是整個階段被收掉重來。"
  },
  {
    "key": "major-16-the-tower|upright>major-13-death|reversed",
    "domain": "any",
    "fromName": "塔",
    "toName": "死神",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "劇變已經發生，但該結束的還沒真正結束，有些東西被硬留著。"
  },
  {
    "key": "major-16-the-tower|reversed>major-13-death|upright",
    "domain": "any",
    "fromName": "塔",
    "toName": "死神",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "崩解的力道被壓著沒爆開，結局卻已經確定，像是在等一個早知道的答案。"
  },
  {
    "key": "major-16-the-tower|reversed>major-13-death|reversed",
    "domain": "any",
    "fromName": "塔",
    "toName": "死神",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "劇變與結束都卡在半路，事情懸著不上不下，拖著比斷掉更耗人。"
  },
  {
    "key": "major-15-the-devil|upright>major-16-the-tower|upright",
    "domain": "any",
    "fromName": "惡魔",
    "toName": "塔",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "長期的束縛被外力強制打破，過程不舒服，但那個綁住你的東西確實鬆開了。"
  },
  {
    "key": "major-15-the-devil|upright>major-16-the-tower|reversed",
    "domain": "any",
    "fromName": "惡魔",
    "toName": "塔",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "束縛還在，崩解的力道卻使不太出來，想掙脫卻掙不開。"
  },
  {
    "key": "major-15-the-devil|reversed>major-16-the-tower|upright",
    "domain": "any",
    "fromName": "惡魔",
    "toName": "塔",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "執著已經鬆動，接著是結構性的崩塌，這一下會打掉不少舊東西。"
  },
  {
    "key": "major-15-the-devil|reversed>major-16-the-tower|reversed",
    "domain": "any",
    "fromName": "惡魔",
    "toName": "塔",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "綁住你的和該垮的都還懸著，表面維持原狀，底下已經在鬆動。"
  },
  {
    "key": "major-12-the-hanged-man|upright>major-13-death|upright",
    "domain": "any",
    "fromName": "吊人",
    "toName": "死神",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "長期的停滯終於走到結束，那段懸著的日子要收尾了。"
  },
  {
    "key": "major-12-the-hanged-man|upright>major-13-death|reversed",
    "domain": "any",
    "fromName": "吊人",
    "toName": "死神",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "停滯還在，該結束的卻遲遲沒結束，兩邊都卡著。"
  },
  {
    "key": "major-12-the-hanged-man|reversed>major-13-death|upright",
    "domain": "any",
    "fromName": "吊人",
    "toName": "死神",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "不再硬撐之後，轉變自然發生，放手反而讓事情動起來。"
  },
  {
    "key": "major-12-the-hanged-man|reversed>major-13-death|reversed",
    "domain": "any",
    "fromName": "吊人",
    "toName": "死神",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "停滯與結束都沒真正發生，事情維持在最消耗的那個狀態。"
  },
  {
    "key": "major-13-death|upright>major-21-the-world|upright",
    "domain": "any",
    "fromName": "死神",
    "toName": "世界",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "結束之後迎來完整的收尾，這個階段是真的走完了，不留尾巴。"
  },
  {
    "key": "major-13-death|upright>major-21-the-world|reversed",
    "domain": "any",
    "fromName": "死神",
    "toName": "世界",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "結束已成定局，圓滿卻還沒到位，收尾的最後一哩還缺。"
  },
  {
    "key": "major-13-death|reversed>major-21-the-world|upright",
    "domain": "any",
    "fromName": "死神",
    "toName": "世界",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "該結束的被拖著，但整體其實已經接近完成，差的只是承認它結束了。"
  },
  {
    "key": "major-13-death|reversed>major-21-the-world|reversed",
    "domain": "any",
    "fromName": "死神",
    "toName": "世界",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "結束與完成都懸著，事情看起來收了，實際上還沒真的放下。"
  },
  {
    "key": "major-20-judgement|upright>major-21-the-world|upright",
    "domain": "any",
    "fromName": "審判",
    "toName": "世界",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "聽見召喚並做出回應，然後抵達完成，這是覺醒之後該有的結果。"
  },
  {
    "key": "major-20-judgement|upright>major-21-the-world|reversed",
    "domain": "any",
    "fromName": "審判",
    "toName": "世界",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "覺醒已經發生，圓滿卻還沒落地，知道了但還沒做到。"
  },
  {
    "key": "major-20-judgement|reversed>major-21-the-world|upright",
    "domain": "any",
    "fromName": "審判",
    "toName": "世界",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "遲遲沒有回應召喚，但整體已經接近完成，差一個決定。"
  },
  {
    "key": "major-20-judgement|reversed>major-21-the-world|reversed",
    "domain": "any",
    "fromName": "審判",
    "toName": "世界",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "該醒的還沒醒，該完成的也還沒完成，兩邊都在等。"
  },
  {
    "key": "major-0-the-fool|upright>major-21-the-world|upright",
    "domain": "any",
    "fromName": "愚人",
    "toName": "世界",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "起點與終點同時出現，一段旅程剛結束，下一段已經在招手。"
  },
  {
    "key": "major-0-the-fool|upright>major-21-the-world|reversed",
    "domain": "any",
    "fromName": "愚人",
    "toName": "世界",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "新的開始出現了，但前一段還沒真正收完，帶著未了的事往前走。"
  },
  {
    "key": "major-0-the-fool|reversed>major-21-the-world|upright",
    "domain": "any",
    "fromName": "愚人",
    "toName": "世界",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "還沒準備好重新開始，眼前這一段卻已經走到盡頭。"
  },
  {
    "key": "major-0-the-fool|reversed>major-21-the-world|reversed",
    "domain": "any",
    "fromName": "愚人",
    "toName": "世界",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "不敢重新開始，也不願承認結束，停在兩段之間。"
  },
  {
    "key": "major-18-the-moon|upright>major-17-the-star|upright",
    "domain": "any",
    "fromName": "月亮",
    "toName": "星星",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "迷霧之後出現指引，不安還在，但方向比先前清楚了。"
  },
  {
    "key": "major-18-the-moon|upright>major-17-the-star|reversed",
    "domain": "any",
    "fromName": "月亮",
    "toName": "星星",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "還在迷霧裡，希望卻顯得遙遠，看得到卻不太敢相信。"
  },
  {
    "key": "major-18-the-moon|reversed>major-17-the-star|upright",
    "domain": "any",
    "fromName": "月亮",
    "toName": "星星",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "不安正在消退，療癒與方向隨之而來，這是好轉的順序。"
  },
  {
    "key": "major-18-the-moon|reversed>major-17-the-star|reversed",
    "domain": "any",
    "fromName": "月亮",
    "toName": "星星",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "迷惘與希望都使不太上力，整體偏向消沉。"
  },
  {
    "key": "major-9-the-hermit|upright>major-17-the-star|upright",
    "domain": "any",
    "fromName": "隱士",
    "toName": "星星",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "向內尋找之後得到方向，獨處那段時間沒有白費。"
  },
  {
    "key": "major-9-the-hermit|upright>major-17-the-star|reversed",
    "domain": "any",
    "fromName": "隱士",
    "toName": "星星",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "願意內省，但還看不到指引，沉澱的時間可能要再久一點。"
  },
  {
    "key": "major-9-the-hermit|reversed>major-17-the-star|upright",
    "domain": "any",
    "fromName": "隱士",
    "toName": "星星",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "抗拒獨處，答案卻已經在那裡，只是需要安靜下來才聽得見。"
  },
  {
    "key": "major-9-the-hermit|reversed>major-17-the-star|reversed",
    "domain": "any",
    "fromName": "隱士",
    "toName": "星星",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "既不願沉澱也看不見方向，這段時間容易原地打轉。"
  },
  {
    "key": "major-2-the-high-priestess|upright>major-18-the-moon|upright",
    "domain": "any",
    "fromName": "女祭司",
    "toName": "月亮",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "直覺與潛意識疊在一起，感受很準，但也容易被不安放大。"
  },
  {
    "key": "major-2-the-high-priestess|upright>major-18-the-moon|reversed",
    "domain": "any",
    "fromName": "女祭司",
    "toName": "月亮",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "直覺清楚，不安正在退去，可以相信自己的判斷。"
  },
  {
    "key": "major-2-the-high-priestess|reversed>major-18-the-moon|upright",
    "domain": "any",
    "fromName": "女祭司",
    "toName": "月亮",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "直覺被理性壓著，不安卻越來越明顯，這組合容易睡不好。"
  },
  {
    "key": "major-2-the-high-priestess|reversed>major-18-the-moon|reversed",
    "domain": "any",
    "fromName": "女祭司",
    "toName": "月亮",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "內在訊息與不安都糊成一團，現在不是做判斷的時候。"
  },
  {
    "key": "major-8-strength|upright>major-15-the-devil|upright",
    "domain": "any",
    "fromName": "力量",
    "toName": "惡魔",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "以柔韌的意志面對慾望或執著，不是壓制，而是跟它共處。"
  },
  {
    "key": "major-8-strength|upright>major-15-the-devil|reversed",
    "domain": "any",
    "fromName": "力量",
    "toName": "惡魔",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "意志還在，束縛正在鬆動，你撐住了。"
  },
  {
    "key": "major-8-strength|reversed>major-15-the-devil|upright",
    "domain": "any",
    "fromName": "力量",
    "toName": "惡魔",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "意志使不上力，執著卻很強勢，這時候容易被牽著走。"
  },
  {
    "key": "major-8-strength|reversed>major-15-the-devil|reversed",
    "domain": "any",
    "fromName": "力量",
    "toName": "惡魔",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "力氣和綁住你的東西都消耗著，兩邊僵持不下。"
  },
  {
    "key": "major-14-temperance|upright>major-15-the-devil|upright",
    "domain": "any",
    "fromName": "節制",
    "toName": "惡魔",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "節制與放縱正面對上，中道走得辛苦但走得住。"
  },
  {
    "key": "major-14-temperance|upright>major-15-the-devil|reversed",
    "domain": "any",
    "fromName": "節制",
    "toName": "惡魔",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "節制還在，過度的那一面正在收斂。"
  },
  {
    "key": "major-14-temperance|reversed>major-15-the-devil|upright",
    "domain": "any",
    "fromName": "節制",
    "toName": "惡魔",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "該節制的失了分寸，放縱佔了上風。"
  },
  {
    "key": "major-14-temperance|reversed>major-15-the-devil|reversed",
    "domain": "any",
    "fromName": "節制",
    "toName": "惡魔",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "節制與放縱都失去張力，整體偏向麻木。"
  },
  {
    "key": "major-19-the-sun|upright>major-21-the-world|upright",
    "domain": "any",
    "fromName": "太陽",
    "toName": "世界",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "喜悅與圓滿接連出現，這組合少有保留，事情是真的成了。"
  },
  {
    "key": "major-19-the-sun|upright>major-21-the-world|reversed",
    "domain": "any",
    "fromName": "太陽",
    "toName": "世界",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "明朗已經到位，完整的收尾還差一步。"
  },
  {
    "key": "major-19-the-sun|reversed>major-21-the-world|upright",
    "domain": "any",
    "fromName": "太陽",
    "toName": "世界",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "喜悅被壓著沒展開，但整體其實已經圓滿。"
  },
  {
    "key": "major-19-the-sun|reversed>major-21-the-world|reversed",
    "domain": "any",
    "fromName": "太陽",
    "toName": "世界",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "明朗與圓滿都還沒真正落地，好事在路上但還沒到。"
  },
  {
    "key": "major-10-wheel-of-fortune|upright>major-11-justice|upright",
    "domain": "any",
    "fromName": "命運之輪",
    "toName": "正義",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "際遇轉動之後由因果結帳，這一輪的結果跟你先前的作為有關。"
  },
  {
    "key": "major-10-wheel-of-fortune|upright>major-11-justice|reversed",
    "domain": "any",
    "fromName": "命運之輪",
    "toName": "正義",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "轉機來了，公正的結算卻還沒到位。"
  },
  {
    "key": "major-10-wheel-of-fortune|reversed>major-11-justice|upright",
    "domain": "any",
    "fromName": "命運之輪",
    "toName": "正義",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "時機沒轉過來，但該算的帳還是會算。"
  },
  {
    "key": "major-10-wheel-of-fortune|reversed>major-11-justice|reversed",
    "domain": "any",
    "fromName": "命運之輪",
    "toName": "正義",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "際遇與因果都懸著，事情卡在尚未定論的階段。"
  },
  {
    "key": "major-4-the-emperor|upright>major-16-the-tower|upright",
    "domain": "any",
    "fromName": "皇帝",
    "toName": "塔",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "既有的秩序與結構被打掉，原本以為穩固的那套不管用了。"
  },
  {
    "key": "major-4-the-emperor|upright>major-16-the-tower|reversed",
    "domain": "any",
    "fromName": "皇帝",
    "toName": "塔",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "結構還在，崩解的力道暫時被擋住。"
  },
  {
    "key": "major-4-the-emperor|reversed>major-16-the-tower|upright",
    "domain": "any",
    "fromName": "皇帝",
    "toName": "塔",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "權威本來就鬆動，接著是整個結構垮下來。"
  },
  {
    "key": "major-4-the-emperor|reversed>major-16-the-tower|reversed",
    "domain": "any",
    "fromName": "皇帝",
    "toName": "塔",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "舊秩序與崩塌都僵著，表面撐住，內裡已空。"
  },
  {
    "key": "major-6-the-lovers|upright>major-15-the-devil|upright",
    "domain": "any",
    "fromName": "戀人",
    "toName": "惡魔",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "關係裡的結合帶著執著與依附，吸引力很強，但未必自由。"
  },
  {
    "key": "major-6-the-lovers|upright>major-15-the-devil|reversed",
    "domain": "any",
    "fromName": "戀人",
    "toName": "惡魔",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "關係是真的，綁住的那一面正在鬆開。"
  },
  {
    "key": "major-6-the-lovers|reversed>major-15-the-devil|upright",
    "domain": "any",
    "fromName": "戀人",
    "toName": "惡魔",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "關係本身有裂痕，依附卻更強烈，這是容易放不掉的組合。"
  },
  {
    "key": "major-6-the-lovers|reversed>major-15-the-devil|reversed",
    "domain": "any",
    "fromName": "戀人",
    "toName": "惡魔",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "感情與執著都在消耗，兩個人都累。"
  },
  {
    "key": "major-1-the-magician|upright>major-7-the-chariot|upright",
    "domain": "any",
    "fromName": "魔術師",
    "toName": "戰車",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "能力齊備又全速推進，這是少見的順風組合，想做的事推得動。"
  },
  {
    "key": "major-1-the-magician|upright>major-7-the-chariot|reversed",
    "domain": "any",
    "fromName": "魔術師",
    "toName": "戰車",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "資源到位，推進的力道卻卡住了。"
  },
  {
    "key": "major-1-the-magician|reversed>major-7-the-chariot|upright",
    "domain": "any",
    "fromName": "魔術師",
    "toName": "戰車",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "手上的牌還沒整合好就急著往前衝。"
  },
  {
    "key": "major-1-the-magician|reversed>major-7-the-chariot|reversed",
    "domain": "any",
    "fromName": "魔術師",
    "toName": "戰車",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "能力與衝勁都使不出來，空有想法。"
  },
  {
    "key": "major-6-the-lovers|upright>minor-2-two-of-swords|upright",
    "domain": "any",
    "fromName": "戀人",
    "toName": "寶劍二",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "關係走到必須選的時候，你卻刻意不看清楚。"
  },
  {
    "key": "major-6-the-lovers|upright>minor-2-two-of-swords|reversed",
    "domain": "any",
    "fromName": "戀人",
    "toName": "寶劍二",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "該選的還是得選，迴避正在失效。"
  },
  {
    "key": "major-6-the-lovers|reversed>minor-2-two-of-swords|upright",
    "domain": "any",
    "fromName": "戀人",
    "toName": "寶劍二",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "關係本身有問題，而你用不做決定來拖延。"
  },
  {
    "key": "major-6-the-lovers|reversed>minor-2-two-of-swords|reversed",
    "domain": "any",
    "fromName": "戀人",
    "toName": "寶劍二",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "感情與抉擇都懸著，拖得越久越難處理。"
  },
  {
    "key": "major-13-death|upright>minor-8-eight-of-cups|upright",
    "domain": "any",
    "fromName": "死神",
    "toName": "聖杯八",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "結束與主動離開方向一致，這不是被迫，是你自己要走。"
  },
  {
    "key": "major-13-death|upright>minor-8-eight-of-cups|reversed",
    "domain": "any",
    "fromName": "死神",
    "toName": "聖杯八",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "該結束的已經結束，但你還沒真的動身。"
  },
  {
    "key": "major-13-death|reversed>minor-8-eight-of-cups|upright",
    "domain": "any",
    "fromName": "死神",
    "toName": "聖杯八",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "捨不得結束，腳步卻已經在往外走。"
  },
  {
    "key": "major-13-death|reversed>minor-8-eight-of-cups|reversed",
    "domain": "any",
    "fromName": "死神",
    "toName": "聖杯八",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "結束與離開都卡著，人留在原地，心已經不在。"
  },
  {
    "key": "major-16-the-tower|upright>minor-5-five-of-pentacles|upright",
    "domain": "any",
    "fromName": "塔",
    "toName": "錢幣五",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "劇變之後是現實面的匱乏，衝擊會具體反映在資源上。"
  },
  {
    "key": "major-16-the-tower|upright>minor-5-five-of-pentacles|reversed",
    "domain": "any",
    "fromName": "塔",
    "toName": "錢幣五",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "劇變發生了，但匱乏正在改善，最壞的過去了。"
  },
  {
    "key": "major-16-the-tower|reversed>minor-5-five-of-pentacles|upright",
    "domain": "any",
    "fromName": "塔",
    "toName": "錢幣五",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "崩塌還沒發生，拮据卻已經開始。"
  },
  {
    "key": "major-16-the-tower|reversed>minor-5-five-of-pentacles|reversed",
    "domain": "any",
    "fromName": "塔",
    "toName": "錢幣五",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "劇變與匱乏都懸著，撐著但不輕鬆。"
  },
  {
    "key": "major-19-the-sun|upright>minor-10-ten-of-cups|upright",
    "domain": "any",
    "fromName": "太陽",
    "toName": "聖杯十",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "明朗與情感圓滿同時出現，這是整副牌裡最好的組合之一。"
  },
  {
    "key": "major-19-the-sun|upright>minor-10-ten-of-cups|reversed",
    "domain": "any",
    "fromName": "太陽",
    "toName": "聖杯十",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "外在順利，情感面的圓滿還差一點。"
  },
  {
    "key": "major-19-the-sun|reversed>minor-10-ten-of-cups|upright",
    "domain": "any",
    "fromName": "太陽",
    "toName": "聖杯十",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "喜悅被壓著，但關係本身是穩的。"
  },
  {
    "key": "major-19-the-sun|reversed>minor-10-ten-of-cups|reversed",
    "domain": "any",
    "fromName": "太陽",
    "toName": "聖杯十",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "順利與圓滿都還沒到位，好的部分需要時間。"
  },
  {
    "key": "major-15-the-devil|upright>minor-8-eight-of-swords|upright",
    "domain": "any",
    "fromName": "惡魔",
    "toName": "寶劍八",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "束縛其實來自自我設限，綁住你的不是外面，是你以為自己動不了。"
  },
  {
    "key": "major-15-the-devil|upright>minor-8-eight-of-swords|reversed",
    "domain": "any",
    "fromName": "惡魔",
    "toName": "寶劍八",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "執著還在，但你開始看見其實有路可走。"
  },
  {
    "key": "major-15-the-devil|reversed>minor-8-eight-of-swords|upright",
    "domain": "any",
    "fromName": "惡魔",
    "toName": "寶劍八",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "鬆動已經開始，自我設限卻更明顯。"
  },
  {
    "key": "major-15-the-devil|reversed>minor-8-eight-of-swords|reversed",
    "domain": "any",
    "fromName": "惡魔",
    "toName": "寶劍八",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "束縛與受困都在鬆動，可以開始找出口了。"
  },
  {
    "key": "major-17-the-star|upright>minor-1-ace-of-cups|upright",
    "domain": "any",
    "fromName": "星星",
    "toName": "聖杯王牌",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "療癒之後新的感情開始流動，這是從修復走向開啟。"
  },
  {
    "key": "major-17-the-star|upright>minor-1-ace-of-cups|reversed",
    "domain": "any",
    "fromName": "星星",
    "toName": "聖杯王牌",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "希望還在，新的情感卻還沒真的開始。"
  },
  {
    "key": "major-17-the-star|reversed>minor-1-ace-of-cups|upright",
    "domain": "any",
    "fromName": "星星",
    "toName": "聖杯王牌",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "療癒卡著，新的感受倒是先來了。"
  },
  {
    "key": "major-17-the-star|reversed>minor-1-ace-of-cups|reversed",
    "domain": "any",
    "fromName": "星星",
    "toName": "聖杯王牌",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "療癒與新開始都還沒成形，再等等。"
  },
  {
    "key": "minor-3-three-of-swords|upright>minor-5-five-of-cups|upright",
    "domain": "any",
    "fromName": "寶劍三",
    "toName": "聖杯五",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "心碎之後是持續的失落，痛過了還要再經歷一段消化期。"
  },
  {
    "key": "minor-3-three-of-swords|upright>minor-5-five-of-cups|reversed",
    "domain": "any",
    "fromName": "寶劍三",
    "toName": "聖杯五",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "傷口已經造成，但你開始看見還剩下什麼。"
  },
  {
    "key": "minor-3-three-of-swords|reversed>minor-5-five-of-cups|upright",
    "domain": "any",
    "fromName": "寶劍三",
    "toName": "聖杯五",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "傷痛被壓著沒處理，失落卻浮上來。"
  },
  {
    "key": "minor-3-three-of-swords|reversed>minor-5-five-of-cups|reversed",
    "domain": "any",
    "fromName": "寶劍三",
    "toName": "聖杯五",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "心碎與失落都悶著，整體偏向停滯。"
  },
  {
    "key": "minor-9-nine-of-swords|upright>minor-10-ten-of-swords|upright",
    "domain": "any",
    "fromName": "寶劍九",
    "toName": "寶劍十",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "焦慮一路走到谷底，這是最難受的一段，但谷底之後就是結束。"
  },
  {
    "key": "minor-9-nine-of-swords|upright>minor-10-ten-of-swords|reversed",
    "domain": "any",
    "fromName": "寶劍九",
    "toName": "寶劍十",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "焦慮還在，最糟的狀況正在過去。"
  },
  {
    "key": "minor-9-nine-of-swords|reversed>minor-10-ten-of-swords|upright",
    "domain": "any",
    "fromName": "寶劍九",
    "toName": "寶劍十",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "焦慮正在緩解，但結束已成定局。"
  },
  {
    "key": "minor-9-nine-of-swords|reversed>minor-10-ten-of-swords|reversed",
    "domain": "any",
    "fromName": "寶劍九",
    "toName": "寶劍十",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "焦慮與結束都懸著，事情拖在最消耗的位置。"
  },
  {
    "key": "minor-8-eight-of-pentacles|upright>minor-9-nine-of-pentacles|upright",
    "domain": "any",
    "fromName": "錢幣八",
    "toName": "錢幣九",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "踏實累積換來實際的收穫，這是努力有回報的標準流程。"
  },
  {
    "key": "minor-8-eight-of-pentacles|upright>minor-9-nine-of-pentacles|reversed",
    "domain": "any",
    "fromName": "錢幣八",
    "toName": "錢幣九",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "努力在進行，收穫還沒到位。"
  },
  {
    "key": "minor-8-eight-of-pentacles|reversed>minor-9-nine-of-pentacles|upright",
    "domain": "any",
    "fromName": "錢幣八",
    "toName": "錢幣九",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "練習不夠扎實，成果卻先來了，根基需要補。"
  },
  {
    "key": "minor-8-eight-of-pentacles|reversed>minor-9-nine-of-pentacles|reversed",
    "domain": "any",
    "fromName": "錢幣八",
    "toName": "錢幣九",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "努力與收穫都縮水，進度比預期慢。"
  },
  {
    "key": "minor-9-nine-of-pentacles|upright>minor-10-ten-of-pentacles|upright",
    "domain": "any",
    "fromName": "錢幣九",
    "toName": "錢幣十",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "個人的豐收擴大成長期的穩定，從自己過得好走到整體都安穩。"
  },
  {
    "key": "minor-9-nine-of-pentacles|upright>minor-10-ten-of-pentacles|reversed",
    "domain": "any",
    "fromName": "錢幣九",
    "toName": "錢幣十",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "個人狀況不錯，整體的穩固還在建立。"
  },
  {
    "key": "minor-9-nine-of-pentacles|reversed>minor-10-ten-of-pentacles|upright",
    "domain": "any",
    "fromName": "錢幣九",
    "toName": "錢幣十",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "個人還沒到位，但大環境的支撐是在的。"
  },
  {
    "key": "minor-9-nine-of-pentacles|reversed>minor-10-ten-of-pentacles|reversed",
    "domain": "any",
    "fromName": "錢幣九",
    "toName": "錢幣十",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "豐收與穩定都還沒落實，基礎需要再打。"
  },
  {
    "key": "minor-2-two-of-cups|upright>minor-10-ten-of-cups|upright",
    "domain": "any",
    "fromName": "聖杯二",
    "toName": "聖杯十",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "關係從兩人的結合走向整體的圓滿，發展方向很清楚。"
  },
  {
    "key": "minor-2-two-of-cups|upright>minor-10-ten-of-cups|reversed",
    "domain": "any",
    "fromName": "聖杯二",
    "toName": "聖杯十",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "關係建立了，長遠的圓滿還需要時間。"
  },
  {
    "key": "minor-2-two-of-cups|reversed>minor-10-ten-of-cups|upright",
    "domain": "any",
    "fromName": "聖杯二",
    "toName": "聖杯十",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "兩人之間還沒對上，但整體的條件是好的。"
  },
  {
    "key": "minor-2-two-of-cups|reversed>minor-10-ten-of-cups|reversed",
    "domain": "any",
    "fromName": "聖杯二",
    "toName": "聖杯十",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "結合與圓滿都卡著，關係進展緩慢。"
  },
  {
    "key": "minor-10-ten-of-wands|upright>minor-5-five-of-pentacles|upright",
    "domain": "any",
    "fromName": "權杖十",
    "toName": "錢幣五",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "過度承擔加上資源匱乏，這是容易把人壓垮的組合，該放下一些了。"
  },
  {
    "key": "minor-10-ten-of-wands|upright>minor-5-five-of-pentacles|reversed",
    "domain": "any",
    "fromName": "權杖十",
    "toName": "錢幣五",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "重擔還在，但匱乏正在改善。"
  },
  {
    "key": "minor-10-ten-of-wands|reversed>minor-5-five-of-pentacles|upright",
    "domain": "any",
    "fromName": "權杖十",
    "toName": "錢幣五",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "擔子正在卸下，拮据卻浮現。"
  },
  {
    "key": "minor-10-ten-of-wands|reversed>minor-5-five-of-pentacles|reversed",
    "domain": "any",
    "fromName": "權杖十",
    "toName": "錢幣五",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "重擔與匱乏都懸著，狀態疲乏。"
  },
  {
    "key": "minor-8-eight-of-wands|upright>minor-3-three-of-cups|upright",
    "domain": "any",
    "fromName": "權杖八",
    "toName": "聖杯三",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "好消息快速傳開並帶來歡聚，這組合動得很快。"
  },
  {
    "key": "minor-8-eight-of-wands|upright>minor-3-three-of-cups|reversed",
    "domain": "any",
    "fromName": "權杖八",
    "toName": "聖杯三",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "消息傳開了，但聚在一起的時機還沒到。"
  },
  {
    "key": "minor-8-eight-of-wands|reversed>minor-3-three-of-cups|upright",
    "domain": "any",
    "fromName": "權杖八",
    "toName": "聖杯三",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "訊息卡住，但該慶祝的還是發生了。"
  },
  {
    "key": "minor-8-eight-of-wands|reversed>minor-3-three-of-cups|reversed",
    "domain": "any",
    "fromName": "權杖八",
    "toName": "聖杯三",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "消息與歡聚都延後，事情沒想像中快。"
  },
  {
    "key": "minor-4-four-of-swords|upright>minor-8-eight-of-cups|upright",
    "domain": "any",
    "fromName": "寶劍四",
    "toName": "聖杯八",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "休息之後選擇離開，這段沉澱讓你想清楚了。"
  },
  {
    "key": "minor-4-four-of-swords|upright>minor-8-eight-of-cups|reversed",
    "domain": "any",
    "fromName": "寶劍四",
    "toName": "聖杯八",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "還在休養，離開的念頭已經出現。"
  },
  {
    "key": "minor-4-four-of-swords|reversed>minor-8-eight-of-cups|upright",
    "domain": "any",
    "fromName": "寶劍四",
    "toName": "聖杯八",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "沒能好好休息，卻已經要走。"
  },
  {
    "key": "minor-4-four-of-swords|reversed>minor-8-eight-of-cups|reversed",
    "domain": "any",
    "fromName": "寶劍四",
    "toName": "聖杯八",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "休息與離開都沒真正發生，人耗在原地。"
  },
  {
    "key": "minor-12-knight-of-cups|upright>minor-2-two-of-cups|upright",
    "domain": "any",
    "fromName": "聖杯騎士",
    "toName": "聖杯二",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "主動示好之後確立關係，從單方面走向雙向。"
  },
  {
    "key": "minor-12-knight-of-cups|upright>minor-2-two-of-cups|reversed",
    "domain": "any",
    "fromName": "聖杯騎士",
    "toName": "聖杯二",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "示好是真誠的，關係卻還沒成形。"
  },
  {
    "key": "minor-12-knight-of-cups|reversed>minor-2-two-of-cups|upright",
    "domain": "any",
    "fromName": "聖杯騎士",
    "toName": "聖杯二",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "示好的方式不太對，但兩人之間確實有連結。"
  },
  {
    "key": "minor-12-knight-of-cups|reversed>minor-2-two-of-cups|reversed",
    "domain": "any",
    "fromName": "聖杯騎士",
    "toName": "聖杯二",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "示好與結合都使不上力，關係停在曖昧。"
  },
  {
    "key": "minor-14-king-of-swords|upright>major-11-justice|upright",
    "domain": "any",
    "fromName": "寶劍國王",
    "toName": "正義",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "理性判斷搭配公正結算，這組合講道理，也講證據。"
  },
  {
    "key": "minor-14-king-of-swords|upright>major-11-justice|reversed",
    "domain": "any",
    "fromName": "寶劍國王",
    "toName": "正義",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "判斷清楚，公正的結果卻還沒出來。"
  },
  {
    "key": "minor-14-king-of-swords|reversed>major-11-justice|upright",
    "domain": "any",
    "fromName": "寶劍國王",
    "toName": "正義",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "判斷帶著偏見，但該怎麼算還是會怎麼算。"
  },
  {
    "key": "minor-14-king-of-swords|reversed>major-11-justice|reversed",
    "domain": "any",
    "fromName": "寶劍國王",
    "toName": "正義",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "判斷與公正都失準，容易各說各話。"
  },
  {
    "key": "minor-14-king-of-pentacles|upright>minor-10-ten-of-pentacles|upright",
    "domain": "any",
    "fromName": "錢幣國王",
    "toName": "錢幣十",
    "fromOrientation": "upright",
    "toOrientation": "upright",
    "text": "務實經營累積成長期的家業，這是穩紮穩打的成果。"
  },
  {
    "key": "minor-14-king-of-pentacles|upright>minor-10-ten-of-pentacles|reversed",
    "domain": "any",
    "fromName": "錢幣國王",
    "toName": "錢幣十",
    "fromOrientation": "upright",
    "toOrientation": "reversed",
    "text": "經營有方，長遠的基礎還在累積。"
  },
  {
    "key": "minor-14-king-of-pentacles|reversed>minor-10-ten-of-pentacles|upright",
    "domain": "any",
    "fromName": "錢幣國王",
    "toName": "錢幣十",
    "fromOrientation": "reversed",
    "toOrientation": "upright",
    "text": "經營方式有問題，但既有的基礎還撐得住。"
  },
  {
    "key": "minor-14-king-of-pentacles|reversed>minor-10-ten-of-pentacles|reversed",
    "domain": "any",
    "fromName": "錢幣國王",
    "toName": "錢幣十",
    "fromOrientation": "reversed",
    "toOrientation": "reversed",
    "text": "經營與穩定都不紮實，根基不如表面看起來穩。"
  }
]

module.exports = { CURATED_PAIRS }
