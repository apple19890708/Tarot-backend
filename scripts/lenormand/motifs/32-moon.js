// 32 月亮：新月與星星
module.exports = {
  facing: null,
  draw: ({ P, star, sparkle, cluster }) =>
    `<circle cx="120" cy="150" r="96" fill="${P.lavLight}" opacity=".6"/>` +
    `<path d="M140 93.4A60 60 0 1 0 140 206.6A48 48 0 0 1 140 93.4Z" fill="${P.goldLight}" stroke="${P.gold}" stroke-width="1.6"/>` +
    `<path d="M92 120Q80 150 92 180" fill="none" stroke="${P.paper}" stroke-width="3" stroke-linecap="round" opacity=".8"/>` +
    star(172, 110, 9, { fill: P.gold }) +
    star(188, 164, 6, { fill: P.gold }) +
    sparkle(160, 200, 6) +
    sparkle(54, 78, 5) +
    star(44, 216, 5, { fill: P.goldLight }) +
    cluster(120, 294, 0.95),
}
