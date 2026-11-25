// 4 房屋：花園裡的小屋
module.exports = {
  facing: null,
  draw: ({ P, ground, cluster, leaf, flower }) =>
    ground(120, 282, 104) +
    `<path d="M108 282L98 312H142L132 282Z" fill="${P.goldLight}" opacity=".7"/>` +
    `<rect x="148" y="104" width="16" height="36" fill="${P.lavDeep}"/>` +
    `<rect x="62" y="160" width="116" height="122" fill="${P.paper}" stroke="${P.gold}" stroke-width="1.6"/>` +
    `<path d="M48 168L120 98L192 168Z" fill="${P.lav}"/>` +
    `<path d="M48 168L120 98L192 168" fill="none" stroke="${P.lavDeep}" stroke-width="2.5" stroke-linejoin="round"/>` +
    `<circle cx="120" cy="142" r="10" fill="${P.sky}" stroke="${P.gold}" stroke-width="1.4"/>` +
    `<path d="M108 282V232a12 12 0 0 1 24 0V282Z" fill="${P.sageDeep}"/>` +
    `<circle cx="127" cy="258" r="1.8" fill="${P.goldLight}"/>` +
    `<g fill="${P.sky}" stroke="${P.gold}" stroke-width="1.4"><rect x="74" y="190" width="24" height="26"/><rect x="142" y="190" width="24" height="26"/></g>` +
    `<path d="M86 190V216M74 203H98M154 190V216M142 203H166" stroke="${P.gold}" stroke-width="1"/>` +
    `<path d="M70 222H102M138 222H170" stroke="${P.sageDeep}" stroke-width="4" stroke-linecap="round"/>` +
    flower(78, 218, 4.5) +
    flower(92, 218, 4.5) +
    flower(148, 218, 4.5) +
    flower(162, 218, 4.5) +
    leaf(62, 200, 26, -100, P.sage) +
    leaf(64, 230, 24, -70, P.sageDeep) +
    cluster(56, 284, 0.95) +
    cluster(186, 284, 0.9),
}
