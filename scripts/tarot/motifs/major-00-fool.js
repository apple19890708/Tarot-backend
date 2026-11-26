// 0 愚人：一顆蒲公英絨球，右上角的種子已經乘風飛走；下方一條敞開的小徑通往遠方淡紫山影
// （不畫懸崖邊的旅人與小狗）
function flyingSeed(P, f, x, y, rot) {
  return (
    `<g transform="translate(${f(x)} ${f(y)}) rotate(${rot})">` +
    `<circle cx="0" cy="-4" r="4" fill="${P.white}" opacity=".85"/>` +
    `<path d="M0 0L-4.5 -5M0 0L-2.4 -6.6M0 0V-7M0 0L2.4 -6.6M0 0L4.5 -5" stroke="${P.petalEdge}" stroke-width=".7" stroke-linecap="round"/>` +
    `<path d="M0 0V10" stroke="${P.goldDeep}" stroke-width="1"/><ellipse cx="0" cy="11" rx="1.2" ry="2.2" fill="${P.bark}"/>` +
    `</g>`
  )
}

module.exports = {
  draw: ({ P, f, leaf, ground, grass, cluster, sparkle }) => {
    const cx = 92
    const cy = 150
    let filaments = ''
    let tufts = ''
    for (let deg = -180; deg < 180; deg += 12) {
      if (deg > -80 && deg < 0) continue
      const a = (deg * Math.PI) / 180
      const x = cx + 34 * Math.cos(a)
      const y = cy + 34 * Math.sin(a)
      filaments += `M${f(cx + 5 * Math.cos(a))} ${f(cy + 5 * Math.sin(a))}L${f(x)} ${f(y)}`
      tufts += `<circle cx="${f(x)}" cy="${f(y)}" r="3"/>`
    }
    const seeds = [
      [138, 112, 40],
      [158, 92, 30],
      [180, 106, 55],
      [196, 72, 25],
      [214, 92, 45],
      [150, 66, 20],
      [186, 46, 15],
    ]
    return (
      // 遠方山影
      `<path d="M92 246Q132 204 170 216Q200 194 226 214Q236 226 232 246Z" fill="${P.lavLight}"/>` +
      `<path d="M146 248Q184 226 222 234Q230 242 226 250H146Z" fill="${P.lav}" opacity=".45"/>` +
      ground(120, 292, 104) +
      // 敞開的小徑
      `<path d="M146 300Q170 276 184 250Q190 238 196 232" fill="none" stroke="${P.paper}" stroke-width="9" stroke-linecap="round"/>` +
      `<path d="M146 300Q170 276 184 250Q190 238 196 232" fill="none" stroke="${P.petalEdge}" stroke-width="1" stroke-dasharray="3 5"/>` +
      // 風
      `<path d="M118 126Q160 104 214 116M128 146Q172 128 226 138" fill="none" stroke="${P.gold}" stroke-width="1" stroke-linecap="round" opacity=".55"/>` +
      // 莖與鋸齒葉
      `<path d="M96 290Q102 228 ${cx} ${cy + 5}" fill="none" stroke="${P.sageDeep}" stroke-width="2.2" stroke-linecap="round"/>` +
      leaf(96, 290, 44, 200, P.sage, 0.2) +
      leaf(96, 290, 46, -18, P.sageDeep, 0.18) +
      leaf(96, 290, 34, -140, P.sage, 0.2) +
      leaf(96, 290, 30, -50, P.sage, 0.22) +
      // 絨球
      `<circle cx="${cx}" cy="${cy}" r="37" fill="${P.white}" opacity=".45"/>` +
      `<path d="${filaments}" stroke="${P.petalEdge}" stroke-width=".7"/>` +
      `<g fill="${P.white}" stroke="${P.petalEdge}" stroke-width=".5">${tufts}</g>` +
      `<circle cx="${cx}" cy="${cy}" r="6" fill="${P.goldLight}"/><circle cx="${cx}" cy="${cy}" r="3.2" fill="${P.gold}"/>` +
      seeds.map(([x, y, rot]) => flyingSeed(P, f, x, y, rot)).join('') +
      sparkle(212, 150, 5) +
      grass(40, 290, 26) +
      cluster(206, 296, 0.7)
    )
  },
}
