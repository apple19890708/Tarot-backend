// 31 太陽：金色的太陽與光芒
module.exports = {
  facing: null,
  draw: ({ P, f, cluster, sparkle }) => {
    let rays = ''
    for (let i = 0; i < 16; i += 1) {
      const a = (Math.PI * 2 * i) / 16
      const long = i % 2 === 0
      const r1 = 56
      const r2 = long ? 98 : 80
      const w = long ? 0.09 : 0.07
      rays += `<path d="M${f(120 + r1 * Math.cos(a - w))} ${f(150 + r1 * Math.sin(a - w))}L${f(120 + r2 * Math.cos(a))} ${f(150 + r2 * Math.sin(a))}L${f(120 + r1 * Math.cos(a + w))} ${f(150 + r1 * Math.sin(a + w))}Z" fill="${long ? P.gold : P.goldLight}"/>`
    }
    return (
      rays +
      `<circle cx="120" cy="150" r="52" fill="${P.gold}"/>` +
      `<circle cx="120" cy="150" r="42" fill="${P.goldLight}"/>` +
      `<circle cx="106" cy="136" r="14" fill="${P.paper}" opacity=".6"/>` +
      sparkle(36, 260, 6) +
      sparkle(206, 254, 5) +
      cluster(120, 294, 1)
    )
  },
}
