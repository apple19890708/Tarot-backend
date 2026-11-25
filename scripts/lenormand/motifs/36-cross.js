// 36 十字架：纏著白花藤蔓的十字架
module.exports = {
  facing: null,
  draw: ({ P, ground, sprig, flower, leaf }) => {
    let rays = ''
    for (let i = 0; i < 12; i += 1) {
      const a = (Math.PI * 2 * i) / 12
      rays += `M${120 + 40 * Math.cos(a)} ${134 + 40 * Math.sin(a)}L${120 + 96 * Math.cos(a)} ${134 + 96 * Math.sin(a)}`
    }
    return (
      `<path d="${rays}" stroke="${P.goldLight}" stroke-width="1.2" opacity=".7"/>` +
      ground(120, 292, 80) +
      `<path d="M110 72H130V122H168V144H130V290H110V144H72V122H110Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1.8" stroke-linejoin="round"/>` +
      `<path d="M116 80V282M80 133H160" stroke="${P.paper}" stroke-width="2" opacity=".8"/>` +
      `<path d="M106 290Q132 260 108 230Q90 204 128 180Q150 160 124 140Q104 124 128 104" fill="none" stroke="${P.sageDeep}" stroke-width="1.8"/>` +
      leaf(108, 230, 16, 200, P.sage) +
      leaf(128, 180, 16, -20, P.sage) +
      leaf(124, 140, 14, 160, P.sageDeep) +
      leaf(118, 262, 14, -30, P.sageDeep) +
      flower(128, 104, 8) +
      flower(108, 206, 7) +
      flower(138, 160, 6) +
      sprig(70, 292, 60, -60, { leaves: 2, tipSize: 7 }) +
      sprig(170, 292, 60, -120, { leaves: 2, tip: 'bud', tipSize: 7 })
    )
  },
}
