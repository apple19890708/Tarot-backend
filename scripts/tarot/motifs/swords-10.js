// 寶劍十：十柄劍倒插成扇形，扇心冒出一株新芽，天邊露出曙光（最低點已到、轉機在後面）
// （不畫趴在地上被十劍刺穿的人）
module.exports = {
  draw: ({ P, leaf, ground, sword, rays, glow }) => {
    let fan = ''
    for (let i = 0; i < 10; i += 1) {
      const deg = -168 + (156 / 9) * i
      const r = (deg * Math.PI) / 180
      const gx = 120 + 118 * Math.cos(r)
      const gy = 282 + 118 * Math.sin(r)
      fan += sword(gx, gy, 96, deg + 180)
    }
    return (
      glow(120, 282, 80, P.goldLight, 0.6) +
      rays(120, 282, 60, 96, 15, { color: P.gold, width: 1.4, opacity: 0.5, offset: -180 }) +
      `<path d="M60 282A60 60 0 0 1 180 282Z" fill="${P.goldLight}"/>` +
      `<path d="M84 282A36 36 0 0 1 156 282Z" fill="${P.gold}" opacity=".6"/>` +
      ground(120, 286, 106) +
      fan +
      // 新芽
      `<path d="M120 286Q118 270 122 256" fill="none" stroke="${P.sageDeep}" stroke-width="2" stroke-linecap="round"/>` +
      leaf(122, 258, 16, -150, P.sage, 0.45) +
      leaf(122, 258, 16, -30, P.sage, 0.45)
    )
  },
}
