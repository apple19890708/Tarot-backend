// 聖杯九：九只杯排在拱形的架子上，正中一顆金色的星（願望實現、心滿意足）
// （不畫坐在杯架前抱胸的人）
module.exports = {
  draw: ({ P, star, ground, cluster, cup, glow, sparkle }) => {
    let cups = ''
    for (let i = 0; i < 9; i += 1) {
      const a = Math.PI + (Math.PI * i) / 8
      cups += cup(120 + 88 * Math.cos(a), 236 + 132 * Math.sin(a) - 4, 0.56, { water: true })
    }
    return (
      ground(120, 290, 100) +
      `<path d="M32 254V236A88 132 0 0 1 208 236V254" fill="none" stroke="${P.bark}" stroke-width="4" stroke-linecap="round"/>` +
      `<path d="M26 254H214" stroke="${P.bark}" stroke-width="4" stroke-linecap="round"/>` +
      cups +
      glow(120, 186, 34, P.goldLight, 0.7) +
      star(120, 186, 20, { fill: P.gold }) +
      star(120, 186, 9, { fill: P.goldLight }) +
      sparkle(92, 160, 4) +
      sparkle(150, 212, 4) +
      cluster(120, 294, 0.75)
    )
  },
}
