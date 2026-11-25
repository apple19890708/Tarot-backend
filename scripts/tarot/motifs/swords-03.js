// 寶劍三：三柄劍斜插在地上，一朵白玫瑰的花瓣被切落，細雨落下（心傷、失望）
// （不畫三劍刺穿紅心與雨雲）
const PETALS = [
  [170, 214, 30],
  [186, 236, 70],
  [160, 276, 100],
]

module.exports = {
  draw: ({ P, C, leaf, flower, ground, sword, cloud }) =>
    cloud(120, 62, 120, P.lavLight, 1) +
    `<path d="M70 86L62 104M96 90L88 108M122 90L114 108M148 88L140 106M174 84L166 102M84 118L78 132M136 120L130 134" stroke="${P.water}" stroke-width="1.2" stroke-linecap="round"/>` +
    ground(120, 288, 100) +
    sword(66, 156, 130, 76) +
    sword(112, 140, 146, 92) +
    sword(156, 160, 124, 104) +
    // 被切落花瓣的白玫瑰
    `<path d="M190 288Q186 240 176 204" fill="none" stroke="${P.sageDeep}" stroke-width="1.8"/>` +
    leaf(186, 254, 16, -10, P.sage) +
    leaf(182, 232, 14, 200, P.sageDeep) +
    flower(176, 198, 12, { petals: 6, rot: 20 }) +
    `<path d="M162 186L192 210" stroke="${C.steelEdge}" stroke-width=".8" opacity=".5"/>` +
    PETALS.map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="4" ry="7" transform="rotate(${r} ${x} ${y})" fill="${P.white}" stroke="${P.petalEdge}" stroke-width=".6"/>`).join(''),
}
