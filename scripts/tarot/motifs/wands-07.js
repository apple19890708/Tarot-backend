// 權杖七：一根木枝立在高處的小丘上，下方六根斜指向它（堅守立場、以一敵多）
// （不畫站在高處防守的人）
module.exports = {
  draw: ({ P, ground, grass, sparkle, wand }) =>
    ground(120, 292, 104) +
    `<path d="M62 210Q120 150 178 210Q170 220 120 222Q70 220 62 210Z" fill="${P.sage}"/>` +
    `<path d="M80 198Q120 166 160 198" fill="none" stroke="${P.sageLight}" stroke-width="3" opacity=".7"/>` +
    wand(120, 196, 138, -90, { w: 6 }) +
    [
      [26, 296, -52],
      [48, 298, -56],
      [70, 300, -60],
    ]
      .map(([x, y, a]) => wand(x, y, 96, a, { w: 4.2 }) + wand(240 - x, y, 96, -180 - a, { w: 4.2 }))
      .join('') +
    sparkle(150, 80, 5) +
    grass(120, 236, 22),
}
