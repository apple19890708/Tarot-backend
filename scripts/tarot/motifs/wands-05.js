// 權杖五：五根木枝互相交錯碰撞，交點迸出小火花（衝突、競爭、意見不合）
// （不畫揮杖打鬥的五個人）
module.exports = {
  draw: ({ P, ground, grass, sparkle, wand }) =>
    ground(120, 290, 100) +
    wand(26, 252, 196, -38, { w: 5 }) +
    wand(214, 252, 196, -142, { w: 5 }) +
    wand(56, 292, 200, -68, { w: 5 }) +
    wand(184, 292, 200, -112, { w: 5 }) +
    wand(120, 292, 196, -94, { w: 5 }) +
    sparkle(120, 184, 9, P.gold) +
    sparkle(92, 214, 6, P.ochre) +
    sparkle(150, 214, 6, P.ochre) +
    sparkle(118, 132, 6, P.gold) +
    sparkle(76, 160, 4, P.gold) +
    sparkle(164, 160, 4, P.gold) +
    grass(30, 290, 22) +
    grass(210, 290, 22),
}
