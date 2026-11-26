// 寶劍八：八柄劍插成一圈柵欄，中間一朵花；柵欄前方其實留著一個缺口（自我設限、出口一直在）
// （不畫矇眼被綁、周圍插劍的女子）
module.exports = {
  draw: ({ P, leaf, flower, ground, sword, sparkle }) => {
    // 九個位置排成橢圓，前方正中留空
    const posts = []
    for (let i = 0; i < 9; i += 1) {
      const a = (Math.PI * 2 * i) / 9 + Math.PI / 2
      if (i === 0) continue
      posts.push([120 + 88 * Math.cos(a), 236 + 34 * Math.sin(a)])
    }
    posts.sort((p, q) => p[1] - q[1])
    const back = posts.filter(([, y]) => y < 236)
    const front = posts.filter(([, y]) => y >= 236)
    const drawPost = ([x, y]) => sword(x, y - 92, 96, 90)
    return (
      ground(120, 276, 108) +
      `<ellipse cx="120" cy="240" rx="94" ry="36" fill="${P.sageLight}"/>` +
      back.map(drawPost).join('') +
      // 中間的花
      `<path d="M120 248Q116 210 120 182" fill="none" stroke="${P.sageDeep}" stroke-width="2"/>` +
      leaf(119, 228, 18, 200, P.sage) +
      leaf(120, 212, 18, -20, P.sage) +
      flower(120, 176, 12, { petals: 6 }) +
      front.map(drawPost).join('') +
      // 缺口
      `<path d="M106 278Q120 286 134 278" fill="none" stroke="${P.goldLight}" stroke-width="2" stroke-linecap="round"/>` +
      sparkle(120, 290, 4)
    )
  },
}
