// 錢幣四：四枚錢幣疊在一個上鎖的小箱上（守住、保守、抓得太緊）
// （不畫抱著錢幣坐著的人）
module.exports = {
  draw: ({ P, ground, grass, coin }) =>
    ground(120, 288, 100) +
    // 小箱
    `<rect x="62" y="206" width="116" height="78" rx="6" fill="${P.ochre}" stroke="${P.bark}" stroke-width="1.4"/>` +
    `<path d="M62 230H178" stroke="${P.bark}" stroke-width="1.4"/>` +
    `<path d="M84 206V284M156 206V284" stroke="${P.gold}" stroke-width="5"/>` +
    // 鎖
    `<path d="M112 236V228A8 8 0 0 1 128 228V236" fill="none" stroke="${P.goldDeep}" stroke-width="3"/>` +
    `<rect x="108" y="234" width="24" height="20" rx="3" fill="${P.gold}" stroke="${P.goldDeep}" stroke-width="1"/>` +
    `<circle cx="120" cy="242" r="2.4" fill="${P.goldDeep}"/><path d="M120 244V249" stroke="${P.goldDeep}" stroke-width="1.6"/>` +
    // 疊起來的四枚
    coin(120, 184, 20) +
    coin(120, 146, 20) +
    coin(120, 108, 20) +
    coin(120, 70, 20) +
    grass(40, 288, 20) +
    grass(200, 288, 20),
}
