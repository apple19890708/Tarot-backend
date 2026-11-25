// XXI 世界：月桂花環圍著一顆小小的地球，幾隻小鳥沿著環形軌道飛（完成、圓滿、整合）
// （不畫花環中舞蹈的人，也不畫四角四活物）
module.exports = {
  draw: ({ P, leaf, flower, flyingBird, sparkle, star }) => {
    const cx = 120
    const cy = 162
    let wreath = ''
    for (let i = 0; i < 30; i += 1) {
      const a = (i / 30) * Math.PI * 2
      const x = cx + 74 * Math.cos(a)
      const y = cy + 94 * Math.sin(a)
      const deg = (a * 180) / Math.PI
      const side = Math.cos(a) < 0 ? -1 : 1
      wreath += leaf(x, y, 15, deg - 90 * side + 30, i % 2 ? P.sage : P.sageDeep) + leaf(x, y, 13, deg - 90 * side - 30, P.sage)
    }
    return (
      `<ellipse cx="${cx}" cy="${cy}" rx="74" ry="94" fill="none" stroke="${P.sageDeep}" stroke-width="1.6"/>` +
      wreath +
      flower(cx, cy - 94, 8) +
      flower(cx, cy + 94, 8, { rot: 36 }) +
      // 地球
      `<circle cx="${cx}" cy="${cy}" r="40" fill="${P.sky}" stroke="${P.water}" stroke-width="1.4"/>` +
      `<path d="M96 142Q108 132 120 140Q128 150 118 158Q108 170 98 160Q90 150 96 142ZM128 168Q142 160 152 170Q154 186 140 192Q128 190 126 178ZM132 128Q144 126 150 136Q142 140 134 136Z" fill="${P.sage}"/>` +
      `<ellipse cx="${cx}" cy="${cy}" rx="40" ry="12" fill="none" stroke="${P.paper}" stroke-width=".9" opacity=".8"/>` +
      `<ellipse cx="${cx}" cy="${cy}" rx="16" ry="40" fill="none" stroke="${P.paper}" stroke-width=".9" opacity=".8"/>` +
      `<circle cx="106" cy="146" r="9" fill="${P.paper}" opacity=".35"/>` +
      // 環形軌道與小鳥
      `<ellipse cx="${cx}" cy="${cy}" rx="58" ry="20" transform="rotate(-18 ${cx} ${cy})" fill="none" stroke="${P.gold}" stroke-width="1" stroke-dasharray="3 5"/>` +
      flyingBird(70, 172, 1.1) +
      flyingBird(170, 144, 1) +
      flyingBird(150, 186, 0.8, P.lav) +
      star(36, 70, 5, { fill: P.gold }) +
      star(204, 262, 5, { fill: P.gold }) +
      sparkle(206, 72, 5) +
      sparkle(34, 258, 4)
    )
  },
}
