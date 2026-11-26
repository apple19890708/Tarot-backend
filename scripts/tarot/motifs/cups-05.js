// 聖杯五：三只杯倒下、水流了出來，兩只還直立著；直立的杯旁冒出一株新芽（失落，但還有留下的）
// （不畫披黑斗篷的人，也不畫河與橋）
module.exports = {
  draw: ({ P, leaf, ground, cup, sparkle }) =>
    ground(120, 290, 104) +
    // 流出的水
    `<path d="M24 284Q50 276 76 282Q100 290 124 280" fill="none" stroke="${P.water}" stroke-width="5" stroke-linecap="round" opacity=".6"/>` +
    `<ellipse cx="56" cy="286" rx="34" ry="5" fill="${P.sky}"/>` +
    cup(46, 262, 1, { tilt: -100, water: true }) +
    cup(92, 268, 1, { tilt: -86, water: true }) +
    cup(70, 232, 0.9, { tilt: -108, water: true }) +
    // 直立的兩只
    cup(152, 236, 1.15, { water: true }) +
    cup(198, 240, 1.05, { water: true }) +
    // 新芽
    `<path d="M176 290Q174 272 178 258" fill="none" stroke="${P.sageDeep}" stroke-width="1.8" stroke-linecap="round"/>` +
    leaf(178, 260, 14, -150, P.sage, 0.45) +
    leaf(178, 260, 14, -30, P.sage, 0.45) +
    sparkle(178, 236, 4),
}
