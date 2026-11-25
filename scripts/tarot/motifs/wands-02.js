// 權杖二：兩根木枝立在山丘頂，中間一條路通往遠方，路的盡頭一顆小星（規劃、選定方向）
// （不畫在城牆上手持地球儀的人）
module.exports = {
  draw: ({ P, star, ground, grass, sparkle, wand, glow }) =>
    glow(120, 112, 26, P.goldLight, 0.6) +
    star(120, 112, 9, { fill: P.gold }) +
    `<path d="M20 196Q70 170 120 182Q170 168 220 194Q226 210 214 214H26Q14 210 20 196Z" fill="${P.lavLight}"/>` +
    `<path d="M10 300Q30 230 120 222Q210 230 230 300Z" fill="${P.sageLight}"/>` +
    ground(120, 296, 104) +
    `<path d="M120 298Q104 266 124 240Q134 222 120 204" fill="none" stroke="${P.paper}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M120 298Q104 266 124 240Q134 222 120 204" fill="none" stroke="${P.goldDeep}" stroke-width="1" stroke-dasharray="2 5" opacity=".6"/>` +
    wand(70, 292, 168, -92, { w: 6 }) +
    wand(170, 292, 168, -88, { w: 6 }) +
    sparkle(160, 140, 4) +
    sparkle(80, 150, 3.5) +
    grass(42, 290, 22) +
    grass(198, 290, 22),
}
