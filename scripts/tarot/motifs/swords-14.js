// 寶劍國王：寶劍立在盾形底座上，上方王冠，背後兩隻飛鳥（理性的權威、清楚的判斷）
// （不畫正面持劍的國王）
module.exports = {
  draw: ({ court, flyingBird }) =>
    court('swords', 'king', {
      under: flyingBird(66, 150, 1.4) + flyingBird(178, 132, 1.2),
    }),
}
