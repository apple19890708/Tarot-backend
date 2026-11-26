// 聖杯八：八只杯整齊收在兩層木架上，一旁的小船解開纜繩，漂向遠方（放下、離開去找更重要的）
// （不畫月下背著杖走開的人）
module.exports = {
  draw: ({ P, waves, cup, sparkle, crescent }) =>
    crescent(190, 74, 14) +
    `<ellipse cx="160" cy="266" rx="84" ry="24" fill="${P.sky}"/>` +
    waves(96, 262, 120, { rows: 2, gap: 9 }) +
    // 木架
    `<path d="M20 186H112M20 236H112" stroke="${P.bark}" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M24 186V290M108 186V290" stroke="${P.bark}" stroke-width="3" stroke-linecap="round"/>` +
    [34, 55, 76, 97].map((x) => cup(x, 162, 0.55)).join('') +
    [34, 55, 76, 97].map((x) => cup(x, 212, 0.55)).join('') +
    // 解開纜繩的小船
    `<path d="M24 268Q60 262 96 270Q126 276 150 258" fill="none" stroke="${P.ochre}" stroke-width="1.4" stroke-dasharray="4 3"/>` +
    `<path d="M150 250H206L196 266H160Z" fill="${P.ochre}" stroke="${P.bark}" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<path d="M178 250V214" stroke="${P.bark}" stroke-width="1.6"/>` +
    `<path d="M180 216L202 244H180Z" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width=".8"/>` +
    sparkle(120, 110, 4) +
    sparkle(214, 120, 3.5),
}
