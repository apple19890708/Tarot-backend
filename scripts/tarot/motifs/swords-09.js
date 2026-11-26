// 寶劍九：九柄劍橫排在夜空，下方一個枕頭與一隻睜大眼睛的貓頭鷹（焦慮、失眠、想太多）
// （不畫坐在床上掩面的人）
module.exports = {
  draw: ({ P, sword, star, C }) =>
    `<circle cx="120" cy="150" r="106" fill="${C.night}" opacity=".6"/>` +
    [60, 75, 90, 105, 120, 135, 150, 165, 180].map((y, i) => sword(i % 2 ? 66 : 58, y, i % 2 ? 118 : 128, 0)).join('') +
    star(212, 230, 4, { fill: P.gold }) +
    // 枕頭
    `<path d="M40 262Q36 240 60 238H180Q204 240 200 262Q204 284 180 286H60Q36 284 40 262Z" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width="1"/>` +
    `<path d="M60 248Q120 256 180 248" fill="none" stroke="${P.petalEdge}" stroke-width=".8"/>` +
    // 貓頭鷹
    `<ellipse cx="120" cy="236" rx="24" ry="30" fill="${P.lav}"/>` +
    `<path d="M98 214L102 196L112 208ZM142 214L138 196L128 208Z" fill="${P.lav}"/>` +
    `<ellipse cx="120" cy="246" rx="15" ry="18" fill="${P.lavLight}"/>` +
    `<path d="M110 240q4 3 8 0M122 240q4 3 8 0M114 250q4 3 8 0M120 256q4 3 8 0" fill="none" stroke="${P.lavDeep}" stroke-width=".8"/>` +
    `<circle cx="110" cy="220" r="9" fill="${P.paper}"/><circle cx="130" cy="220" r="9" fill="${P.paper}"/>` +
    `<circle cx="110" cy="220" r="5" fill="${P.gold}"/><circle cx="130" cy="220" r="5" fill="${P.gold}"/>` +
    `<circle cx="110" cy="220" r="2.4" fill="${P.ink}"/><circle cx="130" cy="220" r="2.4" fill="${P.ink}"/>` +
    `<path d="M117 228L123 228L120 234Z" fill="${P.ochre}"/>`,
}
