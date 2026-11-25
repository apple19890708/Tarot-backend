// 25 戒指：鑲著寶石的金戒指，纏著藤蔓
module.exports = {
  facing: null,
  draw: ({ P, sprig, sparkle, cluster }) =>
    `<ellipse cx="120" cy="190" rx="54" ry="50" fill="none" stroke="${P.goldDeep}" stroke-width="11"/>` +
    `<ellipse cx="120" cy="190" rx="54" ry="50" fill="none" stroke="${P.gold}" stroke-width="7"/>` +
    `<path d="M80 168Q96 146 124 144" fill="none" stroke="${P.goldLight}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M106 140L114 128H126L134 140Z" fill="${P.goldDeep}"/>` +
    `<path d="M100 112H140L148 124L120 146L92 124Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1.2"/>` +
    `<path d="M92 124H148M110 112L106 124L120 146L134 124L130 112" fill="none" stroke="${P.lavDeep}" stroke-width=".8"/>` +
    `<path d="M102 116L108 112L106 122Z" fill="${P.paper}"/>` +
    sparkle(160, 100, 7) +
    sparkle(74, 108, 5) +
    sprig(48, 270, 120, -40, { leaves: 5, tipSize: 8 }) +
    sprig(196, 266, 90, -128, { leaves: 3, tip: 'bud', tipSize: 8 }) +
    cluster(120, 292, 0.9),
}
