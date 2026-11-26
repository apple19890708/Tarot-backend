// XVII 星星：一顆大星倒映在湖面，星光像水滴落下化成漣漪；岸邊鳶尾（希望、療癒）
// （不畫跪在水邊倒水的女子，也不排八顆星）
module.exports = {
  draw: ({ P, star, sparkle, grass, iris, glow, C }) =>
    `<circle cx="120" cy="150" r="104" fill="${C.night}" opacity=".55"/>` +
    glow(120, 92, 46, P.goldLight, 0.55) +
    star(120, 92, 32, { points: 8, inner: 0.4, fill: P.gold }) +
    star(120, 92, 18, { points: 8, inner: 0.45, fill: P.goldLight, rot: -67.5 }) +
    `<circle cx="120" cy="92" r="4" fill="${P.paper}"/>` +
    sparkle(54, 72, 5) +
    sparkle(186, 64, 4) +
    sparkle(196, 126, 5) +
    sparkle(44, 140, 3.5) +
    // 落下的光滴
    `<g fill="${P.sky}" stroke="${P.water}" stroke-width=".8">` +
    [146, 170, 194, 214].map((y, i) => `<path d="M120 ${y - 6 + i}Q124 ${y + 1} 120 ${y + 3 + i}Q116 ${y + 1} 120 ${y - 6 + i}Z"/>`).join('') +
    `</g>` +
    // 湖
    `<ellipse cx="120" cy="248" rx="102" ry="30" fill="${P.water}" opacity=".45"/>` +
    `<ellipse cx="120" cy="248" rx="88" ry="23" fill="${P.sky}"/>` +
    `<g transform="translate(0 252) scale(1 .38)" opacity=".7">${star(120, 0, 22, { points: 8, inner: 0.4, fill: P.goldLight })}</g>` +
    `<ellipse cx="120" cy="238" rx="14" ry="3.6" fill="none" stroke="${P.paper}" stroke-width="1.2"/>` +
    `<ellipse cx="120" cy="240" rx="28" ry="7" fill="none" stroke="${P.paper}" stroke-width="1" opacity=".7"/>` +
    iris(32, 292, 86) +
    grass(204, 276, 24, P.sageDeep),
}
