// 42 香水：帶噴頭的香水瓶與飄出的香氣
module.exports = {
  facing: null,
  draw: ({ P, cluster, flower }) =>
    `<path d="M88 176Q76 248 120 272Q164 248 152 176Q140 156 120 156Q100 156 88 176Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1.6"/>` +
    `<path d="M84 212Q80 252 120 268Q160 252 156 212Q120 226 84 212Z" fill="${P.lav}" opacity=".8"/>` +
    `<path d="M98 178Q92 210 100 236" fill="none" stroke="${P.paper}" stroke-width="3" stroke-linecap="round" opacity=".9"/>` +
    `<rect x="110" y="134" width="20" height="24" rx="3" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1.4"/>` +
    `<path d="M106 118H134L140 134H100Z" fill="${P.gold}"/><path d="M114 118L112 134M126 118L128 134" stroke="${P.goldDeep}" stroke-width=".9"/>` +
    `<path d="M134 124Q166 120 170 150" fill="none" stroke="${P.goldDeep}" stroke-width="2"/>` +
    `<ellipse cx="174" cy="164" rx="12" ry="15" fill="${P.rose}"/>` +
    `<path d="M168 152Q174 146 180 152" fill="none" stroke="${P.roseLight}" stroke-width="1.4"/>` +
    `<path d="M98 116Q84 100 96 86Q108 72 94 58M82 112Q66 96 76 80" fill="none" stroke="${P.gold}" stroke-width="1.4" stroke-dasharray="1 4" stroke-linecap="round"/>` +
    flower(70, 70, 5) +
    flower(110, 66, 4) +
    cluster(120, 294, 0.9),
}
