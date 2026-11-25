// 20 庭園：開滿白花的拱門與小徑
module.exports = {
  facing: null,
  draw: ({ P, flower, leaf, cluster }) => {
    let blooms = ''
    for (let i = 0; i <= 12; i += 1) {
      const a = Math.PI - (Math.PI * i) / 12
      const x = 120 + 56 * Math.cos(a)
      const y = 170 - 56 * Math.sin(a)
      blooms += leaf(x, y, 14, (i * 37) % 360, i % 2 ? P.sage : P.sageDeep)
      if (i % 2 === 0) blooms += flower(x, y, 7, { rot: i * 20 })
    }
    for (let y = 186; y < 280; y += 22) {
      blooms += flower(64, y, 5.5) + flower(176, y + 10, 5.5) + leaf(64, y + 6, 12, 160, P.sage) + leaf(176, y + 16, 12, 20, P.sage)
    }
    return (
      `<path d="M30 296Q120 270 210 296Z" fill="${P.sageLight}"/>` +
      `<path d="M108 296L114 214H126L132 296Z" fill="${P.goldLight}" opacity=".8"/>` +
      `<ellipse cx="120" cy="214" rx="18" ry="5" fill="${P.sky}"/><path d="M120 212V196" stroke="${P.water}" stroke-width="2"/><circle cx="120" cy="194" r="3" fill="${P.sky}"/>` +
      `<path d="M64 290V170A56 56 0 0 1 176 170V290" fill="none" stroke="${P.sageDeep}" stroke-width="6"/>` +
      blooms +
      `<g fill="${P.sage}"><ellipse cx="34" cy="270" rx="26" ry="22"/><ellipse cx="206" cy="270" rx="26" ry="22"/></g>` +
      cluster(34, 282, 0.8) +
      cluster(206, 282, 0.8)
    )
  },
}
