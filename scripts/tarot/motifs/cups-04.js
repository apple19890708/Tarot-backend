// 聖杯四：三只杯倒扣在地上，第四只被藤蔓半遮，一片落葉飄下（倦怠、看不見眼前的機會）
// （不畫樹下抱胸的人，也不畫雲中遞杯的手）
module.exports = {
  draw: ({ P, leaf, ground, grass, cup }) =>
    ground(120, 290, 104) +
    cup(48, 270, 0.95, { down: true }) +
    cup(92, 272, 0.95, { down: true }) +
    cup(136, 270, 0.95, { down: true }) +
    // 被藤蔓遮住的第四只
    cup(194, 222, 1.05, { water: true }) +
    `<path d="M168 290Q172 250 190 230Q206 214 214 190" fill="none" stroke="${P.sageDeep}" stroke-width="1.8"/>` +
    leaf(176, 256, 22, -30, P.sage) +
    leaf(184, 238, 24, 10, P.sageDeep) +
    leaf(196, 226, 22, -60, P.sage) +
    leaf(206, 212, 20, 20, P.sageDeep) +
    leaf(212, 196, 18, -80, P.sage) +
    leaf(180, 222, 18, 200, P.sage) +
    // 落葉
    `<path d="M96 120Q110 132 104 150" fill="none" stroke="${P.goldLight}" stroke-width="1" stroke-dasharray="2 4"/>` +
    leaf(104, 156, 18, 60, P.ochre, 0.36) +
    grass(30, 290, 20),
}
