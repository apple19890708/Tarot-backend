// 錢幣國王：錢幣放在盾形底座上，上方王冠，周圍葡萄藤與遠方城牆的輪廓（穩健的經營、守成與富足）
// （不畫穿葡萄袍、坐在寶座上的國王）
module.exports = {
  draw: ({ P, court, leaf }) =>
    court('pentacles', 'king', {
      under:
        `<path d="M14 214V196H26V204H38V196H50V204H62V196H74V214ZM166 214V196H178V204H190V196H202V204H214V196H226V214Z" fill="${P.lavLight}"/>` +
        `<path d="M30 250Q40 190 80 150M210 250Q200 190 160 150" fill="none" stroke="${P.sageDeep}" stroke-width="1.8"/>` +
        leaf(44, 206, 16, -150, P.sage) +
        leaf(196, 206, 16, -30, P.sage) +
        leaf(64, 170, 14, -40, P.sageDeep) +
        leaf(176, 170, 14, -140, P.sageDeep) +
        `<g fill="${P.lav}">${[
          [52, 222],
          [58, 228],
          [46, 228],
          [52, 234],
          [188, 222],
          [194, 228],
          [182, 228],
          [188, 234],
        ]
          .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6"/>`)
          .join('')}</g>`,
    }),
}
