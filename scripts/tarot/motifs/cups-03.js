// 聖杯三：三只杯在空中相碰，周圍飄著花瓣（慶祝、友誼、團聚）
// （不畫舉杯跳舞的三名女子）
const PETALS = [
  [50, 90, 20, 'rose'],
  [190, 84, -30, 'white'],
  [70, 220, 50, 'white'],
  [176, 214, -10, 'rose'],
  [40, 160, -40, 'white'],
  [202, 150, 30, 'rose'],
  [120, 238, 70, 'rose'],
]

module.exports = {
  draw: ({ P, ground, cluster, sparkle, cup }) =>
    ground(120, 290, 84) +
    cup(82, 150, 1.25, { tilt: 22, water: true }) +
    cup(158, 150, 1.25, { tilt: -22, water: true }) +
    cup(120, 124, 1.25, { water: true }) +
    sparkle(100, 118, 6) +
    sparkle(140, 118, 6) +
    sparkle(120, 98, 4) +
    PETALS.map(
      ([x, y, r, c]) =>
        `<ellipse cx="${x}" cy="${y}" rx="3.6" ry="6.4" transform="rotate(${r} ${x} ${y})" fill="${c === 'rose' ? P.roseLight : P.white}" stroke="${c === 'rose' ? P.rose : P.petalEdge}" stroke-width=".6"/>`,
    ).join('') +
    cluster(80, 294, 0.75) +
    cluster(160, 294, 0.75),
}
