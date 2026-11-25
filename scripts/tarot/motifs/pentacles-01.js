// 錢幣王牌：一枚大錢幣半埋在土裡，兩旁冒出新芽、底下長出根（實際的開始、扎根的機會）
// （不畫雲中的手與花園拱門）
module.exports = {
  draw: ({ P, leaf, sprig, sparkle, coin, glow }) =>
    glow(120, 184, 76, P.goldLight, 0.5) +
    coin(120, 186, 60) +
    // 土
    `<path d="M14 238Q60 222 120 230Q180 222 226 238Q232 270 214 290Q120 304 26 290Q8 270 14 238Z" fill="#e2cfae"/>` +
    `<path d="M24 246Q120 232 216 246" fill="none" stroke="${P.ochre}" stroke-width="1.2" opacity=".6"/>` +
    // 根
    `<path d="M120 236Q114 256 100 270M120 236Q126 258 142 274M120 236V282M104 256Q90 262 84 276M136 258Q150 262 156 278" fill="none" stroke="${P.bark}" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>` +
    // 新芽
    sprig(52, 238, 52, -100, { leaves: 2, tipSize: 7 }) +
    sprig(188, 238, 52, -80, { leaves: 2, tip: 'bud', tipSize: 7 }) +
    leaf(76, 236, 14, -60, P.sage, 0.45) +
    leaf(164, 236, 14, -120, P.sage, 0.45) +
    sparkle(54, 110, 5) +
    sparkle(188, 104, 4),
}
