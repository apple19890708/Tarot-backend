// 塔羅原創牌面（v28）的共用圖形：四種花色物件、宮廷牌徽記、幾種常用的小東西。
// 色票與基本圖形（葉子、白花、星星…）沿用雷諾曼的 scripts/lenormand/lib/shapes.js，這裡只放塔羅才需要的。
// 座標和雷諾曼一樣是主圖的 240×330 區塊；複雜的物件先在原點附近畫好，再用 transform 移過去，數字比較好讀。
const { P, f, leaf, flower } = require('../../lenormand/lib/shapes')

// 塔羅另外用到的顏色
const C = {
  steel: '#e4e6ea',
  steelEdge: '#8e93a0',
  steelVein: '#b9bec8',
  stone: '#ddd6ca',
  stoneEdge: '#b3a894',
  night: '#d9d2e6',
  lion: '#e6cfa8',
  mane: '#c9a27a',
}

const place = (x, y, { s = 1, rot = 0, flip = false } = {}) =>
  `translate(${f(x)} ${f(y)})${rot ? ` rotate(${f(rot)})` : ''}${s !== 1 || flip ? ` scale(${f(flip ? -s : s)} ${f(s)})` : ''}`

// 權杖：從 (x, y) 往 angle 長 len 的木枝，中段一對小葉，頂端兩片嫩葉＋一朵白花
function wand(x, y, len, angle, { bloom = true, w = 0 } = {}) {
  const a = (angle * Math.PI) / 180
  const width = w || Math.max(2.4, len * 0.05)
  const at = (t) => [x + len * t * Math.cos(a), y + len * t * Math.sin(a)]
  const [tx, ty] = at(1)
  const [kx, ky] = at(0.55)
  let out =
    `<path d="M${f(x)} ${f(y)}L${f(tx)} ${f(ty)}" stroke="${P.bark}" stroke-width="${f(width)}" stroke-linecap="round"/>` +
    `<path d="M${f(at(0.08)[0])} ${f(at(0.08)[1])}L${f(at(0.92)[0])} ${f(at(0.92)[1])}" stroke="${P.ochre}" stroke-width="${f(width * 0.32)}" stroke-linecap="round" opacity=".7"/>` +
    leaf(kx, ky, len * 0.16, angle - 55, P.sage) +
    leaf(kx, ky, len * 0.13, angle + 60, P.sageDeep)
  if (bloom) {
    out += leaf(tx, ty, len * 0.2, angle - 38, P.sage) + leaf(tx, ty, len * 0.18, angle + 40, P.sageDeep)
    out += flower(tx, ty, Math.max(3.5, len * 0.085), { rot: angle })
  }
  return out
}

// 聖杯：(x, y) 是杯口中心，s=1 時寬 36、高 40。tilt 傾斜角度；water 杯裡有水；down 倒扣
function cup(x, y, s = 1, { tilt = 0, water = false, down = false } = {}) {
  const body =
    `<path d="M-18 0C-18 16 -9 24 0 24C9 24 18 16 18 0Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1.2"/>` +
    `<path d="M-16.5 8Q0 12 16.5 8" fill="none" stroke="${P.gold}" stroke-width="1.6"/>` +
    `<path d="M-3 23.5H3V34H-3Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1"/>` +
    `<circle cx="0" cy="28" r="3" fill="${P.gold}"/>` +
    `<ellipse cx="0" cy="36" rx="12" ry="3.6" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1.1"/>` +
    `<ellipse cx="0" cy="0" rx="18" ry="4.2" fill="${water ? P.water : P.paper}" stroke="${P.lavDeep}" stroke-width="1.1"/>` +
    `<path d="M-11 4Q-12 14 -6 19" fill="none" stroke="${P.paper}" stroke-width="2" stroke-linecap="round" opacity=".8"/>`
  const rot = down ? 180 + tilt : tilt
  return `<g transform="${place(x, y, { s, rot })}">${body}</g>`
}

// 寶劍：(x, y) 是護手中心，劍身往 angle 長 len；護手是兩片葉子
function sword(x, y, len, angle = -90) {
  const w = Math.max(2.6, len * 0.04)
  const grip = len * 0.2
  const body =
    `<path d="M${f(-w)} 0V${f(-len + w * 3)}L0 ${f(-len)}L${f(w)} ${f(-len + w * 3)}V0Z" fill="${C.steel}" stroke="${C.steelEdge}" stroke-width=".9" stroke-linejoin="round"/>` +
    `<path d="M0 -3V${f(-len + w * 3.5)}" stroke="${C.steelVein}" stroke-width=".8"/>` +
    leaf(0, 0, w * 4.4, 0, P.sage, 0.34) +
    leaf(0, 0, w * 4.4, 180, P.sage, 0.34) +
    `<rect x="${f(-w * 0.55)}" y="1" width="${f(w * 1.1)}" height="${f(grip)}" rx="${f(w * 0.4)}" fill="${P.goldDeep}"/>` +
    `<circle cx="0" cy="${f(grip + 2)}" r="${f(w * 0.95)}" fill="${P.gold}"/>`
  return `<g transform="${place(x, y, { rot: angle + 90 })}">${body}</g>`
}

// 錢幣：金色圓幣，中央細線五芒星（D1），半徑夠大時外圈加一圈小點
function coin(x, y, r) {
  let star = ''
  for (let i = 0; i < 5; i += 1) {
    const a = ((-90 + i * 144) * Math.PI) / 180
    star += `${i ? 'L' : 'M'}${f(x + r * 0.6 * Math.cos(a))} ${f(y + r * 0.6 * Math.sin(a))}`
  }
  let dots = ''
  if (r >= 11) {
    for (let i = 0; i < 12; i += 1) {
      const a = (i * 30 * Math.PI) / 180
      dots += `<circle cx="${f(x + r * 0.9 * Math.cos(a))}" cy="${f(y + r * 0.9 * Math.sin(a))}" r="${f(r * 0.045)}"/>`
    }
    dots = `<g fill="${P.goldDeep}">${dots}</g>`
  }
  return (
    `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${P.gold}"/>` +
    `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r * 0.8)}" fill="${P.goldLight}"/>` +
    `<path d="${star}Z" fill="none" stroke="${P.goldDeep}" stroke-width="${f(Math.max(0.6, r * 0.05))}" stroke-linejoin="round"/>` +
    dots
  )
}

// 角落用的小花色記號（牌框左上、右下）
function suitIcon(suit, x, y) {
  if (suit === 'wands') return wand(x - 6, y + 9, 22, -60, { w: 2.6 })
  if (suit === 'cups') return cup(x, y - 6, 0.36)
  if (suit === 'swords') return sword(x, y + 6, 20, -90)
  return coin(x, y, 7)
}

// 小鳥（侍者徽記等）：(x, y) 是身體中心，預設朝右
function bird(x, y, s = 1, { flip = false, color = P.lav } = {}) {
  const body =
    `<path d="M-10 -2L-24 -8L-20 4Z" fill="${P.lavDeep}"/>` +
    `<ellipse cx="0" cy="0" rx="13" ry="8.5" fill="${color}"/>` +
    `<circle cx="10" cy="-7" r="6.5" fill="${color}"/>` +
    `<path d="M16 -8L22 -6L16 -4Z" fill="${P.gold}"/>` +
    `<circle cx="12" cy="-8" r="1.2" fill="${P.ink}"/>` +
    `<path d="M-7 -4Q4 -9 8 2Q-2 4 -7 -4Z" fill="${P.lavDeep}" opacity=".55"/>` +
    `<path d="M-2 8V13M4 8V13" stroke="${P.goldDeep}" stroke-width="1.2"/>`
  return `<g transform="${place(x, y, { s, flip })}">${body}</g>`
}

// 飛行中的小鳥剪影
const flyingBird = (x, y, s = 1, color = P.lavDeep) =>
  `<path d="M${f(x - 9 * s)} ${f(y)}Q${f(x - 4 * s)} ${f(y - 5 * s)} ${f(x)} ${f(y)}Q${f(x + 4 * s)} ${f(y - 5 * s)} ${f(x + 9 * s)} ${f(y)}" fill="none" stroke="${color}" stroke-width="${f(1.4 * s)}" stroke-linecap="round"/>`

// 奔馬側影（騎士徽記）：(x, y) 是身體中心、朝右。walk：四蹄著地的慢步（錢幣騎士）
function horse(x, y, s = 1, { walk = false, color = P.lavDeep, mane = P.lav } = {}) {
  const legs = walk
    ? 'M-22 8L-24 34M-12 10L-10 34M16 8L14 34M24 6L28 34'
    : 'M-22 8L-32 22L-30 34M-14 10L-6 22L-8 34M18 4L32 -2L36 10M12 8L26 12L28 24'
  const body =
    `<path d="M-30 -4Q-50 -6 -54 14Q-44 4 -34 8Z" fill="${mane}"/>` +
    `<ellipse cx="0" cy="0" rx="31" ry="15" fill="${color}" transform="rotate(${walk ? 0 : -10})"/>` +
    `<path d="M14 -8Q22 -28 30 -42L44 -36Q36 -18 30 0Z" fill="${color}"/>` +
    `<path d="M30 -42Q40 -52 52 -44L58 -34Q52 -30 44 -33L44 -36Z" fill="${color}"/>` +
    `<path d="M32 -46L34 -55L39 -46Z" fill="${color}"/>` +
    `<path d="M29 -42Q20 -36 18 -24Q14 -30 12 -20Q10 -26 8 -14" fill="none" stroke="${mane}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="47" cy="-41" r="1.3" fill="${P.paper}"/>` +
    `<path d="${legs}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
  return `<g transform="${place(x, y, { s })}">${body}</g>`
}

// 王冠（國王徽記）：(x, y) 是底邊中心
function crown(x, y, s = 1) {
  const body =
    `<path d="M-22 0L-26 -22L-12 -10L0 -28L12 -10L26 -22L22 0Z" fill="${P.gold}" stroke="${P.goldDeep}" stroke-width="1" stroke-linejoin="round"/>` +
    `<rect x="-23" y="-2" width="46" height="7" rx="2" fill="${P.goldDeep}"/>` +
    `<g fill="${P.paper}"><circle cx="-26" cy="-23" r="2.6"/><circle cx="0" cy="-29" r="3"/><circle cx="26" cy="-23" r="2.6"/></g>` +
    `<circle cx="0" cy="1.5" r="2.2" fill="${P.lav}"/><circle cx="-12" cy="1.5" r="1.6" fill="${P.paper}"/><circle cx="12" cy="1.5" r="1.6" fill="${P.paper}"/>`
  return `<g transform="${place(x, y, { s })}">${body}</g>`
}

// 花冠＋新月（皇后徽記）：(x, y) 是花冠中心
function flowerCrown(x, y, s = 1) {
  let ring = ''
  for (let i = 0; i < 7; i += 1) {
    const a = Math.PI + (Math.PI * i) / 6
    const px = 24 * Math.cos(a)
    const py = 8 * Math.sin(a)
    ring += leaf(px, py, 9, (a * 180) / Math.PI - 70, P.sage) + leaf(px, py, 8, (a * 180) / Math.PI + 70, P.sageDeep)
  }
  for (let i = 0; i < 5; i += 1) {
    const a = Math.PI + (Math.PI * (i + 0.5)) / 5
    ring += flower(24 * Math.cos(a), 8 * Math.sin(a), 6, { rot: i * 20 })
  }
  const moon = `<path d="M-6 -34A12 12 0 1 0 6 -14A10 10 0 0 1 -6 -34Z" fill="${P.goldLight}" stroke="${P.gold}" stroke-width="1"/>`
  return `<g transform="${place(x, y, { s })}">${moon}${ring}</g>`
}

// 盾形底座（國王）：(x, y) 是上緣中心
function shield(x, y, s = 1) {
  const body =
    `<path d="M-26 0H26V18Q26 40 0 52Q-26 40 -26 18Z" fill="${P.paper}" stroke="${P.gold}" stroke-width="1.6"/>` +
    `<path d="M-19 6H19V18Q19 34 0 44Q-19 34 -19 18Z" fill="none" stroke="${P.goldLight}" stroke-width="1"/>`
  return `<g transform="${place(x, y, { s })}">${body}</g>`
}

// 蝴蝶：(x, y) 是身體中心
function butterfly(x, y, s = 1, { rot = 0, color = P.lav } = {}) {
  const body =
    `<ellipse cx="-8" cy="-6" rx="9" ry="6.5" fill="${color}" transform="rotate(-25 -8 -6)"/>` +
    `<ellipse cx="8" cy="-6" rx="9" ry="6.5" fill="${color}" transform="rotate(25 8 -6)"/>` +
    `<ellipse cx="-6" cy="5" rx="5.5" ry="4.5" fill="${color}" opacity=".8"/>` +
    `<ellipse cx="6" cy="5" rx="5.5" ry="4.5" fill="${color}" opacity=".8"/>` +
    `<circle cx="-9" cy="-6" r="2" fill="${P.paper}" opacity=".8"/><circle cx="9" cy="-6" r="2" fill="${P.paper}" opacity=".8"/>` +
    `<path d="M0 -9V10M0 -9Q-2 -15 -5 -17M0 -9Q2 -15 5 -17" fill="none" stroke="${P.ink}" stroke-width="1.2" stroke-linecap="round"/>`
  return `<g transform="${place(x, y, { s, rot })}">${body}</g>`
}

// 鳶尾：(x, y) 是莖的底部，花在上方 h 處
function iris(x, y, h = 70, s = 1) {
  const top = y - h
  const flowerSvg =
    `<g transform="${place(x, top, { s })}">` +
    `<path d="M0 0Q-16 2 -18 14Q-8 12 0 4Z" fill="${P.lav}"/>` +
    `<path d="M0 0Q16 2 18 14Q8 12 0 4Z" fill="${P.lav}"/>` +
    `<path d="M0 2Q-9 -14 0 -24Q9 -14 0 2Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width=".8"/>` +
    `<path d="M-2 2Q-12 -6 -12 -16Q-4 -10 0 0Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width=".7"/>` +
    `<path d="M2 2Q12 -6 12 -16Q4 -10 0 0Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width=".7"/>` +
    `<path d="M-6 6Q-10 9 -12 12M6 6Q10 9 12 12" stroke="${P.gold}" stroke-width="1.6" stroke-linecap="round"/>` +
    `</g>`
  return (
    `<path d="M${f(x)} ${f(y)}Q${f(x + 2)} ${f(y - h / 2)} ${f(x)} ${f(top + 4)}" fill="none" stroke="${P.sageDeep}" stroke-width="1.6"/>` +
    leaf(x, y, h * 0.7, -100, P.sage, 0.14) +
    leaf(x, y, h * 0.55, -72, P.sageDeep, 0.14) +
    flowerSvg
  )
}

// 雲朵：(x, y) 是中心，w 是寬度
function cloud(x, y, w = 60, fill = P.paper, opacity = 0.9) {
  const r = w / 4
  return (
    `<g fill="${fill}" opacity="${opacity}">` +
    `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(w / 2)}" ry="${f(r * 0.8)}"/>` +
    `<circle cx="${f(x - r * 0.8)}" cy="${f(y - r * 0.5)}" r="${f(r * 0.9)}"/>` +
    `<circle cx="${f(x + r * 0.6)}" cy="${f(y - r * 0.7)}" r="${f(r * 1.1)}"/>` +
    `</g>`
  )
}

// 新月：(x, y) 中心、r 半徑，開口朝右
const crescent = (x, y, r, fill = P.goldLight, stroke = P.gold) =>
  `<path d="M${f(x + r * 0.35)} ${f(y - r * 0.94)}A${f(r)} ${f(r)} 0 1 0 ${f(x + r * 0.35)} ${f(y + r * 0.94)}A${f(r * 0.8)} ${f(r * 0.8)} 0 0 1 ${f(x + r * 0.35)} ${f(y - r * 0.94)}Z" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`

// 放射光線
function rays(x, y, r1, r2, n, { color = P.goldLight, width = 1.2, offset = 0, opacity = 0.8 } = {}) {
  let d = ''
  for (let i = 0; i < n; i += 1) {
    const a = ((offset + (360 / n) * i) * Math.PI) / 180
    d += `M${f(x + r1 * Math.cos(a))} ${f(y + r1 * Math.sin(a))}L${f(x + r2 * Math.cos(a))} ${f(y + r2 * Math.sin(a))}`
  }
  return `<path d="${d}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" opacity="${opacity}"/>`
}

// 一圈光暈
const glow = (x, y, r, color = P.goldLight, opacity = 0.55) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="${color}" opacity="${opacity}"/>`

module.exports = { C, place, wand, cup, sword, coin, suitIcon, bird, flyingBird, horse, crown, flowerCrown, shield, butterfly, iris, cloud, crescent, rays, glow }
