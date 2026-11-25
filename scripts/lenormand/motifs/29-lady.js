// 29 淑女：穿長裙、手拿花、朝左的淑女（朝左；和紳士相鄰時，紳士在左邊才會「對視」）
module.exports = {
  facing: 'left',
  draw: ({ P, ground, cluster, sprig }) =>
    ground(120, 290, 96) +
    `<path d="M112 154H134Q162 218 170 286H72Q84 218 112 154Z" fill="${P.lav}"/>` +
    `<path d="M108 190Q100 240 96 284M124 180V284M140 190Q148 240 152 284" stroke="${P.lavDeep}" stroke-width="1" opacity=".5" fill="none"/>` +
    `<path d="M74 280Q96 290 122 284Q146 290 170 280" stroke="${P.paper}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
    `<path d="M110 124Q122 118 136 124L134 160H112Z" fill="${P.lavDeep}"/>` +
    `<path d="M112 160H134" stroke="${P.rose}" stroke-width="3"/>` +
    `<path d="M114 132Q100 150 92 162" stroke="${P.lavDeep}" stroke-width="8" fill="none" stroke-linecap="round"/>` +
    `<circle cx="90" cy="164" r="4.5" fill="${P.paper}" stroke="${P.ochre}" stroke-width="1"/>` +
    sprig(90, 164, 58, -100, { leaves: 2, tipSize: 9 }) +
    `<path d="M118 116V124H128V116Z" fill="${P.paper}"/>` +
    `<circle cx="122" cy="104" r="13" fill="${P.paper}" stroke="${P.ochre}" stroke-width="1.2"/>` +
    `<path d="M110 102l-4 4 4 2" fill="none" stroke="${P.ochre}" stroke-width="1.3"/>` +
    `<path d="M116 92Q130 86 136 98Q138 112 132 118Q130 104 120 98Z" fill="${P.bark}"/>` +
    `<circle cx="138" cy="94" r="8" fill="${P.bark}"/>` +
    `<circle cx="134" cy="88" r="3" fill="${P.rose}"/>` +
    `<circle cx="116" cy="102" r="1.7" fill="${P.ink}"/>` +
    cluster(46, 292, 0.8) +
    cluster(196, 292, 0.9),
}
