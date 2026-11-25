// 5 樹木：一棵開著白花的大樹
const BLOSSOMS = [
  [96, 96],
  [140, 88],
  [70, 146],
  [118, 128],
  [166, 140],
  [92, 176],
  [150, 182],
  [124, 70],
  [186, 168],
  [56, 176],
]

module.exports = {
  facing: null,
  draw: ({ P, ground, flower, grass }) =>
    ground(120, 290, 92) +
    `<path d="M110 292Q116 236 104 196L120 210L136 196Q124 236 132 292Z" fill="${P.bark}"/>` +
    `<path d="M114 220Q96 206 84 190M126 216Q142 204 156 192" stroke="${P.bark}" stroke-width="5" fill="none" stroke-linecap="round"/>` +
    `<g fill="${P.sage}" opacity=".92"><circle cx="120" cy="128" r="54"/><circle cx="76" cy="162" r="36"/><circle cx="164" cy="160" r="38"/><circle cx="96" cy="96" r="34"/><circle cx="146" cy="98" r="34"/></g>` +
    `<g fill="${P.sageLight}" opacity=".7"><circle cx="104" cy="104" r="20"/><circle cx="150" cy="112" r="16"/><circle cx="74" cy="150" r="14"/></g>` +
    `<g fill="${P.sageDeep}" opacity=".35"><circle cx="150" cy="180" r="22"/><circle cx="90" cy="186" r="18"/></g>` +
    BLOSSOMS.map(([x, y], i) => flower(x, y, 6 + (i % 3), { rot: i * 23 })).join('') +
    grass(80, 290, 30) +
    grass(166, 290, 30),
}
