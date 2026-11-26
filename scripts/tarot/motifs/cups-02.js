// 聖杯二：兩只杯並排，杯口之間一條開花的藤連成拱（連結、互相吸引）
// （不畫交換杯子的兩人與雙蛇杖獅頭）
module.exports = {
  draw: ({ P, f, leaf, flower, ground, cluster, sparkle, heart, cup }) => {
    let vine = ''
    for (let i = 1; i < 8; i += 1) {
      const t = i / 8
      const x = (1 - t) * (1 - t) * 78 + 2 * (1 - t) * t * 120 + t * t * 162
      const y = (1 - t) * (1 - t) * 176 + 2 * (1 - t) * t * 96 + t * t * 176
      vine += leaf(x, y, 13, i % 2 ? -50 : -130, i % 2 ? P.sage : P.sageDeep) + (i % 2 ? '' : flower(x, y, 6, { rot: i * 20 }))
    }
    return (
      ground(120, 290, 90) +
      `<path d="M78 176Q120 96 162 176" fill="none" stroke="${P.sageDeep}" stroke-width="1.8"/>` +
      vine +
      heart(120, 152, 10, { fill: P.roseLight, stroke: P.rose, sw: 1 }) +
      cup(76, 184, 1.35, { water: true }) +
      cup(164, 184, 1.35, { water: true }) +
      sparkle(120, 110, 4) +
      cluster(120, 294, 0.75)
    )
  },
}
