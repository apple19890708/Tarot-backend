// 12 鳥：兩隻停在樹枝上、朝左鳴叫的小鳥（朝左）
function bird(P, x, y, s, color) {
  const t = (dx, dy) => `${x + dx * s} ${y + dy * s}`
  return (
    `<path d="M${t(16, -4)}L${t(36, -12)}L${t(32, 4)}Z" fill="${P.lavDeep}"/>` +
    `<ellipse cx="${x}" cy="${y}" rx="${20 * s}" ry="${13 * s}" fill="${color}"/>` +
    `<circle cx="${x - 16 * s}" cy="${y - 12 * s}" r="${10 * s}" fill="${color}"/>` +
    `<path d="M${t(-25, -13)}L${t(-35, -10)}L${t(-25, -8)}Z" fill="${P.gold}"/>` +
    `<circle cx="${x - 19 * s}" cy="${y - 14 * s}" r="${1.8 * s}" fill="${P.ink}"/>` +
    `<path d="M${t(-4, -6)}Q${t(14, -12)} ${t(22, 2)}Q${t(8, 4)} ${t(-4, -6)}Z" fill="${P.lavDeep}" opacity=".6"/>` +
    `<path d="M${t(-2, 12)}V${y + 20 * s}M${t(6, 12)}V${y + 20 * s}" stroke="${P.goldDeep}" stroke-width="${1.6 * s}"/>`
  )
}

module.exports = {
  facing: 'left',
  draw: ({ P, leaf, flower }) =>
    `<path d="M14 214Q110 190 228 222" fill="none" stroke="${P.bark}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M180 210Q196 190 214 186" fill="none" stroke="${P.bark}" stroke-width="3" stroke-linecap="round"/>` +
    leaf(40, 208, 26, 120, P.sage) +
    leaf(66, 204, 24, 70, P.sageDeep) +
    leaf(196, 214, 26, 60, P.sage) +
    leaf(212, 188, 20, -40, P.sageDeep) +
    leaf(150, 204, 22, 100, P.sage) +
    flower(214, 184, 8) +
    flower(30, 216, 7) +
    flower(172, 214, 6) +
    bird(P, 92, 182, 1.1, P.lav) +
    bird(P, 156, 190, 0.85, P.sage) +
    `<path d="M44 152q-6-4-4-10M36 160q-10-6-8-18" fill="none" stroke="${P.gold}" stroke-width="1.4" stroke-linecap="round"/>`,
}
