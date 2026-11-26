// XVIII 月亮：霧中的滿月，蜿蜒小徑穿過兩叢夜裡開的白花，水面月影搖晃，一隻飛蛾（不確定、直覺、潛意識）
// （不畫狗與狼、龍蝦和兩座塔）
const LEFT_FLOWERS = [
  [34, 220],
  [56, 206],
  [70, 230],
  [44, 246],
]

module.exports = {
  draw: ({ P, flower, bud, glow, butterfly, sparkle }) => {
    const bush = (pts, mirror) =>
      pts.map(([x, y], i) => flower(mirror ? 240 - x : x, y, 7, { rot: i * 30 })).join('') +
      bud(mirror ? 186 : 54, 194, 6, mirror ? -60 : -120)
    return (
      glow(120, 86, 54, P.lavLight, 0.8) +
      `<circle cx="120" cy="86" r="32" fill="${P.goldLight}" stroke="${P.gold}" stroke-width="1.4"/>` +
      `<g fill="${P.gold}" opacity=".25"><circle cx="110" cy="78" r="6"/><circle cx="130" cy="94" r="4"/><circle cx="124" cy="72" r="3"/></g>` +
      // 霧
      `<g fill="${P.white}"><ellipse cx="96" cy="108" rx="42" ry="5" opacity=".8"/><ellipse cx="150" cy="120" rx="46" ry="5" opacity=".7"/><ellipse cx="104" cy="132" rx="36" ry="4" opacity=".5"/></g>` +
      // 遠山
      `<path d="M20 186Q70 160 120 176Q170 158 220 184Q222 196 214 200H26Q18 196 20 186Z" fill="${P.lavLight}"/>` +
      // 小徑
      `<path d="M100 300Q150 262 112 232Q84 208 118 186L126 186Q98 210 126 232Q170 264 142 300Z" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width=".8"/>` +
      // 兩叢白花
      `<ellipse cx="50" cy="232" rx="38" ry="30" fill="${P.sage}"/><ellipse cx="190" cy="232" rx="38" ry="30" fill="${P.sage}"/>` +
      `<ellipse cx="40" cy="220" rx="16" ry="10" fill="${P.sageLight}" opacity=".5"/><ellipse cx="180" cy="220" rx="16" ry="10" fill="${P.sageLight}" opacity=".5"/>` +
      bush(LEFT_FLOWERS, false) +
      bush(LEFT_FLOWERS, true) +
      // 水面月影
      `<ellipse cx="196" cy="284" rx="40" ry="9" fill="${P.sky}"/>` +
      `<path d="M184 282h10M198 282h8M188 287h14M192 278h8" stroke="${P.gold}" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>` +
      // 飛蛾
      butterfly(60, 150, 1, { rot: -12, color: P.lav }) +
      sparkle(190, 66, 4) +
      sparkle(40, 90, 3.5)
    )
  },
}
