// 錢幣九：九枚錢幣環繞一座花園涼亭，涼亭頂上停著一隻蝴蝶（自在、豐足、靠自己得來的從容）
// （不畫葡萄園裡手上停著獵鷹的女子）
module.exports = {
  draw: ({ P, flower, ground, coin, butterfly, sprig }) => {
    let coins = ''
    for (let i = 0; i < 9; i += 1) {
      const a = Math.PI * 1.05 + (Math.PI * 0.9 * i) / 8
      coins += coin(120 + 100 * Math.cos(a), 190 + 112 * Math.sin(a), 11)
    }
    return (
      ground(120, 286, 98) +
      coins +
      // 涼亭
      `<ellipse cx="120" cy="272" rx="62" ry="10" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width="1"/>` +
      `<path d="M74 270V178M100 274V182M140 274V182M166 270V178" stroke="${P.paper}" stroke-width="6"/>` +
      `<path d="M74 270V178M100 274V182M140 274V182M166 270V178" stroke="${P.petalEdge}" stroke-width="1" opacity=".8"/>` +
      `<path d="M62 180Q120 168 178 180Q166 130 120 112Q74 130 62 180Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1.2"/>` +
      `<path d="M120 112V100" stroke="${P.goldDeep}" stroke-width="1.6"/><circle cx="120" cy="98" r="3" fill="${P.gold}"/>` +
      sprig(74, 270, 70, -88, { leaves: 4, tipSize: 6 }) +
      sprig(166, 270, 70, -92, { leaves: 4, tip: 'bud', tipSize: 6 }) +
      flower(120, 250, 7) +
      butterfly(132, 90, 0.8, { rot: 20 })
    )
  },
}
