// 24 愛心：被白花圍繞的愛心
module.exports = {
  facing: null,
  draw: ({ P, heart, flower, leaf, sparkle }) => {
    let wreath = ''
    for (let i = 0; i < 9; i += 1) {
      const a = (Math.PI * (20 + i * 17.5)) / 180
      const x = 120 + 84 * Math.cos(a)
      const y = 168 + 70 * Math.sin(a)
      wreath += leaf(x, y, 18, (i * 47) % 360, i % 2 ? P.sage : P.sageDeep) + flower(x, y, 8 + (i % 2) * 2, { rot: i * 19 })
    }
    return (
      heart(120, 150, 64, { fill: P.rose }) +
      heart(108, 136, 34, { fill: P.roseLight, rot: -8 }) +
      heart(120, 150, 64, { fill: 'none', stroke: P.paper, sw: 1.4 }) +
      wreath +
      sparkle(36, 72, 7) +
      sparkle(206, 80, 6) +
      sparkle(200, 132, 4)
    )
  },
}
