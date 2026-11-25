// 21 山：積雪的山峰與山前的霧
module.exports = {
  facing: null,
  draw: ({ P, cluster, grass }) =>
    `<path d="M14 290L100 112L128 150L152 124L230 290Z" fill="${P.lav}"/>` +
    `<path d="M100 112L84 146L98 140L108 154L116 136L128 150Z" fill="${P.paper}"/>` +
    `<path d="M152 124L140 148L152 142L162 152L168 144Z" fill="${P.paper}"/>` +
    `<path d="M100 112L128 290H14Z" fill="${P.lavDeep}" opacity=".25"/>` +
    `<path d="M-4 290L60 198L98 236L132 206L200 290Z" fill="${P.sage}"/>` +
    `<path d="M60 198L72 290H-4Z" fill="${P.sageDeep}" opacity=".3"/>` +
    `<ellipse cx="120" cy="214" rx="110" ry="9" fill="${P.paper}" opacity=".7"/>` +
    `<ellipse cx="80" cy="250" rx="70" ry="6" fill="${P.paper}" opacity=".5"/>` +
    `<path d="M170 78q8-8 16 0q8-8 16 0M40 92q6-6 12 0" fill="none" stroke="${P.ink}" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>` +
    grass(180, 292, 30) +
    cluster(200, 294, 0.8),
}
