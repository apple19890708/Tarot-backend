// 45 牆：爬滿藤蔓的磚牆
module.exports = {
  facing: null,
  draw: ({ P, leaf, flower, ground }) => {
    let bricks = ''
    for (let r = 0; r < 7; r += 1) {
      const y = 150 + r * 20
      const offset = r % 2 ? -20 : 0
      for (let x = 24 + offset; x < 216; x += 40) {
        const x0 = Math.max(24, x)
        const x1 = Math.min(216, x + 38)
        bricks += `<rect x="${x0}" y="${y}" width="${x1 - x0}" height="18" rx="2"/>`
      }
    }
    const vine = 'M60 290Q40 250 70 220Q100 194 80 166Q66 140 96 120M150 290Q176 250 150 214Q130 184 168 160'
    const leaves = [
      [56, 262, 200],
      [70, 222, -20],
      [92, 200, 30],
      [80, 168, 190],
      [90, 130, -40],
      [164, 262, -20],
      [152, 214, 200],
      [150, 188, -30],
      [166, 162, 210],
    ]
    return (
      ground(120, 292, 104) +
      `<rect x="20" y="138" width="200" height="12" rx="3" fill="${P.lav}"/>` +
      `<g fill="#e3d7c3" stroke="#cbb99f" stroke-width="1">${bricks}</g>` +
      `<path d="${vine}" fill="none" stroke="${P.sageDeep}" stroke-width="2"/>` +
      leaves.map(([x, y, a], i) => leaf(x, y, 18, a, i % 2 ? P.sage : P.sageDeep)).join('') +
      flower(96, 120, 8) +
      flower(168, 160, 7) +
      flower(70, 220, 6) +
      flower(150, 240, 6)
    )
  },
}
