// 34 魚：兩條繞著游的魚
function fish(P, x, y, s, dir, color, fin) {
  const t = (dx, dy) => `${x + dx * s * dir} ${y + dy * s}`
  return (
    `<path d="M${t(-26, 0)}L${t(-46, -14)}Q${t(-40, 0)} ${t(-46, 14)}Z" fill="${fin}"/>` +
    `<path d="M${t(-30, 0)}Q${t(-2, -24)} ${t(32, 0)}Q${t(-2, 24)} ${t(-30, 0)}Z" fill="${color}"/>` +
    `<path d="M${t(-2, -17)}Q${t(4, -28)} ${t(14, -14)}Z" fill="${fin}"/>` +
    `<path d="M${t(10, -12)}Q${t(4, 0)} ${t(10, 12)}" fill="none" stroke="${P.paper}" stroke-width="${1.2 * s}" opacity=".7"/>` +
    `<circle cx="${x + 20 * s * dir}" cy="${y - 3 * s}" r="${2.2 * s}" fill="${P.ink}"/>`
  )
}

module.exports = {
  facing: null,
  draw: ({ P, waves, cluster }) =>
    `<circle cx="120" cy="160" r="94" fill="${P.sky}" opacity=".55"/>` +
    `<circle cx="120" cy="160" r="70" fill="none" stroke="${P.water}" stroke-width="1" stroke-dasharray="3 6" opacity=".7"/>` +
    fish(P, 106, 116, 1.4, 1, P.gold, P.goldDeep) +
    fish(P, 134, 206, 1.4, -1, P.sage, P.sageDeep) +
    `<g fill="none" stroke="${P.water}" stroke-width="1.2"><circle cx="178" cy="100" r="5"/><circle cx="190" cy="84" r="3.5"/><circle cx="62" cy="214" r="4"/><circle cx="52" cy="200" r="2.5"/></g>` +
    waves(50, 262, 140, { rows: 2 }) +
    cluster(120, 296, 0.85),
}
