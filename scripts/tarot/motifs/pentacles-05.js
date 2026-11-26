// 錢幣五：五枚錢幣散落在雪地，一把破傘，一朵在雪中仍開著的白花（匱乏、受冷落，但仍有一點希望）
// （不畫雪中的兩個窮人與彩繪玻璃窗）
const FLAKES = [
  [30, 80],
  [70, 120],
  [110, 70],
  [160, 100],
  [200, 70],
  [50, 170],
  [190, 160],
  [140, 140],
  [94, 190],
]

module.exports = {
  draw: ({ P, leaf, flower, coin, C }) =>
    `<circle cx="120" cy="150" r="104" fill="${C.night}" opacity=".5"/>` +
    // 雪地
    `<path d="M10 240Q60 222 120 232Q180 222 230 240Q236 270 220 292Q120 306 20 292Q4 270 10 240Z" fill="${P.white}" stroke="${P.petalEdge}" stroke-width=".8"/>` +
    coin(50, 250, 14) +
    coin(92, 266, 12) +
    coin(150, 270, 13) +
    coin(196, 254, 12) +
    coin(120, 240, 11) +
    `<path d="M36 258Q50 252 64 258M80 272Q92 266 104 272M138 276Q150 270 162 276" fill="none" stroke="${P.white}" stroke-width="5" stroke-linecap="round"/>` +
    // 破傘
    `<path d="M120 184V236" stroke="${P.bark}" stroke-width="2.4"/>` +
    `<path d="M120 236q0 6 -6 6" fill="none" stroke="${P.bark}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M76 188Q82 150 120 146Q158 150 164 188Q150 180 140 188L132 176L124 190Q110 180 98 188Q88 180 76 188Z" fill="${P.lav}" stroke="${P.lavDeep}" stroke-width="1" stroke-linejoin="round"/>` +
    `<path d="M120 146L98 188M120 146L140 188" stroke="${P.lavDeep}" stroke-width=".8"/>` +
    // 雪中的白花
    `<path d="M180 240Q178 222 182 210" fill="none" stroke="${P.sageDeep}" stroke-width="1.6"/>` +
    leaf(180, 230, 12, 200, P.sage) +
    flower(182, 206, 8) +
    `<g fill="${P.white}" stroke="${P.petalEdge}" stroke-width=".5">${FLAKES.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${2 + (i % 3) * 0.6}"/>`).join('')}</g>`,
}
