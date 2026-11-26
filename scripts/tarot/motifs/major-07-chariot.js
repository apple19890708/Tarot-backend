// VII 戰車：花環做成的車輪向前滾動，後方延伸的道路，輪軸上揚著一面三角旗（意志、前進）
// （不畫車上的戰士與黑白獅身人面像）
module.exports = {
  draw: ({ P, f, leaf, flower, sparkle }) => {
    const cx = 120
    const cy = 222
    let rim = ''
    for (let i = 0; i < 20; i += 1) {
      const a = (360 / 20) * i
      const r = (a * Math.PI) / 180
      rim += leaf(cx + 48 * Math.cos(r), cy + 48 * Math.sin(r), 15, a + 100, i % 2 ? P.sage : P.sageDeep)
    }
    let spokes = ''
    for (let i = 0; i < 8; i += 1) {
      const r = (i * 45 * Math.PI) / 180
      spokes += `M${f(cx + 9 * Math.cos(r))} ${f(cy + 9 * Math.sin(r))}L${f(cx + 40 * Math.cos(r))} ${f(cy + 40 * Math.sin(r))}`
    }
    return (
      // 地平線與道路
      `<ellipse cx="120" cy="236" rx="116" ry="66" fill="${P.sageLight}" opacity=".75"/>` +
      `<path d="M44 296L110 174H130L196 296Q120 306 44 296Z" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width=".8"/>` +
      `<path d="M120 298V178" stroke="${P.goldLight}" stroke-width="2" stroke-dasharray="8 9"/>` +
      // 速度線
      `<path d="M22 200H58M14 218H50M26 236H58" stroke="${P.gold}" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>` +
      // 旗
      `<path d="M120 222V96" stroke="${P.goldDeep}" stroke-width="2.6" stroke-linecap="round"/>` +
      `<path d="M120 100Q146 104 172 116Q146 124 120 134Z" fill="${P.lav}"/>` +
      `<path d="M126 108L158 116L126 124" fill="none" stroke="${P.paper}" stroke-width="1.2" opacity=".8"/>` +
      `<circle cx="120" cy="94" r="3.6" fill="${P.gold}"/>` +
      // 車輪
      `<ellipse cx="${cx}" cy="276" rx="44" ry="6" fill="${P.sageDeep}" opacity=".2"/>` +
      `<circle cx="${cx}" cy="${cy}" r="48" fill="none" stroke="${P.bark}" stroke-width="3"/>` +
      `<circle cx="${cx}" cy="${cy}" r="40" fill="${P.paper}" fill-opacity=".5" stroke="${P.bark}" stroke-width="1.4"/>` +
      `<path d="${spokes}" stroke="${P.bark}" stroke-width="2.4" stroke-linecap="round"/>` +
      rim +
      [0, 90, 180, 270].map((d) => flower(cx + 48 * Math.cos((d * Math.PI) / 180), cy + 48 * Math.sin((d * Math.PI) / 180), 7.5, { rot: d })).join('') +
      `<circle cx="${cx}" cy="${cy}" r="9" fill="${P.gold}"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="${P.goldDeep}"/>` +
      sparkle(196, 72, 5) +
      sparkle(44, 98, 4)
    )
  },
}
