// XIX 太陽：大太陽照著一扇敞開的花園木門，門外一片白雛菊（喜悅、坦然、成功）
// （不畫騎白馬的孩子、向日葵與牆；光芒畫法也和雷諾曼「太陽」不同）
const DAISIES = [
  [22, 270],
  [40, 284],
  [58, 268],
  [74, 290],
  [30, 296],
  [166, 290],
  [182, 268],
  [198, 286],
  [214, 270],
  [222, 292],
  [88, 270],
  [152, 272],
]

module.exports = {
  draw: ({ P, f, leaf, flower, ground, rays }) => {
    let dots = ''
    for (let i = 0; i < 24; i += 1) {
      const a = ((i * 15 + 7.5) * Math.PI) / 180
      dots += `<circle cx="${f(120 + 54 * Math.cos(a))}" cy="${f(78 + 54 * Math.sin(a))}" r="1.8"/>`
    }
    let vine = ''
    for (let i = 1; i < 8; i += 1) {
      const t = i / 8
      const x = (1 - t) * (1 - t) * 62 + 2 * (1 - t) * t * 120 + t * t * 178
      const y = (1 - t) * (1 - t) * 150 + 2 * (1 - t) * t * 104 + t * t * 150
      vine += leaf(x, y, 12, i % 2 ? -60 : -120, i % 2 ? P.sage : P.sageDeep) + (i % 2 ? flower(x, y - 2, 5, { rot: i * 30 }) : '')
    }
    return (
      // 太陽
      rays(120, 78, 36, 50, 24, { color: P.gold, width: 2, opacity: 0.85 }) +
      `<g fill="${P.gold}">${dots}</g>` +
      `<circle cx="120" cy="78" r="30" fill="${P.gold}"/>` +
      `<circle cx="120" cy="78" r="23" fill="${P.goldLight}"/>` +
      ground(120, 290, 106) +
      // 門外的草地與小徑
      `<path d="M66 284Q120 190 174 284Z" fill="${P.sageLight}"/>` +
      `<g fill="${P.paper}" stroke="${P.petalEdge}" stroke-width=".7"><ellipse cx="120" cy="278" rx="13" ry="4.5"/><ellipse cx="118" cy="258" rx="10" ry="3.6"/><ellipse cx="121" cy="241" rx="8" ry="3"/><ellipse cx="119" cy="227" rx="6" ry="2.4"/><ellipse cx="120" cy="216" rx="4.4" ry="1.8"/></g>` +
      // 門柱與拱
      `<rect x="56" y="148" width="12" height="138" rx="2" fill="${P.bark}"/>` +
      `<rect x="172" y="148" width="12" height="138" rx="2" fill="${P.bark}"/>` +
      `<path d="M62 152Q120 98 178 152" fill="none" stroke="${P.bark}" stroke-width="5" stroke-linecap="round"/>` +
      vine +
      // 往外敞開的兩扇門
      `<path d="M68 196L36 206V284L68 280Z" fill="${P.ochre}" stroke="${P.bark}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="M172 196L204 206V284L172 280Z" fill="${P.ochre}" stroke="${P.bark}" stroke-width="1.4" stroke-linejoin="round"/>` +
      `<path d="M58 200V281M47 203V283M68 236L36 244M172 236L204 244M182 200V281M193 203V283" stroke="${P.bark}" stroke-width="1"/>` +
      // 雛菊
      DAISIES.map(([x, y], i) => flower(x, y, 5 + (i % 3), { petals: 8, rot: i * 11 })).join('')
    )
  },
}
