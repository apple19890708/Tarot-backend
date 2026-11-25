// 22 分岔路：一條路分成兩條，中間立著路標
module.exports = {
  facing: null,
  draw: ({ P, cluster, flower, grass }) =>
    `<ellipse cx="120" cy="214" rx="114" ry="86" fill="${P.sageLight}" opacity=".9"/>` +
    `<path d="M98 300L112 214L58 128L82 124L120 194L158 124L182 128L128 214L142 300Z" fill="${P.goldLight}"/>` +
    `<path d="M112 214L58 128M128 214L182 128" stroke="${P.gold}" stroke-width="1" opacity=".6"/>` +
    `<rect x="116" y="150" width="8" height="120" rx="2" fill="${P.bark}"/>` +
    `<path d="M118 162H76L66 172L76 182H118Z" fill="${P.paper}" stroke="${P.goldDeep}" stroke-width="1.4"/>` +
    `<path d="M122 188H164L174 198L164 208H122Z" fill="${P.paper}" stroke="${P.goldDeep}" stroke-width="1.4"/>` +
    `<path d="M82 172H110M130 198H158" stroke="${P.gold}" stroke-width="1.6" stroke-dasharray="4 3"/>` +
    flower(124, 146, 6) +
    grass(70, 280, 30) +
    grass(176, 284, 30) +
    cluster(46, 296, 0.85) +
    cluster(196, 296, 0.85),
}
