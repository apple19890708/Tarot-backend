// 錢幣三：三枚錢幣立在木工台上，旁邊靠著鎚子與尺（合作、手藝、被看見的專業）
// （不畫教堂拱門下的工匠與兩人）
module.exports = {
  draw: ({ P, C, ground, grass, sparkle, coin }) =>
    ground(120, 288, 104) +
    // 木工台
    `<rect x="30" y="222" width="180" height="12" rx="2" fill="${P.ochre}" stroke="${P.bark}" stroke-width="1.2"/>` +
    `<path d="M44 234V288M196 234V288M44 262H196" stroke="${P.bark}" stroke-width="4" stroke-linecap="round"/>` +
    // 三枚錢幣與小木座
    [70, 120, 170].map((x) => `<rect x="${x - 14}" y="214" width="28" height="8" rx="2" fill="${P.bark}"/>`).join('') +
    coin(70, 190, 24) +
    coin(120, 176, 28) +
    coin(170, 190, 24) +
    // 鎚子
    `<g transform="rotate(-20 214 250)"><rect x="211" y="226" width="5" height="52" rx="2" fill="${P.bark}"/><rect x="202" y="220" width="24" height="10" rx="2" fill="${C.steelEdge}"/></g>` +
    // 尺
    `<g transform="rotate(14 22 254)"><rect x="16" y="210" width="10" height="76" fill="${P.goldLight}" stroke="${P.gold}" stroke-width=".8"/><path d="M16 220h5M16 230h4M16 240h5M16 250h4M16 260h5M16 270h4" stroke="${P.goldDeep}" stroke-width=".8"/></g>` +
    sparkle(120, 130, 5) +
    grass(120, 288, 20),
}
