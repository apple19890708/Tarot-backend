// 聖杯六：六只杯排成弧形，中間插著一個紙風車（童年、懷舊、單純的善意）
// （不畫庭院裡遞花杯的兩個孩子）
module.exports = {
  draw: ({ P, f, ground, cluster, cup, sparkle }) => {
    // 六只杯排成往下彎的弧（像笑臉），風車在弧的上方
    const cups = [160, 132, 104, 76, 48, 20].map((deg) => {
      const r = (deg * Math.PI) / 180
      return cup(f(120 + 92 * Math.cos(r)), f(178 + 56 * Math.sin(r)), 0.78, { water: true })
    })
    const blades = [
      ['M0 0L0 -26L18 -10Z', P.lav],
      ['M0 0L26 0L10 18Z', P.roseLight],
      ['M0 0L0 26L-18 10Z', P.sageLight],
      ['M0 0L-26 0L-10 -18Z', P.goldLight],
    ]
      .map(([d, c]) => `<path d="${d}" fill="${c}" stroke="${P.lavDeep}" stroke-width=".8" stroke-linejoin="round"/>`)
      .join('')
    return (
      ground(120, 290, 96) +
      `<path d="M120 270V150" stroke="${P.bark}" stroke-width="3" stroke-linecap="round"/>` +
      `<g transform="translate(120 146) rotate(15)">${blades}</g>` +
      `<circle cx="120" cy="146" r="3.4" fill="${P.gold}"/>` +
      cups.join('') +
      sparkle(84, 110, 4) +
      sparkle(160, 104, 4) +
      cluster(120, 294, 0.7)
    )
  },
}
