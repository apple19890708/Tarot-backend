// 寶劍二：兩柄劍交叉，交點是一個還沒開的花苞（猶豫、暫時不做決定）
// （不畫矇眼持雙劍的女子，也不畫背後的水與月）
module.exports = {
  draw: ({ P, leaf, bud, ground, grass, sparkle, sword, glow }) =>
    ground(120, 290, 88) +
    sword(62, 252, 176, -55) +
    sword(178, 252, 176, -125) +
    glow(120, 168, 20, P.lavLight, 0.9) +
    leaf(120, 172, 16, 200, P.sage) +
    leaf(120, 172, 16, -20, P.sage) +
    bud(120, 162, 11, -90) +
    sparkle(120, 120, 4) +
    grass(40, 290, 22) +
    grass(200, 290, 22),
}
