// 權杖六：六根木枝排成 V 形，頂端掛著一圈月桂花環（勝利、被肯定）
// （不畫騎馬遊行的人）
module.exports = {
  draw: ({ P, leaf, flower, ground, cluster, sparkle, wand }) => {
    let wreath = ''
    for (let i = 0; i < 16; i += 1) {
      const a = (i / 16) * Math.PI * 2
      const deg = (a * 180) / Math.PI
      wreath += leaf(120 + 22 * Math.cos(a), 82 + 22 * Math.sin(a), 11, deg + 60, i % 2 ? P.sage : P.sageDeep)
    }
    return (
      ground(120, 290, 80) +
      [-58, -68, -80, -100, -112, -122].map((a) => wand(120, 290, 176, a, { w: 4.8 })).join('') +
      `<circle cx="120" cy="82" r="22" fill="none" stroke="${P.sageDeep}" stroke-width="1.4"/>` +
      wreath +
      flower(120, 104, 6) +
      `<path d="M114 106L108 124M126 106L132 124" stroke="${P.lav}" stroke-width="3" stroke-linecap="round"/>` +
      sparkle(70, 70, 5) +
      sparkle(170, 64, 5) +
      cluster(120, 296, 0.7)
    )
  },
}
