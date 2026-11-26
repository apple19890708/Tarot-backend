// XX 審判：一朵喇叭狀的百合朝向天空，花口散出一圈圈光環；下方破土而出的幼苗與飛起的蝴蝶（覺醒、召喚、重新開始）
// （不畫吹號的天使，也不畫從棺木起身的人）
function sprout(P, leaf, x) {
  return (
    `<path d="M${x - 12} 292Q${x} 284 ${x + 12} 292Z" fill="${P.ochre}" opacity=".55"/>` +
    `<path d="M${x} 290Q${x - 1} 278 ${x + 2} 268" fill="none" stroke="${P.sageDeep}" stroke-width="1.6" stroke-linecap="round"/>` +
    leaf(x + 2, 270, 11, -150, P.sage, 0.45) +
    leaf(x + 2, 270, 11, -30, P.sage, 0.45)
  )
}

module.exports = {
  draw: ({ P, f, leaf, ground, butterfly, sparkle, glow }) => {
    // 花口位置：從 (120, 172) 往右上 30 度長 56
    const mx = 120 + 56 * Math.sin(Math.PI / 6)
    const my = 172 - 56 * Math.cos(Math.PI / 6)
    let rings = ''
    for (const r of [20, 32, 44]) {
      const a1 = (-115 * Math.PI) / 180
      const a2 = (-5 * Math.PI) / 180
      rings += `<path d="M${f(mx + r * Math.cos(a1))} ${f(my + r * Math.sin(a1))}A${r} ${r} 0 0 1 ${f(mx + r * Math.cos(a2))} ${f(my + r * Math.sin(a2))}" fill="none" stroke="${P.gold}" stroke-width="1.6" stroke-linecap="round" opacity="${f(1 - r / 60)}"/>`
    }
    return (
      glow(mx, my, 50, P.goldLight, 0.45) +
      rings +
      ground(120, 292, 100) +
      // 莖與葉
      `<path d="M104 292Q106 220 120 172" fill="none" stroke="${P.sageDeep}" stroke-width="2.4" stroke-linecap="round"/>` +
      leaf(106, 262, 34, -150, P.sage, 0.2) +
      leaf(108, 236, 30, -40, P.sageDeep, 0.2) +
      leaf(113, 206, 24, -150, P.sage, 0.2) +
      // 喇叭狀百合
      `<g transform="translate(120 172) rotate(30)">` +
      `<path d="M-5 0Q-6 -30 -22 -52Q-10 -48 0 -56Q10 -48 22 -52Q6 -30 5 0Z" fill="${P.white}" stroke="${P.petalEdge}" stroke-width=".8"/>` +
      `<path d="M-22 -52Q-30 -58 -28 -64Q-18 -58 -12 -54M22 -52Q30 -58 28 -64Q18 -58 12 -54M0 -56Q-2 -66 4 -70Q6 -62 4 -56" fill="${P.white}" stroke="${P.petalEdge}" stroke-width=".8"/>` +
      `<path d="M0 -8V-46M-4 -12Q-8 -30 -12 -44M4 -12Q8 -30 12 -44" fill="none" stroke="${P.goldLight}" stroke-width="1"/>` +
      `<g fill="${P.gold}"><circle cx="0" cy="-58" r="2"/><circle cx="-6" cy="-56" r="1.8"/><circle cx="6" cy="-56" r="1.8"/></g>` +
      `</g>` +
      sprout(P, leaf, 46) +
      sprout(P, leaf, 160) +
      sprout(P, leaf, 202) +
      butterfly(52, 150, 0.9, { rot: -15 }) +
      butterfly(198, 220, 0.7, { rot: 20, color: P.sageLight }) +
      sparkle(40, 90, 4) +
      sparkle(206, 160, 4)
    )
  },
}
