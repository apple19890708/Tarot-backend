// 50 橋：跨過溪水的石拱橋
module.exports = {
  facing: null,
  draw: ({ P, waves, cluster, grass }) => {
    let posts = ''
    for (let i = 0; i < 7; i += 1) {
      const x = 40 + i * 26.7
      const t = (x - 20) / 200
      const y = 196 - Math.sin(t * Math.PI) * 34
      posts += `M${x} ${y}V${y - 16}`
    }
    return (
      `<path d="M4 248Q120 236 236 248Q232 292 120 298Q8 292 4 248Z" fill="${P.sky}" opacity=".75"/>` +
      waves(16, 262, 210, { rows: 3, gap: 10 }) +
      `<path d="M0 226Q40 218 60 246L0 252Z" fill="${P.sage}"/><path d="M240 226Q200 218 180 246L240 252Z" fill="${P.sage}"/>` +
      `<path d="M20 214Q120 140 220 214V232H190A70 52 0 0 0 50 232H20Z" fill="${P.lavLight}" stroke="${P.lav}" stroke-width="1.6"/>` +
      `<path d="M50 232A70 52 0 0 1 190 232" fill="none" stroke="${P.lavDeep}" stroke-width="1.4" opacity=".6"/>` +
      `<path d="M20 196Q120 128 220 196" fill="none" stroke="${P.goldDeep}" stroke-width="2.4"/>` +
      `<path d="${posts}" stroke="${P.goldDeep}" stroke-width="2"/>` +
      `<path d="M20 180Q120 112 220 180" fill="none" stroke="${P.goldDeep}" stroke-width="2"/>` +
      grass(24, 230, 26) +
      grass(214, 230, 26) +
      cluster(30, 236, 0.75) +
      cluster(210, 236, 0.75)
    )
  },
}
