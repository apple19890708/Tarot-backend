// IX 隱士：雪夜的山徑，一盞提燈掛在枯枝上，燈裡亮著一顆六角星（向內探尋、為自己點燈）
// （不畫披斗篷、持杖提燈的老人）
const FLAKES = [
  [40, 140],
  [64, 176],
  [190, 160],
  [210, 196],
  [176, 70],
  [98, 150],
  [30, 210],
  [210, 120],
  [80, 60],
]

module.exports = {
  draw: ({ P, star, glow, C }) =>
    `<circle cx="120" cy="150" r="106" fill="${C.night}" opacity=".6"/>` +
    // 雪坡與小徑
    `<path d="M14 300Q70 214 214 192Q236 196 230 240Q226 280 200 300Z" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width=".8"/>` +
    `<path d="M24 300Q96 250 226 236" fill="none" stroke="${P.sky}" stroke-width="10" opacity=".55"/>` +
    `<path d="M48 296Q110 262 150 238Q178 222 206 210" fill="none" stroke="${P.goldDeep}" stroke-width="1.6" stroke-dasharray="2 6" stroke-linecap="round" opacity=".7"/>` +
    // 小松樹
    `<path d="M196 214L186 236H206ZM196 202L188 222H204Z" fill="${P.sageDeep}"/>` +
    `<path d="M214 222L208 236H220ZM214 214L209 228H219Z" fill="${P.sage}"/>` +
    // 枯枝
    `<path d="M14 92Q70 88 150 102" fill="none" stroke="${P.bark}" stroke-width="6" stroke-linecap="round"/>` +
    `<path d="M60 90Q66 72 82 66M102 94Q114 80 124 78M40 91Q34 78 26 74M130 99Q142 92 156 94" fill="none" stroke="${P.bark}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M20 88Q50 82 80 86Q110 88 140 96" fill="none" stroke="${P.white}" stroke-width="2.6" stroke-linecap="round"/>` +
    // 提燈
    glow(140, 146, 40, P.goldLight, 0.4) +
    glow(140, 146, 22, P.goldLight, 0.6) +
    `<path d="M140 101V120" stroke="${P.goldDeep}" stroke-width="1.2"/>` +
    `<circle cx="140" cy="122" r="3" fill="none" stroke="${P.goldDeep}" stroke-width="1.2"/>` +
    `<path d="M127 132H153L146 124H134Z" fill="${P.gold}"/>` +
    `<rect x="130" y="132" width="20" height="30" fill="${P.goldLight}" stroke="${P.gold}" stroke-width="1.6"/>` +
    `<path d="M140 132V162" stroke="${P.gold}" stroke-width=".8" opacity=".5"/>` +
    `<path d="M127 162H153L148 169H132Z" fill="${P.gold}"/>` +
    star(140, 147, 7.5, { points: 6, inner: 0.5, fill: P.gold }) +
    `<g fill="${P.white}" stroke="${P.petalEdge}" stroke-width=".5">${FLAKES.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${2 + (i % 3) * 0.6}"/>`).join('')}</g>`,
}
