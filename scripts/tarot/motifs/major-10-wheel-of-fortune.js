// X 命運之輪：溪邊轉動的水車，輪緣開著四季的花——上春花、右夏葉、下秋果、左冬枝（循環、轉變）
// （不畫帶字母的輪盤、蛇、胡狼與四角四活物）
module.exports = {
  draw: ({ P, f, leaf, flower, waves, sparkle }) => {
    const cx = 120
    const cy = 156
    let spokes = ''
    let paddles = ''
    for (let i = 0; i < 12; i += 1) {
      const deg = i * 30
      const r = (deg * Math.PI) / 180
      if (i % 3 === 0 || i % 3 === 2) spokes += `M${f(cx + 12 * Math.cos(r))} ${f(cy + 12 * Math.sin(r))}L${f(cx + 58 * Math.cos(r))} ${f(cy + 58 * Math.sin(r))}`
      const px = cx + 72 * Math.cos(r)
      const py = cy + 72 * Math.sin(r)
      paddles += `<rect x="${f(px - 3.5)}" y="${f(py - 8)}" width="7" height="16" rx="1.5" transform="rotate(${deg} ${f(px)} ${f(py)})"/>`
    }
    return (
      // 溪水
      `<path d="M8 240Q120 222 232 240Q240 270 224 290Q120 304 16 290Q0 270 8 240Z" fill="${P.sky}" opacity=".85"/>` +
      waves(26, 252, 188, { rows: 3, gap: 11 }) +
      // 支架
      `<path d="M66 262L${cx} ${cy}L174 262" fill="none" stroke="${P.bark}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
      // 輪子
      `<g fill="${P.ochre}">${paddles}</g>` +
      `<circle cx="${cx}" cy="${cy}" r="68" fill="none" stroke="${P.bark}" stroke-width="5"/>` +
      `<circle cx="${cx}" cy="${cy}" r="58" fill="${P.paper}" fill-opacity=".4" stroke="${P.bark}" stroke-width="2"/>` +
      `<path d="${spokes}" stroke="${P.bark}" stroke-width="3" stroke-linecap="round"/>` +
      `<circle cx="${cx}" cy="${cy}" r="13" fill="${P.gold}"/><circle cx="${cx}" cy="${cy}" r="5" fill="${P.goldDeep}"/>` +
      // 春（上）：白花
      leaf(cx, cy - 66, 16, -150, P.sage) +
      leaf(cx, cy - 66, 16, -30, P.sage) +
      flower(cx - 10, cy - 70, 7, { rot: 10 }) +
      flower(cx + 10, cy - 72, 8, { rot: 30 }) +
      // 夏（右）：茂盛的綠葉
      leaf(cx + 66, cy, 22, -40, P.sageDeep) +
      leaf(cx + 66, cy, 22, 30, P.sage) +
      leaf(cx + 66, cy, 18, 0, P.sageDeep) +
      // 秋（下）：赭色的葉與果
      leaf(cx, cy + 66, 16, 150, P.ochre) +
      leaf(cx, cy + 66, 16, 30, P.ochre) +
      `<g fill="${P.rose}"><circle cx="${cx - 5}" cy="${cy + 72}" r="4"/><circle cx="${cx + 5}" cy="${cy + 74}" r="4"/><circle cx="${cx}" cy="${cy + 66}" r="3.6"/></g>` +
      // 冬（左）：掛雪的枯枝
      `<path d="M${cx - 64} ${cy + 6}L${cx - 84} ${cy - 8}M${cx - 76} ${cy - 2}L${cx - 82} ${cy - 18}M${cx - 72} ${cy + 1}L${cx - 88} ${cy + 6}" fill="none" stroke="${P.bark}" stroke-width="2" stroke-linecap="round"/>` +
      `<g fill="${P.white}" stroke="${P.petalEdge}" stroke-width=".5"><circle cx="${cx - 84}" cy="${cy - 10}" r="2.4"/><circle cx="${cx - 82}" cy="${cy - 20}" r="2"/><circle cx="${cx - 88}" cy="${cy + 4}" r="2.2"/></g>` +
      // 水滴
      `<g fill="${P.water}"><ellipse cx="${cx + 76}" cy="${cy + 40}" rx="2" ry="3"/><ellipse cx="${cx + 70}" cy="${cy + 56}" rx="1.6" ry="2.6"/><ellipse cx="${cx - 76}" cy="${cy + 46}" rx="2" ry="3"/></g>` +
      sparkle(200, 70, 5) +
      sparkle(36, 76, 4)
    )
  },
}
