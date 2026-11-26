// 錢幣七：七枚錢幣像種子埋在土壟裡，各冒出一株芽，旁邊一個沙漏（耐心、等待收成、評估投入）
// （不畫拄著鋤頭看果樹的人）
module.exports = {
  draw: ({ P, leaf, coin, sparkle }) => {
    const seeds = [
      [36, 270],
      [72, 276],
      [108, 270],
      [144, 276],
      [54, 236],
      [92, 230],
      [130, 236],
    ]
    return (
      `<path d="M10 222Q90 206 168 222Q176 260 168 296Q90 306 12 296Q2 260 10 222Z" fill="#e2cfae"/>` +
      `<path d="M14 250Q90 238 166 250M14 284Q90 272 166 284" fill="none" stroke="${P.ochre}" stroke-width="2" opacity=".6"/>` +
      seeds
        .map(
          ([x, y]) =>
            coin(x, y, 10) +
            `<path d="M${x} ${y - 10}Q${x - 1} ${y - 22} ${x + 1} ${y - 30}" fill="none" stroke="${P.sageDeep}" stroke-width="1.4"/>` +
            leaf(x + 1, y - 28, 11, -150, P.sage, 0.45) +
            leaf(x + 1, y - 28, 11, -30, P.sage, 0.45),
        )
        .join('') +
      // 沙漏
      `<rect x="180" y="190" width="44" height="6" rx="2" fill="${P.bark}"/><rect x="180" y="276" width="44" height="6" rx="2" fill="${P.bark}"/>` +
      `<path d="M186 196V276M218 196V276" stroke="${P.bark}" stroke-width="2"/>` +
      `<path d="M190 196Q190 226 202 236Q214 226 214 196ZM190 276Q190 246 202 236Q214 246 214 276Z" fill="${P.paper}" fill-opacity=".7" stroke="${P.gold}" stroke-width="1.2"/>` +
      `<path d="M195 214Q202 226 209 214ZM192 276Q196 258 202 254Q208 258 212 276Z" fill="${P.gold}"/>` +
      `<path d="M202 236V254" stroke="${P.gold}" stroke-width="1" stroke-dasharray="1.5 2"/>` +
      sparkle(80, 120, 5) +
      sparkle(170, 100, 4)
    )
  },
}
