// 錢幣十：十枚錢幣像果實結在一棵大樹上，樹下一張長椅（傳承、長久的安穩、家族）
// （不畫拱門下的家族，也不排生命樹的形狀）
const FRUIT = [
  [92, 92],
  [140, 86],
  [66, 132],
  [116, 124],
  [168, 128],
  [86, 168],
  [142, 166],
  [190, 160],
  [50, 172],
  [118, 196],
]

module.exports = {
  draw: ({ P, ground, grass, coin }) =>
    ground(120, 288, 104) +
    `<path d="M108 290Q114 240 102 206L120 220L138 206Q126 240 134 290Z" fill="${P.bark}"/>` +
    `<g fill="${P.sage}" opacity=".92"><circle cx="120" cy="128" r="56"/><circle cx="72" cy="160" r="38"/><circle cx="168" cy="156" r="40"/><circle cx="94" cy="96" r="36"/><circle cx="148" cy="94" r="36"/></g>` +
    `<g fill="${P.sageLight}" opacity=".6"><circle cx="104" cy="102" r="20"/><circle cx="150" cy="112" r="16"/></g>` +
    FRUIT.map(([x, y]) => coin(x, y, 10.5)).join('') +
    // 長椅
    `<rect x="154" y="254" width="64" height="7" rx="2" fill="${P.ochre}" stroke="${P.bark}" stroke-width="1"/>` +
    `<rect x="154" y="238" width="64" height="6" rx="2" fill="${P.ochre}" stroke="${P.bark}" stroke-width="1"/>` +
    `<path d="M160 244V286M212 244V286M160 261L156 286M212 261L216 286" stroke="${P.bark}" stroke-width="2.4" stroke-linecap="round"/>` +
    grass(50, 288, 22),
}
