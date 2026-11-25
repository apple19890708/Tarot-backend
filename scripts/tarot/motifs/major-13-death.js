// XIII 死神：一朵凋謝的花垂下頭、花瓣飄落；同一片土裡冒出新芽，一隻蝴蝶飛起（結束與新生）
// （不畫騎白馬的骷髏、旗幟、雙塔間的日出）
const FALLING = [
  [160, 194, 30],
  [140, 218, -20],
  [168, 240, 60],
  [146, 266, 80],
]

module.exports = {
  draw: ({ P, leaf, ground, grass, butterfly, glow }) =>
    ground(120, 290, 96) +
    // 凋謝的花
    `<path d="M80 292Q78 200 106 158Q126 130 150 152" fill="none" stroke="${P.sageDeep}" stroke-width="2" stroke-linecap="round"/>` +
    leaf(80, 254, 26, 170, P.sage) +
    leaf(84, 216, 22, 120, P.sage) +
    leaf(96, 178, 20, 200, P.sageDeep) +
    `<g fill="#efe6d6" stroke="${P.petalEdge}" stroke-width=".7">` +
    `<ellipse cx="140" cy="170" rx="6.5" ry="15" transform="rotate(32 140 170)"/>` +
    `<ellipse cx="162" cy="170" rx="6.5" ry="15" transform="rotate(-32 162 170)"/>` +
    `<ellipse cx="145" cy="174" rx="6.5" ry="15" transform="rotate(12 145 174)"/>` +
    `<ellipse cx="157" cy="174" rx="6.5" ry="15" transform="rotate(-12 157 174)"/>` +
    `</g>` +
    `<ellipse cx="151" cy="157" rx="9" ry="6" fill="${P.ochre}"/><path d="M144 154Q151 150 158 154" fill="none" stroke="${P.goldDeep}" stroke-width="1"/>` +
    `<g fill="#efe6d6" stroke="${P.petalEdge}" stroke-width=".6">${FALLING.map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="3.4" ry="6.6" transform="rotate(${r} ${x} ${y})"/>`).join('')}</g>` +
    // 新芽
    `<path d="M186 292Q184 278 188 264" fill="none" stroke="${P.sageDeep}" stroke-width="1.8" stroke-linecap="round"/>` +
    leaf(188, 266, 14, -150, P.sage, 0.45) +
    leaf(188, 266, 14, -30, P.sage, 0.45) +
    `<ellipse cx="186" cy="292" rx="14" ry="3" fill="${P.ochre}" opacity=".5"/>` +
    // 蝴蝶
    `<path d="M188 258Q214 214 192 170Q180 140 196 116" fill="none" stroke="${P.goldLight}" stroke-width="1.2" stroke-dasharray="2 5"/>` +
    glow(196, 102, 26, P.lavLight, 0.7) +
    butterfly(196, 102, 1.1, { rot: 15 }) +
    grass(40, 290, 24),
}
