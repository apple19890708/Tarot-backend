// II 女祭司：夜裡的靜水池映著新月；池邊一朵半閉的白蓮，一卷書半沉在水下
// （不畫黑白雙柱、帷幕與坐著的女祭司）
module.exports = {
  draw: ({ P, star, sparkle, grass, cluster, crescent, C }) =>
    `<circle cx="120" cy="150" r="104" fill="${C.night}" opacity=".55"/>` +
    crescent(120, 82, 22) +
    star(58, 70, 4, { fill: P.gold }) +
    star(184, 98, 5, { fill: P.gold }) +
    sparkle(172, 56, 4) +
    sparkle(70, 120, 3.5) +
    // 水池
    `<ellipse cx="120" cy="238" rx="102" ry="34" fill="${P.water}" opacity=".45"/>` +
    `<ellipse cx="120" cy="238" rx="86" ry="26" fill="${P.sky}"/>` +
    // 月影
    `<g transform="translate(0 236) scale(1 .42)" opacity=".75">${crescent(120, 0, 20)}</g>` +
    `<path d="M98 250q11-3 22 0t22 0M108 258q8-2 16 0t16 0" fill="none" stroke="${P.paper}" stroke-width="1.3" stroke-linecap="round"/>` +
    // 半閉的白蓮
    `<ellipse cx="70" cy="234" rx="22" ry="5" fill="${P.sage}"/>` +
    `<path d="M50 236Q70 226 90 236" fill="none" stroke="${P.sageDeep}" stroke-width="1"/>` +
    `<g fill="${P.white}" stroke="${P.petalEdge}" stroke-width=".7">` +
    `<path d="M70 232Q56 222 58 206Q68 214 70 232Z"/>` +
    `<path d="M70 232Q84 222 82 206Q72 214 70 232Z"/>` +
    `<path d="M70 232Q61 214 70 196Q79 214 70 232Z"/>` +
    `</g>` +
    `<path d="M70 200V212" stroke="${P.goldLight}" stroke-width="1.4" stroke-linecap="round"/>` +
    // 半沉的書卷
    `<g transform="translate(166 236) rotate(-16)">` +
    `<rect x="-24" y="-7" width="46" height="14" rx="3" fill="${P.paper}" stroke="${P.goldDeep}" stroke-width=".9"/>` +
    `<ellipse cx="-24" cy="0" rx="4" ry="7" fill="${P.goldLight}" stroke="${P.goldDeep}" stroke-width=".9"/>` +
    `<path d="M-14 -2H14M-14 2H8" stroke="${P.petalEdge}" stroke-width="1"/>` +
    `</g>` +
    `<ellipse cx="170" cy="246" rx="32" ry="7" fill="${P.water}" opacity=".55"/>` +
    grass(28, 240, 22, P.sageDeep) +
    grass(214, 238, 20, P.sageDeep) +
    cluster(40, 294, 0.75) +
    cluster(200, 296, 0.7),
}
