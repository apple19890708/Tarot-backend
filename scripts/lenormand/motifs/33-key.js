// 33 鑰匙：繫著緞帶的金鑰匙
module.exports = {
  facing: null,
  draw: ({ P, cluster, sparkle, flower }) =>
    `<circle cx="120" cy="102" r="28" fill="none" stroke="${P.goldDeep}" stroke-width="9"/>` +
    `<circle cx="120" cy="102" r="28" fill="none" stroke="${P.gold}" stroke-width="5.5"/>` +
    `<path d="M120 84Q132 102 120 120Q108 102 120 84ZM102 102Q120 90 138 102Q120 114 102 102Z" fill="${P.goldLight}"/>` +
    `<rect x="114" y="128" width="12" height="134" rx="3" fill="${P.gold}"/>` +
    `<rect x="110" y="132" width="20" height="8" rx="3" fill="${P.goldDeep}"/>` +
    `<path d="M126 222H154V236H142V246H154V262H126Z" fill="${P.gold}"/>` +
    `<path d="M118 134L92 156L100 160L90 178M122 134L146 150L140 156L152 170" fill="none" stroke="${P.rose}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
    flower(120, 132, 7) +
    sparkle(166, 82, 7) +
    sparkle(70, 210, 5) +
    cluster(120, 296, 0.85),
}
