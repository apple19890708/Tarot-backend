// XV 惡魔：一個華麗的鳥籠，籠門其實是開著的，裡面一隻小鳥；籠外纏著帶刺的玫瑰藤（束縛、執著，而出口一直都在）
// （不畫羊頭惡魔與被鍊住的兩人）
module.exports = {
  draw: ({ P, f, leaf, flower, ground, bird }) => {
    // 籠子：中心 (120, 150)，半寬 50、穹頂高 70，底在 y=238
    const domeY = (x) => 150 - 70 * Math.sqrt(Math.max(0, 1 - ((x - 120) / 50) ** 2))
    let bars = ''
    for (let x = 76; x <= 164; x += 11) {
      if (x > 126 && x < 160) continue
      bars += `M${x} ${f(domeY(x))}V238`
    }
    const thorns = [
      [66, 247, -60],
      [96, 241, -100],
      [130, 250, -70],
      [164, 243, -110],
      [186, 246, -60],
    ]
    return (
      ground(120, 270, 92) +
      `<ellipse cx="120" cy="256" rx="70" ry="8" fill="${P.sageDeep}" opacity=".18"/>` +
      // 吊環
      `<circle cx="120" cy="66" r="6" fill="none" stroke="${P.gold}" stroke-width="2"/>` +
      `<path d="M120 72V80" stroke="${P.gold}" stroke-width="2"/>` +
      // 籠身
      `<path d="M70 150Q70 82 120 80Q170 82 170 150" fill="none" stroke="${P.gold}" stroke-width="2.4"/>` +
      `<path d="${bars}" stroke="${P.gold}" stroke-width="1.4"/>` +
      `<path d="M70 150V238M170 150V238M70 150H170M70 200H128" stroke="${P.gold}" stroke-width="1.8"/>` +
      `<rect x="62" y="236" width="116" height="12" rx="3" fill="${P.gold}"/>` +
      `<path d="M66 242H174" stroke="${P.goldLight}" stroke-width="1.2"/>` +
      `<path d="M104 92Q112 84 120 92Q128 84 136 92" fill="none" stroke="${P.goldDeep}" stroke-width="1.4"/>` +
      // 打開的籠門
      `<path d="M160 160L196 150V226L160 236" fill="${P.paper}" fill-opacity=".3" stroke="${P.gold}" stroke-width="1.8" stroke-linejoin="round"/>` +
      `<path d="M172 157V233M184 153V229M160 198L196 190" stroke="${P.gold}" stroke-width="1.2"/>` +
      `<circle cx="198" cy="190" r="2.4" fill="${P.goldDeep}"/>` +
      // 小鳥
      `<path d="M84 214H140" stroke="${P.bark}" stroke-width="2.4" stroke-linecap="round"/>` +
      bird(110, 198, 0.95) +
      // 玫瑰刺藤
      `<path d="M44 252Q84 230 116 250Q150 268 196 244" fill="none" stroke="#7c6b5c" stroke-width="2.2" stroke-linecap="round"/>` +
      `<g fill="#7c6b5c">${thorns.map(([x, y, a]) => `<path d="M${x - 2} ${y}L${x} ${y - 6}L${x + 2} ${y}Z" transform="rotate(${a + 90} ${x} ${y})"/>`).join('')}</g>` +
      leaf(80, 240, 14, -120, P.sageDeep) +
      leaf(148, 258, 14, 60, P.sageDeep) +
      leaf(186, 248, 12, -60, P.sage) +
      flower(56, 246, 9, { petals: 6, fill: P.roseLight, edge: P.rose, center: P.rose }) +
      flower(176, 252, 8, { petals: 6, fill: P.roseLight, edge: P.rose, center: P.rose, rot: 20 })
    )
  },
}
