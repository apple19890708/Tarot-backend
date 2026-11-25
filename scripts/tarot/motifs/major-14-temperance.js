// XIV 節制：山泉注入三層石盆，一層一層溢流調和後流進池子；兩旁鳶尾花（調和、中道）
// （不畫天使在兩杯之間倒水）
function basin(P, C, y, rx) {
  const depth = rx * 0.42
  return (
    `<path d="M${120 - rx} ${y}Q120 ${y + depth * 2} ${120 + rx} ${y}Z" fill="${C.stone}" stroke="${C.stoneEdge}" stroke-width="1.2"/>` +
    `<ellipse cx="120" cy="${y}" rx="${rx}" ry="${rx * 0.16}" fill="${P.water}" stroke="${C.stoneEdge}" stroke-width="1"/>` +
    `<ellipse cx="${120 - rx * 0.3}" cy="${y - 0.5}" rx="${rx * 0.25}" ry="${rx * 0.05}" fill="${P.paper}" opacity=".7"/>`
  )
}

module.exports = {
  draw: ({ P, iris, sparkle, C }) =>
    // 池子
    `<ellipse cx="120" cy="276" rx="96" ry="16" fill="${P.sky}"/>` +
    `<ellipse cx="120" cy="276" rx="96" ry="16" fill="none" stroke="${C.stoneEdge}" stroke-width="1"/>` +
    `<path d="M84 280q12-3 24 0t24 0M110 286q8-2 16 0t16 0" fill="none" stroke="${P.paper}" stroke-width="1.2"/>` +
    // 石柱
    `<rect x="114" y="120" width="12" height="154" fill="${C.stone}" stroke="${C.stoneEdge}" stroke-width="1"/>` +
    // 溢流
    `<path d="M95 121Q86 140 87 176M145 121Q154 140 153 176M77 181Q60 214 62 268M163 181Q180 214 178 268" fill="none" stroke="${P.water}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<path d="M98 122Q91 140 92 176M142 122Q149 140 148 176" fill="none" stroke="${P.sky}" stroke-width="1.4" stroke-linecap="round"/>` +
    basin(P, C, 182, 44) +
    basin(P, C, 120, 26) +
    // 泉眼
    `<path d="M120 112Q110 92 100 112M120 112Q130 92 140 112M120 112V96" fill="none" stroke="${P.water}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<g fill="${P.water}"><circle cx="104" cy="92" r="1.6"/><circle cx="136" cy="92" r="1.6"/><circle cx="120" cy="90" r="1.8"/></g>` +
    iris(28, 292, 90) +
    iris(212, 292, 74, 0.85) +
    sparkle(60, 90, 5) +
    sparkle(186, 76, 4),
}
