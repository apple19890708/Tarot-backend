// 寶劍六：一座石拱橋，橋上立著六柄劍當欄杆；橋下的水從左邊的波濤漸漸變平（過渡、離開困境）
// （不畫船上載著人與六劍）
module.exports = {
  draw: ({ P, sword, sparkle, C }) =>
    // 水：左邊起伏、右邊平靜
    `<ellipse cx="120" cy="262" rx="108" ry="30" fill="${P.sky}"/>` +
    `<path d="M20 252q6-8 12 0t12 0t12 0t12 0M24 264q6-8 12 0t12 0t12 0M30 276q6-8 12 0t12 0" fill="none" stroke="${P.water}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M150 254H214M156 266H210M162 278H204" stroke="${P.paper}" stroke-width="1.4" stroke-linecap="round"/>` +
    // 拱橋
    `<path d="M14 236Q120 150 226 236V250H200Q120 194 40 250H14Z" fill="${C.stone}" stroke="${C.stoneEdge}" stroke-width="1.2"/>` +
    `<path d="M14 236Q120 150 226 236" fill="none" stroke="${C.stoneEdge}" stroke-width="2"/>` +
    [32, 66, 100, 140, 174, 208]
      .map((x) => {
        const y = 236 - 86 * (1 - ((x - 120) / 106) ** 2)
        return sword(x, y - 10, 70, -90)
      })
      .join('') +
    sparkle(196, 100, 5) +
    sparkle(48, 110, 4),
}
