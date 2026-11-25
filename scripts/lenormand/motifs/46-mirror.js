// 46 鏡子：鑲著金邊的手鏡
module.exports = {
  facing: null,
  draw: ({ P, cluster, flower, sparkle }) => {
    let beads = ''
    for (let i = 0; i < 16; i += 1) {
      const a = (Math.PI * 2 * i) / 16
      beads += `<circle cx="${120 + 70 * Math.cos(a)}" cy="${140 + 86 * Math.sin(a)}" r="2.2"/>`
    }
    return (
      `<path d="M112 222H128L132 290Q120 298 108 290Z" fill="${P.gold}"/>` +
      `<path d="M106 248H134M108 268H132" stroke="${P.goldDeep}" stroke-width="3"/>` +
      `<ellipse cx="120" cy="140" rx="64" ry="80" fill="${P.sky}" stroke="${P.gold}" stroke-width="9"/>` +
      `<ellipse cx="120" cy="140" rx="64" ry="80" fill="none" stroke="${P.goldDeep}" stroke-width="1.2"/>` +
      `<g fill="${P.goldLight}">${beads}</g>` +
      `<path d="M84 96L118 70M80 128L142 78M96 170L150 124" stroke="${P.paper}" stroke-width="5" stroke-linecap="round" opacity=".7"/>` +
      flower(120, 56, 9) +
      flower(104, 62, 6) +
      flower(136, 62, 6) +
      sparkle(190, 92, 6) +
      cluster(120, 298, 0.8)
    )
  },
}
