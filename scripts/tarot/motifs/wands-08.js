// 權杖八：八根木枝平行斜飛過雲間，帶著速度線（迅速、消息、事情一口氣推進）
// （不畫河谷與遠景城堡）
module.exports = {
  draw: ({ P, f, wand, cloud, sparkle }) => {
    let out = cloud(60, 250, 90, P.lavLight, 1) + cloud(186, 96, 80, P.lavLight, 1) + cloud(196, 262, 50, P.paper, 0.9)
    for (let i = 0; i < 8; i += 1) {
      const x = 22 + (i % 4) * 22 + Math.floor(i / 4) * 30
      const y = 196 + (i % 4) * 14 - Math.floor(i / 4) * 54 - (i % 4) * 22
      out += `<path d="M${f(x - 30)} ${f(y + 15)}L${f(x - 8)} ${f(y + 4)}" stroke="${P.goldLight}" stroke-width="1.6" stroke-linecap="round"/>`
      out += wand(x, y, 132, -27, { w: 4 })
    }
    return out + sparkle(200, 170, 5) + sparkle(40, 90, 4)
  },
}
