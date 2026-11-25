// 11 鞭子：握柄與捲曲的鞭繩
module.exports = {
  facing: null,
  draw: ({ P, ground, cluster }) =>
    ground(120, 290, 90) +
    `<path d="M70 282L124 176" stroke="${P.bark}" stroke-width="9" stroke-linecap="round"/>` +
    `<path d="M80 262L88 266M92 240L100 244M118 186L126 190" stroke="${P.gold}" stroke-width="4"/>` +
    `<circle cx="68" cy="286" r="7" fill="${P.goldDeep}"/>` +
    `<path d="M124 176C166 134 206 164 186 198C164 232 116 204 138 150C152 116 196 108 206 78" fill="none" stroke="${P.ink}" stroke-width="2.8" stroke-linecap="round"/>` +
    `<path d="M206 78l6-8M206 78l9-3" stroke="${P.ink}" stroke-width="1.6" stroke-linecap="round"/>` +
    `<path d="M40 120l10 6M36 140l12 2M194 230l12 4M190 250l10 8" stroke="${P.rose}" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>` +
    cluster(160, 290, 0.9) +
    cluster(44, 292, 0.7),
}
