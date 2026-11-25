// 51 翼：向兩側展開的一對羽翼（左右對稱，沒有朝向）
function wing(P) {
  let out = ''
  // 三層羽毛，由內到外
  const rows = [
    { n: 8, len: 104, r: 9, fill: P.paper },
    { n: 7, len: 76, r: 8, fill: P.lavLight },
    { n: 5, len: 50, r: 7, fill: P.goldLight },
  ]
  for (const row of rows) {
    for (let i = 0; i < row.n; i += 1) {
      // 左翼：從水平偏下（165 度）展到左上（250 度）
      const a = 165 + (i * 85) / (row.n - 1)
      const rad = (a * Math.PI) / 180
      const x = 114 + row.len * 0.5 * Math.cos(rad)
      const y = 170 + row.len * 0.5 * Math.sin(rad)
      out += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(row.len * 0.48).toFixed(1)}" ry="${row.r}" transform="rotate(${a.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})" fill="${row.fill}" stroke="${P.petalEdge}" stroke-width=".8"/>`
    }
  }
  return out
}

module.exports = {
  facing: null,
  draw: ({ P, sparkle, cluster }) =>
    `<circle cx="120" cy="150" r="20" fill="${P.goldLight}" opacity=".6"/>` +
    wing(P) +
    `<g transform="translate(240 0) scale(-1 1)">${wing(P)}</g>` +
    `<circle cx="120" cy="170" r="8" fill="${P.gold}"/>` +
    sparkle(120, 112, 8) +
    sparkle(40, 236, 5) +
    sparkle(204, 236, 5) +
    cluster(120, 294, 0.9),
}
