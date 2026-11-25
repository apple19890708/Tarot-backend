// 19 塔：高聳的石塔
module.exports = {
  facing: null,
  draw: ({ P, ground, sprig, cluster }) => {
    let stones = ''
    for (let y = 120; y < 280; y += 18) stones += `M98 ${y}H142`
    return (
      ground(120, 290, 92) +
      `<rect x="96" y="96" width="48" height="194" fill="${P.lavLight}" stroke="${P.lav}" stroke-width="1.6"/>` +
      `<path d="${stones}" stroke="${P.lav}" stroke-width=".8" opacity=".7"/>` +
      `<path d="M88 84H152V104H88Z" fill="${P.lav}"/>` +
      `<path d="M84 86L120 34L156 86Z" fill="${P.lavDeep}"/>` +
      `<path d="M120 34V18" stroke="${P.ink}" stroke-width="1.6"/><path d="M120 18L136 23L120 28Z" fill="${P.rose}"/>` +
      `<g fill="${P.sky}" stroke="${P.gold}" stroke-width="1.2"><path d="M114 134V124a6 6 0 0 1 12 0V134Z"/><path d="M114 186V176a6 6 0 0 1 12 0V186Z"/><path d="M114 236V226a6 6 0 0 1 12 0V236Z"/></g>` +
      `<path d="M110 290V266a10 10 0 0 1 20 0V290Z" fill="${P.sageDeep}"/>` +
      sprig(146, 290, 120, -96, { leaves: 6, tip: 'flower', tipSize: 7 }) +
      cluster(64, 292, 0.85) +
      cluster(186, 292, 0.75)
    )
  },
}
