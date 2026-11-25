// 13 孩童：拿著小花、朝右看的孩子（朝右）
module.exports = {
  facing: 'right',
  draw: ({ P, ground, cluster, sprig }) =>
    ground(120, 288, 92) +
    `<path d="M108 238V282M126 238V282" stroke="${P.ink}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M102 162Q117 154 134 162L150 240H86Z" fill="${P.roseLight}" stroke="${P.rose}" stroke-width="1.6"/>` +
    `<path d="M92 226H144" stroke="${P.paper}" stroke-width="3" opacity=".9"/>` +
    `<path d="M106 172Q92 196 96 212" stroke="${P.roseLight}" stroke-width="7" stroke-linecap="round" fill="none"/>` +
    `<path d="M132 172L158 162" stroke="${P.roseLight}" stroke-width="7" stroke-linecap="round"/>` +
    `<circle cx="160" cy="161" r="4.5" fill="${P.paper}" stroke="${P.rose}" stroke-width="1"/>` +
    sprig(161, 160, 62, -78, { leaves: 2, tipSize: 9 }) +
    `<circle cx="118" cy="138" r="18" fill="${P.paper}" stroke="${P.ochre}" stroke-width="1.2"/>` +
    `<path d="M135 140q5 2 1 5" fill="none" stroke="${P.ochre}" stroke-width="1.4"/>` +
    `<path d="M100 140Q96 114 120 118Q138 120 136 132Q122 124 108 134Q106 144 100 140Z" fill="${P.bark}"/>` +
    `<circle cx="128" cy="138" r="1.8" fill="${P.ink}"/>` +
    `<circle cx="126" cy="148" r="3.5" fill="${P.rose}" opacity=".35"/>` +
    cluster(58, 290, 0.9) +
    cluster(188, 290, 0.7),
}
