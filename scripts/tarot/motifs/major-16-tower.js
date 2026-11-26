// XVI 塔：雷雨中，一座疊石塔被閃電劈開、上方的石塊崩落；裂縫裡長出一株小草（突然的瓦解，打開新的空間）
// （不畫王冠飛落的高塔與墜落的人）
const STONES = [
  [120, 274, 46, 14, 0],
  [118, 250, 38, 12, -3],
  [123, 229, 31, 11, 4],
  [118, 210, 25, 10, -4],
]
const FALLING = [
  [86, 182, 15, 8, -32],
  [158, 172, 14, 8, 38],
  [100, 146, 10, 6, -55],
  [176, 210, 8, 5, 70],
  [64, 222, 7, 4.5, -20],
]

module.exports = {
  draw: ({ P, sprig, ground, cloud, sparkle, C }) => {
    const stone = ([x, y, rx, ry, r]) =>
      `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" transform="rotate(${r} ${x} ${y})" fill="${C.stone}" stroke="${C.stoneEdge}" stroke-width="1.2"/>`
    return (
      cloud(70, 62, 96, '#d6cfe0', 0.95) +
      cloud(170, 54, 104, '#d6cfe0', 0.95) +
      cloud(128, 74, 70, P.lavLight, 1) +
      `<path d="M30 92L22 112M52 98L44 118M196 92L188 112M218 96L210 116M176 104L170 120" stroke="${P.water}" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>` +
      ground(120, 288, 88) +
      STONES.map(stone).join('') +
      FALLING.map(stone).join('') +
      // 裂縫
      `<path d="M120 202L126 222L116 238L124 256L118 284" fill="none" stroke="${C.stoneEdge}" stroke-width="1.6" stroke-linejoin="round"/>` +
      // 閃電
      `<path d="M150 78L128 124H141L116 196L158 128H144L164 78Z" fill="${P.goldLight}" stroke="${P.gold}" stroke-width="1.4" stroke-linejoin="round"/>` +
      sparkle(116, 200, 9) +
      sparkle(98, 196, 4) +
      sparkle(138, 196, 4) +
      // 裂縫裡的小草
      sprig(122, 262, 26, -62, { leaves: 2, tipSize: 5 })
    )
  },
}
