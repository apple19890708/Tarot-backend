// 49 蝴蝶：展翅的蝴蝶（正面左右對稱，沒有朝向）
function wingPair(P) {
  return (
    `<path d="M120 150Q80 80 46 100Q30 130 62 160Q86 172 120 160Z" fill="${P.lav}" stroke="${P.lavDeep}" stroke-width="1.4"/>` +
    `<path d="M120 164Q78 170 66 204Q72 228 98 214Q114 198 120 172Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1.4"/>` +
    `<circle cx="74" cy="124" r="9" fill="${P.paper}" opacity=".9"/><circle cx="74" cy="124" r="4" fill="${P.gold}"/>` +
    `<circle cx="88" cy="196" r="5" fill="${P.paper}"/>` +
    `<path d="M120 152Q90 120 60 118M120 158Q90 148 66 150" fill="none" stroke="${P.lavDeep}" stroke-width=".8" opacity=".6"/>`
  )
}

module.exports = {
  facing: null,
  draw: ({ P, cluster, sparkle }) =>
    wingPair(P) +
    `<g transform="translate(240 0) scale(-1 1)">${wingPair(P)}</g>` +
    `<ellipse cx="120" cy="164" rx="5" ry="34" fill="${P.ink}"/>` +
    `<circle cx="120" cy="128" r="6" fill="${P.ink}"/>` +
    `<path d="M118 124Q106 96 96 92M122 124Q134 96 144 92" fill="none" stroke="${P.ink}" stroke-width="1.4"/>` +
    `<circle cx="96" cy="92" r="2.4" fill="${P.ink}"/><circle cx="144" cy="92" r="2.4" fill="${P.ink}"/>` +
    sparkle(40, 220, 5) +
    sparkle(200, 72, 6) +
    cluster(120, 292, 1),
}
