// 37 蓮花：浮在水面的蓮花與蓮葉
function petal(P, x, y, len, width, angle, fill) {
  return `<path d="M0 0Q${width} ${-len * 0.5} 0 ${-len}Q${-width} ${-len * 0.5} 0 0Z" transform="translate(${x} ${y}) rotate(${angle})" fill="${fill}" stroke="${P.petalEdge}" stroke-width=".8"/>`
}

module.exports = {
  facing: null,
  draw: ({ P, waves }) => {
    const cx = 120
    const cy = 216
    const k = 1.45
    return (
      `<ellipse cx="120" cy="236" rx="112" ry="40" fill="${P.sky}" opacity=".75"/>` +
      waves(28, 258, 190, { rows: 3, gap: 8 }) +
      `<path d="M40 236A30 12 0 1 1 70 248L52 236Z" fill="${P.sage}"/>` +
      `<path d="M176 250A28 11 0 1 1 204 260L188 250Z" fill="${P.sageDeep}"/>` +
      petal(P, cx, cy, 50 * k, 20 * k, -64, P.roseLight) +
      petal(P, cx, cy, 50 * k, 20 * k, 64, P.roseLight) +
      petal(P, cx, cy, 62 * k, 22 * k, -36, P.paper) +
      petal(P, cx, cy, 62 * k, 22 * k, 36, P.paper) +
      petal(P, cx, cy, 70 * k, 22 * k, -12, P.paper) +
      petal(P, cx, cy, 70 * k, 22 * k, 12, P.paper) +
      petal(P, cx, cy, 58 * k, 18 * k, 0, P.roseLight) +
      `<ellipse cx="${cx}" cy="${cy - 8}" rx="16" ry="6" fill="${P.gold}"/>` +
      `<path d="M60 120q10-12 20 0M150 96q8-10 16 0" fill="none" stroke="${P.goldLight}" stroke-width="1.4" stroke-linecap="round"/>`
    )
  },
}
