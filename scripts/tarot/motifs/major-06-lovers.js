// VI 戀人：兩棵樹的枝條交纏成心形拱門，拱門下一枝並蒂白花（選擇、結合）
// （不畫天使與兩個人）
const LEFT = [
  [72, 196, 200],
  [58, 168, 160],
  [56, 138, 220],
  [66, 114, 150],
  [86, 100, 230],
  [106, 106, 170],
]

module.exports = {
  draw: ({ P, leaf, flower, heart, ground, grass, sparkle }) => {
    const side = (mirror) =>
      LEFT.map(([x, y, a], i) => {
        const px = mirror ? 240 - x : x
        const pa = mirror ? 180 - a : a
        return leaf(px, y, 18, pa, i % 2 ? P.sage : P.sageDeep) + leaf(px, y, 14, pa + 110, P.sage) + (i % 2 ? '' : flower(px, y, 7, { rot: i * 21 }))
      }).join('')
    return (
      heart(120, 150, 48, { fill: P.roseLight }).replace('/>', ' opacity=".55"/>') +
      ground(120, 292, 98) +
      // 樹幹
      `<path d="M58 292Q66 250 84 214M182 292Q174 250 156 214" fill="none" stroke="${P.bark}" stroke-width="9" stroke-linecap="round"/>` +
      // 交纏成心形的枝
      `<path d="M84 214Q40 172 60 126Q82 86 120 124Q158 86 180 126Q200 172 156 214" fill="none" stroke="${P.bark}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="M120 124Q112 112 116 102M120 124Q128 112 124 102" fill="none" stroke="${P.bark}" stroke-width="2" stroke-linecap="round"/>` +
      side(false) +
      side(true) +
      flower(120, 100, 6) +
      // 並蒂花
      `<path d="M120 292Q117 252 120 216M120 220Q112 210 108 196M120 220Q128 210 132 196" fill="none" stroke="${P.sageDeep}" stroke-width="1.8" stroke-linecap="round"/>` +
      leaf(119, 262, 18, 210, P.sage) +
      leaf(120, 246, 18, -30, P.sage) +
      flower(108, 191, 9, { rot: 10 }) +
      flower(132, 191, 9, { rot: 40 }) +
      sparkle(120, 164, 5) +
      grass(30, 290, 22) +
      grass(210, 290, 22)
    )
  },
}
