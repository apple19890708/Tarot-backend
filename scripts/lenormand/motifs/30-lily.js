// 30 百合：三枝白色百合
function lily(P, x, y, s, rot) {
  const petal = (a) =>
    `<path d="M0 0Q-11 -18 -6 -36Q-4 -44 2 -46Q0 -40 1 -34Q6 -18 0 0Z" transform="rotate(${a})" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width=".8"/>`
  return (
    `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})">` +
    petal(-40) +
    petal(40) +
    petal(-16) +
    petal(16) +
    petal(0) +
    `<path d="M-5 0Q0 4 5 0V6H-5Z" fill="${P.sage}"/>` +
    `<path d="M0 0L-6 -30M0 0L0 -34M0 0L6 -30" stroke="${P.goldDeep}" stroke-width=".9"/>` +
    `<circle cx="-6" cy="-30" r="1.8" fill="${P.ochre}"/><circle cx="0" cy="-34" r="1.8" fill="${P.ochre}"/><circle cx="6" cy="-30" r="1.8" fill="${P.ochre}"/>` +
    `</g>`
  )
}

module.exports = {
  facing: null,
  draw: ({ P, leaf, ground, bud }) =>
    ground(120, 290, 80) +
    `<path d="M120 290Q118 200 120 110M120 290Q100 210 70 148M120 290Q146 214 172 140" fill="none" stroke="${P.sageDeep}" stroke-width="2.2"/>` +
    leaf(120, 286, 70, -120, P.sage, 0.16) +
    leaf(120, 286, 66, -60, P.sageDeep, 0.16) +
    leaf(118, 240, 48, -140, P.sageDeep, 0.18) +
    leaf(122, 230, 48, -40, P.sage, 0.18) +
    leaf(96, 210, 36, -150, P.sage, 0.2) +
    lily(P, 120, 110, 1.25, 0) +
    lily(P, 70, 148, 1.05, -28) +
    lily(P, 172, 140, 1.05, 28) +
    bud(146, 96, 10, -70),
}
