// 聖杯國王：聖杯放在盾形底座上，上方王冠，底下起伏的海浪（情緒的穩定、溫和的權威）
// （不畫漂在海上寶座的國王）
module.exports = {
  draw: ({ P, court, waves }) =>
    court('cups', 'king', {
      under: `<ellipse cx="120" cy="250" rx="104" ry="30" fill="${P.sky}" opacity=".8"/>` + waves(30, 244, 180, { rows: 3, gap: 10 }),
    }),
}
