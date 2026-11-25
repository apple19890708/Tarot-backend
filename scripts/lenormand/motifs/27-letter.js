// 27 信件：封著蠟印的信封，插著一枝小花
module.exports = {
  facing: null,
  draw: ({ P, sprig, star, cluster }) =>
    `<g transform="rotate(-8 120 196)">` +
    sprig(62, 180, 110, -60, { leaves: 4, tipSize: 9 }) +
    `<rect x="48" y="146" width="144" height="100" rx="4" fill="${P.paper}" stroke="${P.gold}" stroke-width="1.6"/>` +
    `<path d="M48 246L104 196M192 246L136 196" stroke="${P.goldLight}" stroke-width="1.2"/>` +
    `<path d="M48 146L120 204L192 146" fill="${P.cream}" stroke="${P.gold}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<circle cx="120" cy="204" r="15" fill="${P.rose}"/>` +
    `<circle cx="120" cy="204" r="10.5" fill="none" stroke="${P.roseLight}" stroke-width="1"/>` +
    star(120, 204, 6, { fill: P.roseLight }) +
    `<path d="M64 228H96M64 236H88" stroke="${P.petalEdge}" stroke-width="1.4"/>` +
    `</g>` +
    cluster(120, 294, 0.9),
}
