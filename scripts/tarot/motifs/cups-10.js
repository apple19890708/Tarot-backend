// 聖杯十：十只杯圍成一圈，中央一團心形的白花（家庭圓滿、情感的歸宿）
// （不畫天上的杯虹，也不畫家人與房子）
const HEART_FLOWERS = [
  [120, 196, 8],
  [104, 160, 7],
  [136, 160, 7],
  [92, 174, 6],
  [148, 174, 6],
  [108, 184, 6],
  [132, 184, 6],
  [120, 170, 7],
  [96, 150, 5],
  [144, 150, 5],
]

module.exports = {
  draw: ({ P, leaf, flower, heart, cup, sparkle }) => {
    let ring = ''
    for (let i = 0; i < 10; i += 1) {
      const a = -Math.PI / 2 + (Math.PI * 2 * i) / 10
      ring += cup(120 + 88 * Math.cos(a), 170 + 100 * Math.sin(a) - 12, 0.5, { water: true })
    }
    return (
      heart(120, 168, 40, { fill: P.roseLight }) +
      leaf(120, 168, 30, 200, P.sage) +
      leaf(120, 168, 30, -20, P.sage) +
      leaf(120, 168, 26, 90, P.sageDeep) +
      HEART_FLOWERS.map(([x, y, r], i) => flower(x, y, r, { rot: i * 19 })).join('') +
      ring +
      sparkle(40, 80, 4) +
      sparkle(200, 268, 4)
    )
  },
}
