// I 魔術師：一顆裂開的種子長出四條細枝，分別頂著四種花色的小物件；上方一圈淡金光環
// （不畫舉手站在桌前的人，也不畫擺著四物件的桌子）
module.exports = {
  draw: ({ P, leaf, ground, grass, sparkle, wand, cup, sword, coin, glow }) => {
    const stems = [
      [62, 156, 74, 214],
      [100, 130, 96, 196],
      [140, 130, 144, 196],
      [178, 156, 166, 214],
    ]
    return (
      // 光環
      glow(120, 66, 30, P.goldLight, 0.4) +
      `<circle cx="120" cy="66" r="20" fill="none" stroke="${P.gold}" stroke-width="1.8"/>` +
      `<circle cx="120" cy="66" r="14" fill="none" stroke="${P.goldLight}" stroke-width="1"/>` +
      sparkle(120, 66, 6) +
      `<path d="M62 150Q80 96 106 74M178 150Q160 96 134 74" fill="none" stroke="${P.goldLight}" stroke-width="1" stroke-dasharray="2 5"/>` +
      ground(120, 284, 70) +
      // 四條細枝
      stems.map(([x, y, qx, qy]) => `<path d="M120 254Q${qx} ${qy} ${x} ${y}" fill="none" stroke="${P.sageDeep}" stroke-width="1.8" stroke-linecap="round"/>`).join('') +
      leaf(96, 214, 16, 200, P.sage) +
      leaf(144, 214, 16, -20, P.sage) +
      leaf(80, 200, 14, -110, P.sageDeep) +
      leaf(160, 200, 14, -70, P.sageDeep) +
      // 四花色
      wand(62, 158, 46, -98) +
      cup(100, 102, 0.7) +
      sword(140, 116, 44, -90) +
      coin(178, 140, 14) +
      // 裂開的種子與根
      `<path d="M112 268Q104 282 96 288M128 268Q136 282 146 286M120 270V290" fill="none" stroke="${P.bark}" stroke-width="1.2" stroke-linecap="round"/>` +
      `<ellipse cx="120" cy="260" rx="17" ry="12" fill="${P.ochre}"/>` +
      `<path d="M112 250L118 258L114 264L120 272" fill="none" stroke="${P.paper}" stroke-width="2" stroke-linejoin="round"/>` +
      `<ellipse cx="126" cy="255" rx="5" ry="3" fill="${P.goldLight}" opacity=".7"/>` +
      grass(70, 284, 22) +
      grass(172, 284, 22) +
      sparkle(36, 110, 5) +
      sparkle(206, 104, 4)
    )
  },
}
