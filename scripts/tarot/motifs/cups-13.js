// 聖杯皇后：有蓋的杯頂著花冠與新月，四周浮著睡蓮（包容、深刻的同理）
// （不畫海邊寶座上的皇后）
module.exports = {
  draw: ({ P, court, flower }) =>
    court('cups', 'queen', {
      over:
        // 杯蓋
        `<path d="M86 186Q86 158 120 156Q154 158 154 186Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1.2"/>` +
        `<path d="M92 178Q120 170 148 178" fill="none" stroke="${P.gold}" stroke-width="1.4"/>` +
        `<circle cx="120" cy="152" r="5" fill="${P.gold}"/>` +
        // 睡蓮
        `<ellipse cx="66" cy="268" rx="16" ry="4" fill="${P.sage}"/><ellipse cx="174" cy="272" rx="16" ry="4" fill="${P.sage}"/>` +
        flower(66, 264, 7, { petals: 8, fill: P.white }) +
        flower(174, 268, 7, { petals: 8, fill: P.lavLight, rot: 20 }),
    }),
}
