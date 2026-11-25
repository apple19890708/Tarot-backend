// 雷諾曼的撲克花色解說表（v27，詳見 doc/v27-lenormand-plan.md 3-11）。
// 結果頁「撲克花色」區塊的固定說明，文字由後端提供，前端不自己寫。
// 雷諾曼的撲克對應沒有統一的讀法，這裡採常見說法並註明差異；黑桃分歧最大，兩種說法都列出。
// 規則 L9（階段 3）用 tone 判斷整體傾向；playingCard 為 null 的牌（37～52 待補）略過。
const { deepFreeze } = require('../../lib/deepFreeze')

const playingCardGuide = {
  title: '撲克花色代表什麼',
  disclaimer:
    '雷諾曼牌角落的撲克標記沒有統一的解讀標準，各家說法不同。這裡採較常見的讀法，只當作補充參考，解讀仍以牌義與牌的組合為主。',
  suits: [
    {
      suit: 'hearts',
      symbol: '♥',
      name: '紅心',
      color: 'red',
      tone: 'positive',
      summary: '感情、人際關係與感受',
      meaning: '和感情、家人朋友、內心感受有關，整體偏正面。紅心多時，這件事的重點往往在「人」與「心情」。',
    },
    {
      suit: 'diamonds',
      symbol: '♦',
      name: '方塊',
      color: 'red',
      tone: 'positive',
      summary: '金錢、行動力與機會',
      meaning: '和金錢、事業上的行動與能量、外來的機會有關，偏正面但起伏較大。方塊多時，事情動得快，也需要主動把握。',
    },
    {
      suit: 'clubs',
      symbol: '♣',
      name: '梅花',
      color: 'black',
      tone: 'negative',
      summary: '麻煩、責任與壓力',
      meaning: '和需要處理的麻煩、責任、壓力與複雜的狀況有關，偏挑戰。梅花多時，表示有些難題得面對，不能放著不管。',
    },
    {
      suit: 'spades',
      symbol: '♠',
      name: '黑桃',
      color: 'black',
      tone: 'negative',
      summary: '說法最分歧，整體偏挑戰',
      meaning: '黑桃是各家讀法最不一致的花色，常見的有下面兩種，整體都偏有挑戰。可以依問題的性質，看哪一種比較貼近。',
      readings: [
        { label: '說法一：工作與結構', text: '代表工作、規則、結構與穩定，也代表必須承擔的責任。' },
        { label: '說法二：溝通與移動', text: '代表溝通、移動、交通往來與法律、文書相關的事務。' },
      ],
    },
  ],
  colors: [
    { color: 'red', name: '紅色（紅心、方塊）', tone: 'positive', meaning: '偏順利、較容易推進。' },
    { color: 'black', name: '黑色（梅花、黑桃）', tone: 'negative', meaning: '偏有挑戰，需要多花力氣。' },
  ],
  colorNote: '「紅色偏順、黑色偏挑戰」是最常見的簡化讀法，只看大方向，不能取代個別牌義。',
  ranks: [
    { rank: 'K', name: '國王（K）', meaning: '可能代表某個人：偏年長、有權威或主導地位的人。' },
    { rank: 'Q', name: '皇后（Q）', meaning: '可能代表某個人：偏女性，或扮演照顧、影響角色的人。' },
    { rank: 'J', name: '侍從（J）', meaning: '可能代表某個人：偏年輕的人，或一個想法、消息。' },
    { rank: 'A', name: 'A', meaning: '重點與強調：這張牌的主題在這次占卜裡特別重要。' },
  ],
  rankNote: '人頭牌（K、Q、J）常被當成「某個人」的提示。另有一種說法以數字代表強度：K 最強、6 最弱。',
}

module.exports = { playingCardGuide: deepFreeze(playingCardGuide) }
