// VIII 力量：一隻獅子閉著眼安靜趴著，鬃毛上戴著白花花環（溫柔的力量）
// （不畫撫著獅子嘴的女性）
module.exports = {
  draw: ({ P, f, leaf, flower, ground, grass, cluster, C }) => {
    const hx = 82
    const hy = 210
    let mane = ''
    for (let i = 0; i < 16; i += 1) {
      const a = (360 / 16) * i
      const r = (a * Math.PI) / 180
      mane += `<ellipse cx="${f(hx + 27 * Math.cos(r))}" cy="${f(hy + 27 * Math.sin(r))}" rx="10" ry="16" transform="rotate(${f(a + 90)} ${f(hx + 27 * Math.cos(r))} ${f(hy + 27 * Math.sin(r))})"/>`
    }
    let garland = ''
    for (let i = 0; i < 6; i += 1) {
      const a = ((-165 + i * 30) * Math.PI) / 180
      const x = hx + 34 * Math.cos(a)
      const y = hy + 34 * Math.sin(a)
      garland += leaf(x, y, 10, (a * 180) / Math.PI + 120, P.sage) + flower(x, y, 6.5, { rot: i * 25 })
    }
    return (
      ground(126, 284, 104) +
      // 尾巴
      `<path d="M194 246Q226 250 220 274Q216 288 204 284" fill="none" stroke="${C.lion}" stroke-width="5" stroke-linecap="round"/>` +
      `<ellipse cx="203" cy="283" rx="7" ry="5" fill="${C.mane}"/>` +
      // 身體與後腿
      `<ellipse cx="140" cy="244" rx="58" ry="26" fill="${C.lion}"/>` +
      `<circle cx="178" cy="238" r="27" fill="${C.lion}"/>` +
      `<path d="M168 226Q190 230 194 250" fill="none" stroke="${C.mane}" stroke-width="1.4" opacity=".6"/>` +
      `<ellipse cx="172" cy="267" rx="20" ry="7" fill="${C.lion}"/>` +
      // 前腿
      `<path d="M108 246L62 262M116 258L72 274" stroke="${C.lion}" stroke-width="14" stroke-linecap="round"/>` +
      `<path d="M56 258v8M62 258v8M66 270v8M72 270v8" stroke="${C.mane}" stroke-width="1" opacity=".7"/>` +
      // 鬃毛、耳朵、臉
      `<g fill="${C.mane}">${mane}</g>` +
      `<circle cx="66" cy="190" r="7" fill="${C.lion}"/><circle cx="98" cy="190" r="7" fill="${C.lion}"/>` +
      `<circle cx="66" cy="190" r="3.4" fill="${P.roseLight}"/><circle cx="98" cy="190" r="3.4" fill="${P.roseLight}"/>` +
      `<circle cx="${hx}" cy="${hy}" r="22" fill="${C.lion}"/>` +
      `<path d="M71 206q4 3 8 0M85 206q4 3 8 0" fill="none" stroke="${P.ink}" stroke-width="1.3" stroke-linecap="round"/>` +
      `<ellipse cx="78" cy="222" rx="6" ry="4.6" fill="${P.paper}"/><ellipse cx="86" cy="222" rx="6" ry="4.6" fill="${P.paper}"/>` +
      `<path d="M78 214H86L82 219Z" fill="${P.bark}"/>` +
      `<path d="M82 219V223" stroke="${P.bark}" stroke-width="1"/>` +
      garland +
      grass(30, 286, 22) +
      cluster(210, 294, 0.7)
    )
  },
}
