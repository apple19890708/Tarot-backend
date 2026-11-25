// 2 四葉草：一株四葉草配小白花
module.exports = {
  facing: null,
  draw: ({ P, heart, cluster, sparkle, flower, ground }) => {
    const s = 31
    const cx = 120
    const cy = 150
    return (
      ground(120, 290, 80) +
      `<path d="M${cx} ${cy}Q128 220 108 290" fill="none" stroke="${P.sageDeep}" stroke-width="4" stroke-linecap="round"/>` +
      heart(cx, cy - s, s, { fill: P.sage }) +
      heart(cx + s, cy, s, { fill: P.sageDeep, rot: 90 }) +
      heart(cx, cy + s, s, { fill: P.sage, rot: 180 }) +
      heart(cx - s, cy, s, { fill: P.sageDeep, rot: 270 }) +
      `<path d="M${cx} ${cy - 44}V${cy + 44}M${cx - 44} ${cy}H${cx + 44}" stroke="${P.sageLight}" stroke-width="1.4" opacity=".8"/>` +
      `<circle cx="${cx}" cy="${cy}" r="4" fill="${P.goldLight}"/>` +
      sparkle(44, 84, 7) +
      sparkle(198, 70, 5) +
      sparkle(204, 214, 6) +
      sparkle(38, 200, 4) +
      flower(176, 252, 8) +
      cluster(70, 286, 0.9) +
      cluster(164, 288, 0.8)
    )
  },
}
