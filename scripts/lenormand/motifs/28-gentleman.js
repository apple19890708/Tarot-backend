// 28 紳士：戴高帽、拿手杖、朝右的紳士（朝右；和淑女相鄰時，淑女在右邊才會「對視」）
module.exports = {
  facing: 'right',
  draw: ({ P, ground, cluster }) =>
    ground(120, 290, 96) +
    `<path d="M108 210L104 284H115L121 232L125 284H136L134 210Z" fill="${P.lavDeep}"/>` +
    `<ellipse cx="113" cy="287" rx="9" ry="3.5" fill="${P.ink}"/><ellipse cx="134" cy="287" rx="9" ry="3.5" fill="${P.ink}"/>` +
    `<path d="M102 194L88 246L108 222Z" fill="${P.ink}"/>` +
    `<path d="M100 128Q118 118 136 128L142 212Q130 216 120 214L106 214Q96 170 100 128Z" fill="${P.ink}"/>` +
    `<path d="M114 124L120 150L126 124Z" fill="${P.paper}"/>` +
    `<path d="M118 128L120 136L122 128Z" fill="${P.rose}"/>` +
    `<circle cx="130" cy="146" r="3.5" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width=".6"/>` +
    `<path d="M134 134Q150 160 156 180" stroke="${P.ink}" stroke-width="9" fill="none" stroke-linecap="round"/>` +
    `<path d="M157 182L162 286" stroke="${P.goldDeep}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<circle cx="157" cy="182" r="5" fill="${P.paper}" stroke="${P.ochre}" stroke-width="1"/>` +
    `<circle cx="118" cy="106" r="14" fill="${P.paper}" stroke="${P.ochre}" stroke-width="1.2"/>` +
    `<path d="M131 104l4 4-4 2" fill="none" stroke="${P.ochre}" stroke-width="1.3"/>` +
    `<path d="M104 108Q102 96 112 94H122Q110 100 112 112Z" fill="${P.bark}"/>` +
    `<circle cx="124" cy="104" r="1.7" fill="${P.ink}"/>` +
    `<rect x="104" y="70" width="27" height="24" rx="2" fill="${P.ink}"/>` +
    `<rect x="104" y="86" width="27" height="4" fill="${P.goldDeep}"/>` +
    `<rect x="97" y="92" width="41" height="4" rx="2" fill="${P.ink}"/>` +
    cluster(54, 292, 0.9) +
    cluster(194, 292, 0.8),
}
