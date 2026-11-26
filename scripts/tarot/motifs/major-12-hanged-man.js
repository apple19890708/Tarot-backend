// XII 吊人：一個繭倒掛在 T 字形枝條下，周圍一圈淡淡的光暈（暫停、換個角度、等待蛻變）
// （不畫倒吊在 T 字樹上的人）
module.exports = {
  draw: ({ P, leaf, flower, ground, grass, cluster, rays, glow }) =>
    ground(120, 292, 86) +
    // T 字枝
    `<path d="M120 292V98" stroke="${P.bark}" stroke-width="7" stroke-linecap="round"/>` +
    `<path d="M44 102Q120 86 196 102" fill="none" stroke="${P.bark}" stroke-width="6" stroke-linecap="round"/>` +
    leaf(46, 102, 18, 200, P.sage) +
    leaf(194, 102, 18, -20, P.sage) +
    leaf(66, 98, 22, 110, P.sageDeep) +
    leaf(86, 96, 18, 80, P.sage) +
    leaf(120, 160, 18, 200, P.sage) +
    leaf(120, 200, 16, -30, P.sageDeep) +
    flower(66, 120, 6) +
    flower(46, 112, 5, { rot: 30 }) +
    // 光暈與繭
    glow(162, 146, 42, P.goldLight, 0.5) +
    `<circle cx="162" cy="146" r="46" fill="none" stroke="${P.gold}" stroke-width="1" opacity=".55"/>` +
    rays(162, 146, 52, 60, 12, { color: P.gold, width: 1, opacity: 0.5 }) +
    `<path d="M162 94V110" stroke="${P.petalEdge}" stroke-width="1.2"/>` +
    `<path d="M162 108Q182 124 178 150Q174 176 162 182Q150 176 146 150Q142 124 162 108Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1.2"/>` +
    `<path d="M150 128Q162 134 174 128M147 146Q162 152 177 146M150 164Q162 170 174 164" fill="none" stroke="${P.lav}" stroke-width="1"/>` +
    `<path d="M154 120Q150 140 156 168" fill="none" stroke="${P.paper}" stroke-width="2" stroke-linecap="round" opacity=".8"/>` +
    `<g fill="${P.gold}"><circle cx="157" cy="118" r="1.6"/><circle cx="168" cy="118" r="1.6"/><circle cx="162" cy="176" r="1.6"/></g>` +
    grass(84, 290, 24) +
    cluster(170, 294, 0.75),
}
