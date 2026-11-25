// 寶劍七：五柄劍被藤蔓捆著、悄悄拖走，兩柄留在原地，地上一串小腳印（偷偷行事、策略、逃避）
// （不畫抱著劍踮腳溜走的人）
const STEPS = [
  [56, 270],
  [74, 262],
  [92, 272],
  [110, 264],
  [128, 274],
  [146, 266],
]

module.exports = {
  draw: ({ P, leaf, ground, grass, sword }) =>
    ground(120, 284, 106) +
    // 留在原地的兩柄
    sword(36, 162, 116, 90) +
    sword(62, 176, 102, 88) +
    // 被拖走的五柄
    `<g transform="rotate(-24 178 220)">${[160, 170, 180, 190, 200].map((x) => sword(x, 172, 110, 90)).join('')}</g>` +
    `<path d="M150 214Q180 230 210 206M156 238Q186 250 214 226" fill="none" stroke="${P.sageDeep}" stroke-width="2.4"/>` +
    `<path d="M152 214Q126 232 96 236Q60 238 40 250" fill="none" stroke="${P.sageDeep}" stroke-width="1.6" stroke-dasharray="1 0"/>` +
    leaf(170, 222, 14, -60, P.sage) +
    leaf(196, 214, 14, -120, P.sage) +
    leaf(120, 230, 12, 200, P.sage) +
    // 小腳印
    `<g fill="${P.bark}" opacity=".45">${STEPS.map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="3.4" ry="2" transform="rotate(-20 ${x} ${y})"/>`).join('')}</g>` +
    grass(210, 284, 20),
}
