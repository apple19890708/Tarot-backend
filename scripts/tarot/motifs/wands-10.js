// 權杖十：十根木枝捆成一大束，繩子勒緊，下方的草被壓彎（負擔、責任太多）
// （不畫抱著十根杖走路的人）
module.exports = {
  draw: ({ P, ground, wand }) => {
    let bundle = ''
    for (let i = 0; i < 10; i += 1) {
      const x = 96 + i * 5.4
      bundle += wand(x, 280, 186, -90 + (i - 4.5) * 2.2, { w: 4.6 })
    }
    return (
      ground(120, 288, 98) +
      // 被壓彎的草
      `<path d="M60 288q6-6 20-8M74 288q4-8 18-10M160 288q-6-6-20-8M174 288q-4-8-18-10M50 288q-2-6 10-12M190 288q2-6-10-12" fill="none" stroke="${P.sage}" stroke-width="1.4" stroke-linecap="round"/>` +
      bundle +
      // 繩子
      `<path d="M88 216Q120 226 152 216M90 226Q120 236 150 226" fill="none" stroke="${P.ochre}" stroke-width="3.2" stroke-linecap="round"/>` +
      `<path d="M90 224Q120 232 150 224" fill="none" stroke="${P.goldLight}" stroke-width="1" opacity=".8"/>` +
      `<path d="M150 222Q166 230 160 246M152 226Q170 240 168 254" fill="none" stroke="${P.ochre}" stroke-width="2" stroke-linecap="round"/>` +
      `<ellipse cx="120" cy="284" rx="40" ry="5" fill="${P.sageDeep}" opacity=".25"/>`
    )
  },
}
