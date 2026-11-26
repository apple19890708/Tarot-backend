// 錢幣二：兩枚錢幣放在蹺蹺板的兩端，輕輕擺動（平衡、周轉、同時顧好兩件事）
// （不畫雜耍的人、無限符號與海上的船）
module.exports = {
  draw: ({ P, ground, cluster, sparkle, coin, C }) =>
    ground(120, 284, 104) +
    `<path d="M104 280L120 246L136 280Z" fill="${C.stone}" stroke="${C.stoneEdge}" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<g transform="rotate(-8 120 246)">` +
    `<rect x="26" y="240" width="188" height="9" rx="3" fill="${P.ochre}" stroke="${P.bark}" stroke-width="1"/>` +
    coin(48, 214, 25) +
    coin(192, 214, 25) +
    `</g>` +
    `<circle cx="120" cy="246" r="4" fill="${P.goldDeep}"/>` +
    `<path d="M32 170q4-10 12-12M196 136q6 6 6 14" fill="none" stroke="${P.gold}" stroke-width="1.2" stroke-linecap="round"/>` +
    sparkle(120, 150, 5) +
    cluster(60, 290, 0.7) +
    cluster(180, 290, 0.7),
}
