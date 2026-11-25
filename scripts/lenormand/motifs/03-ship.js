// 3 船：帆船往右航行（朝右）
module.exports = {
  facing: 'right',
  draw: ({ P, waves, sparkle }) =>
    `<path d="M120 222V86" stroke="${P.bark}" stroke-width="3.5" stroke-linecap="round"/>` +
    `<path d="M120 86L146 93L120 100Z" fill="${P.rose}"/>` +
    `<path d="M125 100Q182 148 125 208Z" fill="${P.paper}" stroke="${P.gold}" stroke-width="1.6"/>` +
    `<path d="M115 112Q76 156 115 206Z" fill="${P.lavLight}" stroke="${P.gold}" stroke-width="1.6"/>` +
    `<path d="M128 112Q150 150 128 196" fill="none" stroke="${P.goldLight}" stroke-width="1"/>` +
    `<path d="M40 214L56 250H184L210 214Z" fill="${P.bark}"/>` +
    `<path d="M48 226H200" stroke="${P.goldLight}" stroke-width="2"/>` +
    `<circle cx="84" cy="236" r="3.5" fill="${P.goldLight}"/><circle cx="120" cy="236" r="3.5" fill="${P.goldLight}"/><circle cx="156" cy="236" r="3.5" fill="${P.goldLight}"/>` +
    `<path d="M20 252Q120 240 222 252V272H20Z" fill="${P.sky}" opacity=".8"/>` +
    waves(22, 262, 200, { rows: 4, gap: 10 }) +
    `<path d="M180 70q6-6 12 0q6-6 12 0M54 92q5-5 10 0q5-5 10 0" fill="none" stroke="${P.ink}" stroke-width="1.3" stroke-linecap="round"/>` +
    sparkle(206, 140, 5),
}
