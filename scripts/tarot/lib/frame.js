// 塔羅牌的牌框（v28，見 doc/v28-tarot-original-art-plan.md 3-2）。
// 底（背景、紙紋、暈染、金框、四角花飾）、主圖位置、下方牌名都和雷諾曼共用 scripts/lenormand/lib/frame.js；
// 塔羅不同的只有：上方標號（羅馬數字／ACE～X／宮廷牌放花色徽記）、角落記號（大牌八角星、小牌花色）、暈染顏色依元素。
const { P, f, star } = require('../../lenormand/lib/shapes')
const { W, H, paperDefs, paperLayers, motifGroup, nameBlock, topRule, escapeXml, FONT_EN } = require('../../lenormand/lib/frame')
const { suitIcon } = require('./art')

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI']
const PIP_LABEL = ['ACE', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']

// 中央暈染：依元素（權杖火＝淡金、聖杯水＝淡水藍、寶劍風＝淡紫、錢幣土＝灰綠）；大牌淡金、淡紫交替
const WASH = { wands: P.goldLight, cups: P.sky, swords: P.lavLight, pentacles: P.sageLight }

// SVG 裡的 id 前綴：同一頁放很多張時不能撞（例如 tm00、tcu01）
const SUIT_ID = { wands: 'wa', cups: 'cu', swords: 'sw', pentacles: 'pe' }
const idOf = (card) => `t${card.arcanaType === 'major' ? 'm' : SUIT_ID[card.suit]}${String(card.number).padStart(2, '0')}`

const isCourt = (card) => card.arcanaType === 'minor' && card.number > 10

function topLabel(card) {
  const label = card.arcanaType === 'major' ? ROMAN[card.number] : PIP_LABEL[card.number - 1]
  if (isCourt(card)) return topRule() + suitIcon(card.suit, 175, 44)
  return topRule() + `<text x="175" y="51" text-anchor="middle" font-family="${FONT_EN}" font-size="18" font-weight="600" fill="${P.goldDeep}" letter-spacing="1">${label}</text>`
}

// 角落記號：左上畫一次，右下轉 180 度再畫一次
function cornerMarks(card) {
  const mark = card.arcanaType === 'major' ? star(34, 80, 7, { points: 8, inner: 0.42, fill: P.gold }) : suitIcon(card.suit, 34, 80)
  return `<g>${mark}</g><g transform="rotate(180 ${W / 2} ${H / 2})">${mark}</g>`
}

function buildTarotSvg(card, motifSvg) {
  const id = idOf(card)
  const washColor = card.suit ? WASH[card.suit] : card.number % 2 ? P.lavLight : P.goldLight
  const seed = card.arcanaType === 'major' ? 100 + card.number : 200 + Object.keys(SUIT_ID).indexOf(card.suit) * 20 + card.number
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(`${card.nameZh} ${card.nameEn}`)}">`,
    `<defs>`,
    paperDefs(id, { seed, washColor }),
    `</defs>`,
    paperLayers(id),
    topLabel(card),
    cornerMarks(card),
    motifGroup(motifSvg),
    nameBlock(card.nameZh, card.nameEn),
    `</svg>`,
  ].join('')
}

module.exports = { buildTarotSvg, idOf, ROMAN, f }
