// V 教皇：拱形小禮拜堂裡掛著一口鐘，下方兩把交疊的鑰匙（傳承、教導）
// （不畫坐著的教皇與兩位信徒）
function key(P, rot) {
  return (
    `<g transform="translate(120 236) rotate(${rot})">` +
    `<path d="M0 -40V30" stroke="${P.gold}" stroke-width="4" stroke-linecap="round"/>` +
    `<circle cx="0" cy="-48" r="9" fill="none" stroke="${P.gold}" stroke-width="4"/>` +
    `<circle cx="0" cy="-48" r="3" fill="${P.goldLight}"/>` +
    `<path d="M2 18H11V24H2M2 28H9" stroke="${P.gold}" stroke-width="3.4" fill="none"/>` +
    `</g>`
  )
}

module.exports = {
  draw: ({ P, sprig, star, ground, C }) =>
    ground(120, 292, 98) +
    // 拱門
    `<path d="M56 290V140A64 64 0 0 1 184 140V290Z" fill="${C.stone}" stroke="${C.stoneEdge}" stroke-width="1.4"/>` +
    `<path d="M76 290V146A44 44 0 0 1 164 146V290Z" fill="${P.lavLight}"/>` +
    `<path d="M56 182H76M164 182H184M56 228H76M164 228H184M66 140V160M174 140V160" stroke="${C.stoneEdge}" stroke-width=".8"/>` +
    `<rect x="46" y="284" width="148" height="8" rx="2" fill="${C.stone}" stroke="${C.stoneEdge}" stroke-width="1"/>` +
    star(120, 68, 7, { fill: P.gold }) +
    // 鐘
    `<path d="M120 102V134" stroke="${P.goldDeep}" stroke-width="1.6"/>` +
    `<path d="M102 172Q102 136 120 134Q138 136 138 172L143 178H97Z" fill="${P.gold}" stroke="${P.goldDeep}" stroke-width="1"/>` +
    `<path d="M108 168Q108 146 116 140" fill="none" stroke="${P.goldLight}" stroke-width="2" stroke-linecap="round"/>` +
    `<circle cx="120" cy="182" r="4" fill="${P.goldDeep}"/>` +
    `<path d="M88 150q-6 4-6 12M152 150q6 4 6 12" fill="none" stroke="${P.gold}" stroke-width="1" stroke-linecap="round" opacity=".6"/>` +
    // 交疊的鑰匙
    key(P, -28) +
    key(P, 28) +
    // 拱門上的藤蔓
    sprig(50, 288, 120, -96, { leaves: 6, tipSize: 7 }) +
    sprig(190, 288, 120, -84, { leaves: 6, tip: 'bud', tipSize: 7 }),
}
