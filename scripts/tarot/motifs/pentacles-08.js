// 錢幣八：八枚錢幣排成往上的石階，一階放一枚（精進、累積、專注練功）
// （不畫在工作檯上刻錢幣的工匠）
module.exports = {
  draw: ({ P, ground, grass, sparkle, coin, C }) => {
    let steps = ''
    for (let i = 0; i < 8; i += 1) {
      const x = 18 + i * 25
      const top = 276 - i * 24
      steps += `<rect x="${x}" y="${top}" width="25" height="${290 - top}" fill="${C.stone}" stroke="${C.stoneEdge}" stroke-width="1"/>`
      steps += coin(x + 12.5, top - 12, 11)
    }
    return ground(120, 292, 108) + steps + grass(30, 290, 18) + sparkle(60, 120, 5) + sparkle(226, 60, 4)
  },
}
