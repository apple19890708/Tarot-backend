// 宮廷牌的共用版型（v28 3-3、決議 D2：不畫人物，用花色物件＋階級徽記）。
// - 侍者：物件＋停在上面的小鳥；騎士：奔馬側影＋前方的物件；皇后：物件＋花冠與新月；國王：盾形底座＋物件＋王冠
// - 背景依元素：權杖＝晨光與暖色山丘、聖杯＝水波與蓮葉、寶劍＝雲與羽毛、錢幣＝麥穗與田壟
// 每張牌自己的小元素（例如聖杯侍者杯裡的小魚）由 motifs/<key>.js 另外加在 extra 參數。
const { P, f, leaf, flower, ground, grass, sparkle, waves } = require('../../lenormand/lib/shapes')
const { wand, cup, sword, coin, bird, horse, crown, flowerCrown, shield, cloud, glow } = require('./art')

// 羽毛：從 (x, y) 往 angle 長 len
function feather(x, y, len, angle, color = P.lavLight) {
  const a = (angle * Math.PI) / 180
  const tx = x + len * Math.cos(a)
  const ty = y + len * Math.sin(a)
  const nx = -Math.sin(a) * len * 0.18
  const ny = Math.cos(a) * len * 0.18
  const mx = x + (tx - x) * 0.45
  const my = y + (ty - y) * 0.45
  return (
    `<path d="M${f(x)} ${f(y)}Q${f(mx + nx)} ${f(my + ny)} ${f(tx)} ${f(ty)}Q${f(mx - nx)} ${f(my - ny)} ${f(x)} ${f(y)}Z" fill="${color}" stroke="${P.lavDeep}" stroke-width=".7"/>` +
    `<path d="M${f(x)} ${f(y)}L${f(tx)} ${f(ty)}" stroke="${P.lavDeep}" stroke-width=".8"/>`
  )
}

// 麥穗：從 (x, y) 往 angle 長 len
function wheat(x, y, len, angle) {
  const a = (angle * Math.PI) / 180
  let ear = ''
  for (let i = 0; i < 5; i += 1) {
    const t = 1 - i * 0.08
    const px = x + len * t * Math.cos(a)
    const py = y + len * t * Math.sin(a)
    ear += `<ellipse cx="${f(px - 2.6)}" cy="${f(py)}" rx="2.2" ry="4.6" transform="rotate(${f(angle + 60)} ${f(px - 2.6)} ${f(py)})"/>`
    ear += `<ellipse cx="${f(px + 2.6)}" cy="${f(py)}" rx="2.2" ry="4.6" transform="rotate(${f(angle + 120)} ${f(px + 2.6)} ${f(py)})"/>`
  }
  return `<path d="M${f(x)} ${f(y)}L${f(x + len * Math.cos(a))} ${f(y + len * Math.sin(a))}" stroke="${P.ochre}" stroke-width="1.3"/><g fill="${P.gold}">${ear}</g>`
}

// 背景（畫在最底層）
function backdrop(suit) {
  if (suit === 'wands') {
    let d = ''
    for (let deg = -168; deg <= -12; deg += 13) {
      const r = (deg * Math.PI) / 180
      d += `M${f(120 + 70 * Math.cos(r))} ${f(250 + 70 * Math.sin(r))}L${f(120 + 112 * Math.cos(r))} ${f(250 + 112 * Math.sin(r))}`
    }
    return (
      glow(120, 250, 96, P.goldLight, 0.55) +
      `<path d="${d}" stroke="${P.goldLight}" stroke-width="2" stroke-linecap="round" opacity=".8"/>` +
      `<path d="M8 272Q60 238 120 252Q180 234 232 268Q236 286 220 294H20Q4 286 8 272Z" fill="#ecd9b8"/>` +
      `<path d="M30 284Q90 262 150 276Q190 266 220 282" fill="none" stroke="${P.ochre}" stroke-width="1.2" opacity=".5"/>`
    )
  }
  if (suit === 'cups') {
    return (
      `<ellipse cx="120" cy="274" rx="106" ry="22" fill="${P.sky}"/>` +
      waves(36, 268, 168, { rows: 2, gap: 9 }) +
      `<ellipse cx="40" cy="280" rx="20" ry="5" fill="${P.sage}"/><ellipse cx="204" cy="276" rx="16" ry="4" fill="${P.sage}"/>` +
      flower(40, 276, 6, { rot: 10 })
    )
  }
  if (suit === 'swords') {
    return (
      cloud(58, 96, 74, P.lavLight, 1) +
      cloud(188, 120, 66, P.lavLight, 1) +
      cloud(160, 70, 44, P.paper, 0.9) +
      ground(120, 290, 92) +
      feather(30, 236, 30, -120) +
      feather(208, 214, 26, -60, P.paper)
    )
  }
  return (
    ground(120, 288, 106, P.sageLight) +
    `<path d="M24 284Q120 270 216 284M36 292Q120 280 204 292" fill="none" stroke="${P.ochre}" stroke-width="1.2" opacity=".55"/>` +
    wheat(26, 286, 70, -100) +
    wheat(36, 286, 62, -82) +
    wheat(214, 286, 70, -80) +
    wheat(204, 286, 62, -98)
  )
}

// 各階級的主物件位置。top：物件最上緣（皇后花冠、侍者小鳥依它擺）
const LAYOUT = {
  page: {
    wands: { svg: () => wand(120, 286, 184, -90, { w: 7 }) + `<path d="M121 168Q136 164 156 166" stroke="${P.bark}" stroke-width="3" stroke-linecap="round"/>`, bird: [146, 152] },
    cups: { svg: () => cup(120, 200, 2), bird: [150, 186] },
    swords: { svg: () => sword(120, 240, 150, -90), bird: [142, 226] },
    pentacles: { svg: () => coin(120, 220, 54), bird: [120, 152] },
  },
  queen: {
    wands: { svg: () => wand(120, 286, 160, -90, { w: 6.5 }), crown: 104 },
    cups: { svg: () => cup(120, 186, 1.9), crown: 128 },
    swords: { svg: () => sword(120, 250, 136, -90), crown: 100 },
    pentacles: { svg: () => coin(120, 212, 50), crown: 136 },
  },
  king: {
    wands: { svg: () => wand(120, 262, 168, -90, { w: 6.5 }), crown: 76 },
    cups: { svg: () => cup(120, 178, 1.55), crown: 150 },
    swords: { svg: () => sword(120, 222, 114, -90), crown: 76 },
    pentacles: { svg: () => coin(120, 190, 44), crown: 138 },
  },
}

// 騎士前方的物件
function knightObject(suit) {
  if (suit === 'wands') return wand(190, 290, 118, -84, { w: 5 })
  if (suit === 'cups') return cup(198, 240, 0.85)
  if (suit === 'swords') return sword(196, 262, 104, -84)
  return coin(198, 254, 20)
}

// 國王盾牌中央的小記號
function shieldMark(suit) {
  if (suit === 'pentacles') return coin(120, 258, 9)
  return `<path d="M120 248L124 258L120 268L116 258Z" fill="${P.gold}"/>` + leaf(120, 258, 12, 200, P.sage) + leaf(120, 258, 12, -20, P.sage)
}

// suit：wands／cups／swords／pentacles；rank：page／knight／queen／king
// under／over：每張牌自己的小元素，分別畫在主物件下層與上層
function court(suit, rank, { under = '', over = '' } = {}) {
  let body = ''
  if (rank === 'knight') {
    body = knightObject(suit) + horse(100, 204, 1.3, { walk: suit === 'pentacles' }) + grass(40, 288, 24) + grass(150, 290, 20)
  } else {
    const layout = LAYOUT[rank][suit]
    if (rank === 'page') body = layout.svg() + bird(layout.bird[0], layout.bird[1], 1.1)
    if (rank === 'queen') body = layout.svg() + flowerCrown(120, layout.crown, 1.25)
    if (rank === 'king') body = layout.svg() + shield(120, 232, 1.05) + shieldMark(suit) + crown(120, layout.crown, 1.15)
  }
  return backdrop(suit) + under + body + over + sparkle(34, 70, 4) + sparkle(208, 64, 4)
}

module.exports = { court, feather, wheat, backdrop }
