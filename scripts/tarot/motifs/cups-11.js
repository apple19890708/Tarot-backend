// 聖杯侍者：一只杯，杯緣停著一隻小鳥，杯裡躍出一條小魚，背景水波（直覺的訊息、感性的開始）
// （不畫站在海邊、拿著有魚的杯子的少年）
module.exports = {
  draw: ({ P, court }) =>
    court('cups', 'page', {
      over:
        `<g transform="translate(100 182) rotate(-35)">` +
        `<ellipse cx="0" cy="0" rx="11" ry="5.4" fill="${P.ochre}"/>` +
        `<path d="M9 0L18 -6L16 0L18 6Z" fill="${P.ochre}"/>` +
        `<circle cx="-6" cy="-1" r="1.2" fill="${P.ink}"/>` +
        `<path d="M-2 -4Q2 0 -2 4" fill="none" stroke="${P.paper}" stroke-width="1"/>` +
        `</g>` +
        `<g fill="${P.water}"><circle cx="90" cy="198" r="1.8"/><circle cx="112" cy="168" r="1.6"/></g>`,
    }),
}
