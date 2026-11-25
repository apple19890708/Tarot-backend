// 雷諾曼 AI 解讀寫完的程式檢查（v27 階段 7，詳見 doc/v27-lenormand-plan.md 3-14）。
// 第一版只抓明顯錯誤，結果只給前端與統計參考，不擋顯示、不重寫：
//   orientation     寫出正位／逆位（雷諾曼沒有正逆位）
//   tarotTerms      寫出塔羅才有的詞（大小阿爾克那、權杖／聖杯／寶劍／錢幣牌組）
//   noSignificator  大藍圖沒提到代表牌（紳士／淑女或「代表牌」）
const ORIENTATION = /正位|逆位/
// 只抓明確是塔羅的說法：阿爾克那、牌組名接「牌組／組／王牌／宮廷」。
// 不收數字（「聖杯一樣」會誤判）、不收「大牌」「小牌」（「大牌陣」「小牌陣」是雷諾曼也會用的詞）
const TAROT_TERMS = /阿爾克[那納]|(?:權杖|聖杯|寶劍|錢幣)(?:牌組|組|王牌|侍者|騎士|皇后|國王)/

function checkLenormandNarration(text, { spreadKey = null, significator = null } = {}) {
  const content = String(text || '')
  const checks = []
  if (ORIENTATION.test(content)) checks.push('orientation')
  if (TAROT_TERMS.test(content)) checks.push('tarotTerms')
  if (spreadKey === 'grand-tableau') {
    const self = significator === 28 ? '紳士' : significator === 29 ? '淑女' : null
    if (!content.includes('代表牌') && !(self && content.includes(self))) checks.push('noSignificator')
  }
  return checks
}

module.exports = { checkLenormandNarration }
