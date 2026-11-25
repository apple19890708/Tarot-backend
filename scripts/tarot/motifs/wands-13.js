// 權杖皇后：權杖頂上一頂白花冠與新月，旁邊一朵向陽的花（自信、溫暖的吸引力）
// （不畫寶座上的皇后與黑貓）
module.exports = {
  draw: ({ P, court, flower, leaf }) =>
    court('wands', 'queen', {
      over:
        `<path d="M176 286Q170 240 178 208" fill="none" stroke="${P.sageDeep}" stroke-width="1.8"/>` +
        leaf(174, 250, 18, 200, P.sage) +
        leaf(176, 232, 16, -20, P.sageDeep) +
        flower(178, 202, 12, { petals: 10, fill: P.goldLight, edge: P.gold, center: P.ochre }),
    }),
}
