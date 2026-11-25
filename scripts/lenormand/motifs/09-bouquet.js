// 9 花束：用緞帶綁起來的白色花束
const LEAVES = [
  [-160, 70],
  [-130, 78],
  [-100, 70],
  [-70, 76],
  [-40, 66],
  [-20, 50],
  [-200, 54],
]
const FLOWERS = [
  [120, 132, 15],
  [88, 152, 13],
  [152, 150, 13],
  [102, 108, 12],
  [140, 106, 12],
  [120, 172, 12],
  [72, 120, 10],
  [168, 118, 10],
]

module.exports = {
  facing: null,
  draw: ({ P, leaf, flower, bud }) =>
    LEAVES.map(([a, l], i) => leaf(120, 200, l, a, i % 2 ? P.sage : P.sageDeep, 0.26)).join('') +
    bud(60, 96, 9, -130) +
    bud(182, 92, 9, -50) +
    bud(120, 78, 9, -90) +
    FLOWERS.map(([x, y, r], i) => flower(x, y, r, { petals: i % 3 ? 5 : 6, rot: i * 17 })).join('') +
    `<path d="M98 200L120 292L142 200Z" fill="${P.goldLight}" stroke="${P.gold}" stroke-width="1.4"/>` +
    `<path d="M108 204L120 280M132 204L120 280" stroke="${P.gold}" stroke-width=".8" opacity=".6"/>` +
    `<g fill="${P.rose}"><ellipse cx="104" cy="214" rx="15" ry="8" transform="rotate(-20 104 214)"/><ellipse cx="136" cy="214" rx="15" ry="8" transform="rotate(20 136 214)"/>` +
    `<path d="M116 216L100 252L108 250L120 220ZM124 216L140 252L132 250L120 220Z"/></g>` +
    `<circle cx="120" cy="216" r="6" fill="${P.roseLight}" stroke="${P.rose}" stroke-width="1.4"/>`,
}
