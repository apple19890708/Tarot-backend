// 聖杯七：七只杯排在水邊，水中的倒影卻和實物不一樣——星、心、鑰匙、月、花、錢幣、漩渦（幻象、選擇太多）
// （不畫雲上七杯冒出各種物品）
module.exports = {
  draw: ({ P, star, heart, flower, cup, coin, crescent, sparkle }) => {
    const xs = [30, 60, 90, 120, 150, 180, 210]
    const ghosts = [
      (x, y) => star(x, y, 7, { fill: P.goldLight }),
      (x, y) => heart(x, y, 6, { fill: P.roseLight }),
      (x, y) => `<path d="M${x} ${y - 8}V${y + 6}M${x} ${y + 2}H${x + 5}M${x} ${y + 6}H${x + 4}" stroke="${P.gold}" stroke-width="2"/><circle cx="${x}" cy="${y - 10}" r="3.4" fill="none" stroke="${P.gold}" stroke-width="2"/>`,
      (x, y) => crescent(x, y, 7, P.goldLight, P.gold),
      (x, y) => flower(x, y, 7),
      (x, y) => coin(x, y, 7),
      (x, y) => `<path d="M${x} ${y}m-1 0a2 2 0 1 1 3 1a4 4 0 1 1 -6 -3a6 6 0 1 1 9 5" fill="none" stroke="${P.lavDeep}" stroke-width="1.4"/>`,
    ]
    return (
      `<ellipse cx="120" cy="268" rx="108" ry="34" fill="${P.sky}"/>` +
      `<path d="M14 232Q120 222 226 232" fill="none" stroke="${P.water}" stroke-width="1.4"/>` +
      `<path d="M14 222Q120 210 226 222V232Q120 222 14 232Z" fill="${P.sageLight}"/>` +
      xs.map((x, i) => cup(x, 196 + (i % 2) * 6, 0.62, { water: true })).join('') +
      `<g opacity=".7">${xs.map((x, i) => ghosts[i](x, 258 + (i % 2) * 6)).join('')}</g>` +
      `<path d="M30 282q10-3 20 0t20 0M110 290q10-3 20 0t20 0M170 280q10-3 20 0" fill="none" stroke="${P.paper}" stroke-width="1.2"/>` +
      sparkle(60, 110, 5) +
      sparkle(176, 96, 5) +
      sparkle(120, 140, 3.5)
    )
  },
}
