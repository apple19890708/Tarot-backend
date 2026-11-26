// 錢幣皇后：錢幣頂著花冠與新月，四周結果的枝條與一隻小兔（照顧、務實的豐盛）
// （不畫花園寶座上的皇后與兔子；兔子只是一個小元素，構圖不同）
module.exports = {
  draw: ({ P, court, leaf }) =>
    court('pentacles', 'queen', {
      under:
        `<path d="M22 230Q14 170 62 126M218 230Q226 170 178 126" fill="none" stroke="${P.bark}" stroke-width="2.2" stroke-linecap="round"/>` +
        [[22, 206, 1], [28, 176, -1], [42, 150, 1], [58, 132, -1]]
          .map(([x, y, s]) => leaf(x, y, 16, s > 0 ? 200 : -40, P.sage) + leaf(240 - x, y, 16, s > 0 ? -20 : -140, P.sage))
          .join('') +
        leaf(34, 190, 14, -30, P.sageDeep) +
        leaf(206, 190, 14, -150, P.sageDeep) +
        `<g fill="${P.rose}"><circle cx="30" cy="196" r="5"/><circle cx="38" cy="164" r="4.4"/><circle cx="210" cy="196" r="5"/><circle cx="202" cy="164" r="4.4"/></g>`,
      over:
        // 小兔
        `<ellipse cx="186" cy="272" rx="15" ry="11" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width="1"/>` +
        `<circle cx="174" cy="262" r="8" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width="1"/>` +
        `<ellipse cx="170" cy="246" rx="3" ry="9" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width="1" transform="rotate(-12 170 246)"/>` +
        `<ellipse cx="177" cy="246" rx="3" ry="9" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width="1" transform="rotate(10 177 246)"/>` +
        `<circle cx="171" cy="261" r="1.2" fill="${P.ink}"/><circle cx="200" cy="270" r="3.4" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width=".8"/>`,
    }),
}
