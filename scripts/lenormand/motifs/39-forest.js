// 39 森林：層層疊疊的松樹
function pine(P, x, base, h, fill) {
  const w = h * 0.42
  let d = ''
  for (let i = 0; i < 3; i += 1) {
    const top = base - h + i * h * 0.24
    const bottom = top + h * 0.42
    const half = w * (0.55 + i * 0.22)
    d += `M${x} ${top}L${x + half} ${bottom}H${x - half}Z`
  }
  return `<rect x="${x - 3}" y="${base - h * 0.12}" width="6" height="${h * 0.12}" fill="${P.bark}"/><path d="${d}" fill="${fill}"/>`
}

module.exports = {
  facing: null,
  draw: ({ P, ground, cluster }) =>
    `<ellipse cx="120" cy="290" rx="116" ry="14" fill="${P.sageLight}"/>` +
    pine(P, 66, 252, 150, P.sage) +
    pine(P, 168, 248, 164, P.sage) +
    pine(P, 118, 262, 196, P.sageDeep) +
    pine(P, 32, 278, 120, P.sageDeep) +
    pine(P, 210, 280, 126, P.sageDeep) +
    pine(P, 88, 290, 100, '#879a80') +
    pine(P, 150, 292, 92, '#879a80') +
    `<ellipse cx="120" cy="236" rx="120" ry="8" fill="${P.paper}" opacity=".55"/>` +
    `<path d="M112 296Q120 280 128 270" stroke="${P.goldLight}" stroke-width="6" stroke-linecap="round" opacity=".7"/>` +
    ground(120, 296, 60, P.sageLight) +
    cluster(46, 298, 0.7) +
    cluster(196, 298, 0.7),
}
