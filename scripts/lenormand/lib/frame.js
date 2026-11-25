// 雷諾曼牌的共用牌框（v27 階段 2）：米白底＋水彩紙紋、細金框、四角小花飾、上方牌號、下方中文名與英文名、角落撲克標記。
// 牌面 350×600（7:12），和塔羅牌圖（約 500×862）與前端的 aspect-[7/12] 一致。
//
// 文字直接畫在 SVG 裡，font-family 寫好備援清單（理由見 doc/v27-lenormand-plan.md 3-3）：
// SVG 用 <img> 顯示時不能載入外部字型，但可以用裝置上已安裝的字型；會看這個網站的裝置一定有中文字型（介面本身就是中文），
// 清單都沒有時也會落到瀏覽器的 serif 備援，仍然顯示得出中文。好處是一張圖自己就完整，存圖、預覽頁、前端都不用另外疊字。
const { P, f, leaf, flower, heart } = require('./shapes')

const W = 350
const H = 600
// 主圖區塊（motif 的 240×330 座標）放大 1.12 倍，置中放在牌號與名稱之間
const MOTIF_SCALE = 1.12
const MOTIF_X = (W - 240 * MOTIF_SCALE) / 2
const MOTIF_Y = 70

const FONT_ZH = "'Noto Serif TC','Source Han Serif TC','Noto Serif CJK TC','Songti TC','PMingLiU','MingLiU',serif"
const FONT_EN = "'Cormorant Garamond','Garamond','Georgia','Times New Roman',serif"

const SUIT_COLORS = { hearts: P.rose, diamonds: P.rose, clubs: P.ink, spades: P.ink }

const escapeXml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

// 撲克花色圖形（不用 ♥♦♣♠ 字元：有些字型沒有，或會被畫成彩色表情符號）
function suitMark(suit, x, y, s) {
  const color = SUIT_COLORS[suit]
  if (suit === 'hearts') return heart(x, y, s, { fill: color })
  if (suit === 'diamonds') return `<path d="M${f(x)} ${f(y - s * 1.1)}L${f(x + s * 0.75)} ${f(y)}L${f(x)} ${f(y + s * 1.1)}L${f(x - s * 0.75)} ${f(y)}Z" fill="${color}"/>`
  if (suit === 'clubs') {
    const r = s * 0.48
    return `<g fill="${color}"><circle cx="${f(x)}" cy="${f(y - s * 0.5)}" r="${f(r)}"/><circle cx="${f(x - s * 0.52)}" cy="${f(y + s * 0.18)}" r="${f(r)}"/><circle cx="${f(x + s * 0.52)}" cy="${f(y + s * 0.18)}" r="${f(r)}"/><path d="M${f(x - s * 0.12)} ${f(y)}L${f(x - s * 0.38)} ${f(y + s * 1.05)}H${f(x + s * 0.38)}L${f(x + s * 0.12)} ${f(y)}Z"/></g>`
  }
  // spades：倒過來的愛心加柄
  return `<g fill="${color}">${heart(x, y - s * 0.05, s * 0.85, { fill: color, rot: 180 })}<path d="M${f(x - s * 0.1)} ${f(y + s * 0.2)}L${f(x - s * 0.38)} ${f(y + s * 1.05)}H${f(x + s * 0.38)}L${f(x + s * 0.1)} ${f(y + s * 0.2)}Z"/></g>`
}

function pip(playingCard) {
  if (!playingCard) return ''
  const color = SUIT_COLORS[playingCard.suit]
  const mark = `<text x="34" y="74" text-anchor="middle" font-family="${FONT_EN}" font-size="16" font-weight="600" fill="${color}">${escapeXml(playingCard.rank)}</text>${suitMark(playingCard.suit, 34, 88, 6.5)}`
  // 右下角轉 180 度再畫一次，和撲克牌一樣
  return `<g>${mark}</g><g transform="rotate(180 ${W / 2} ${H / 2})">${mark}</g>`
}

function cornerOrnament() {
  return (
    leaf(25, 25, 24, 4, P.sage, 0.28) +
    leaf(25, 25, 24, 86, P.sage, 0.28) +
    leaf(25, 25, 14, 45, P.sageLight, 0.3) +
    flower(25, 25, 6.5, { rot: 18 }) +
    `<circle cx="52" cy="22" r="1.4" fill="${P.gold}"/><circle cx="22" cy="52" r="1.4" fill="${P.gold}"/>`
  )
}

// 牌面共用的底：背景漸層、水彩紙紋、中央水彩暈染、雙層金框、四角花飾（塔羅 v28 也用這一套，見 scripts/tarot/lib/frame.js）
// id：這張牌的 id 前綴（同一頁多張 SVG 時不能撞）；seed：紙紋雜訊的種子；washColor：中央暈染的顏色
function paperDefs(id, { seed, washColor }) {
  return [
    `<radialGradient id="${id}bg" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="${P.paper}"/><stop offset="1" stop-color="${P.cream}"/></radialGradient>`,
    `<radialGradient id="${id}w"><stop offset="0" stop-color="${washColor}" stop-opacity=".85"/><stop offset=".7" stop-color="${washColor}" stop-opacity=".35"/><stop offset="1" stop-color="${washColor}" stop-opacity="0"/></radialGradient>`,
    // 水彩紙紋：一層很淡的雜訊，只在背景用一次，手機上也不會太重
    `<filter id="${id}p" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="${seed}"/><feColorMatrix values="0 0 0 0 .55 0 0 0 0 .47 0 0 0 0 .33 .2 0 0 0 0"/></filter>`,
  ].join('')
}

function paperLayers(id) {
  const corner = cornerOrnament()
  return [
    `<rect width="${W}" height="${H}" rx="16" fill="url(#${id}bg)"/>`,
    `<rect width="${W}" height="${H}" rx="16" filter="url(#${id}p)" opacity=".7"/>`,
    `<ellipse cx="175" cy="262" rx="132" ry="168" fill="url(#${id}w)"/>`,
    `<rect x="11" y="11" width="328" height="578" rx="11" fill="none" stroke="${P.gold}" stroke-width="1.6"/>`,
    `<rect x="17" y="17" width="316" height="566" rx="8" fill="none" stroke="${P.goldLight}" stroke-width=".8"/>`,
    `<g>${corner}</g>`,
    `<g transform="translate(${W} 0) scale(-1 1)">${corner}</g>`,
    `<g transform="translate(0 ${H}) scale(1 -1)">${corner}</g>`,
    `<g transform="translate(${W} ${H}) scale(-1 -1)">${corner}</g>`,
  ].join('')
}

// 主圖區塊（240×330 座標）放到牌號與名稱之間
const motifGroup = (motifSvg) => `<g transform="translate(${f(MOTIF_X)} ${MOTIF_Y}) scale(${MOTIF_SCALE})">${motifSvg}</g>`

// 下方名稱：花飾分隔線、中文名、英文名（英文太長時縮字距，不換行）
function nameBlock(nameZh, nameEn) {
  const en = nameEn.toUpperCase()
  const spacing = en.length > 16 ? 2.2 : 3.5
  return [
    `<path d="M112 447H162M188 447H238" stroke="${P.gold}" stroke-width=".9"/>`,
    flower(175, 447, 6, { rot: 36 }),
    `<text x="175" y="487" text-anchor="middle" font-family="${FONT_ZH}" font-size="29" fill="${P.ink}" letter-spacing="5">${escapeXml(nameZh)}</text>`,
    `<text x="175" y="514" text-anchor="middle" font-family="${FONT_EN}" font-size="13" fill="${P.goldDeep}" letter-spacing="${spacing}">${escapeXml(en)}</text>`,
  ].join('')
}

// 上方牌號兩側的金線與圓點（中間放文字或徽記）
const topRule = () =>
  `<path d="M128 45H156M194 45H222" stroke="${P.gold}" stroke-width=".9"/>` +
  `<circle cx="125" cy="45" r="1.6" fill="${P.gold}"/><circle cx="225" cy="45" r="1.6" fill="${P.gold}"/>`

function buildCardSvg(card, motifSvg) {
  const id = `ln${String(card.id).padStart(2, '0')}`
  // 背景水彩暈染的顏色：奇數牌偏灰綠、偶數牌偏淡紫，排在一起時有一點變化
  const washColor = card.id % 2 ? P.sageLight : P.lavLight
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(`${card.id} ${card.nameZh} ${card.nameEn}`)}">`,
    `<defs>`,
    paperDefs(id, { seed: card.id, washColor }),
    `</defs>`,
    paperLayers(id),
    // 上方牌號
    topRule(),
    `<text x="175" y="51" text-anchor="middle" font-family="${FONT_EN}" font-size="18" font-weight="600" fill="${P.goldDeep}" letter-spacing="1">${card.id}</text>`,
    pip(card.playingCard),
    motifGroup(motifSvg),
    nameBlock(card.nameZh, card.nameEn),
    `</svg>`,
  ].join('')
}

module.exports = { buildCardSvg, paperDefs, paperLayers, motifGroup, nameBlock, topRule, escapeXml, FONT_ZH, FONT_EN, W, H, MOTIF_X, MOTIF_Y, MOTIF_SCALE }
