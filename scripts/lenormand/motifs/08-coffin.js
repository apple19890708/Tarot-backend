// 8 棺材：一具棺木，上面放著白色百合
module.exports = {
  facing: null,
  draw: ({ P, ground, sprig, grass }) =>
    ground(120, 290, 96) +
    `<path d="M94 78H146L166 132L150 286H90L74 132Z" fill="${P.lavDeep}"/>` +
    `<path d="M99 90H141L156 134L143 274H97L84 134Z" fill="none" stroke="${P.lav}" stroke-width="1.6"/>` +
    `<path d="M84 134H156" stroke="${P.lav}" stroke-width="1.2" opacity=".7"/>` +
    `<circle cx="120" cy="110" r="3" fill="${P.goldLight}"/>` +
    sprig(60, 268, 150, -62, { leaves: 5, tip: 'flower', tipSize: 11 }) +
    sprig(176, 270, 140, -116, { leaves: 4, tip: 'flower', tipSize: 10 }) +
    sprig(100, 286, 110, -80, { leaves: 3, tip: 'bud', tipSize: 9 }) +
    grass(46, 290, 26) +
    grass(196, 290, 26),
}
