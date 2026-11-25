// 16 星星：一顆大的八角星與滿天小星
const SMALL = [
  [44, 70, 8],
  [196, 64, 7],
  [58, 220, 6],
  [200, 210, 9],
  [36, 150, 5],
  [214, 136, 5],
  [96, 252, 4],
  [158, 256, 5],
  [124, 54, 4],
]

module.exports = {
  facing: null,
  draw: ({ P, star, sparkle, cluster }) =>
    `<circle cx="120" cy="156" r="104" fill="${P.lavLight}" opacity=".55"/>` +
    `<path d="M44 70L120 152L196 64M58 220L120 152L200 210" stroke="${P.goldLight}" stroke-width=".9" stroke-dasharray="2 4" fill="none"/>` +
    star(120, 152, 58, { points: 8, inner: 0.42, fill: P.gold, rot: -90 }) +
    star(120, 152, 34, { points: 8, inner: 0.5, fill: P.goldLight, rot: -67.5 }) +
    `<circle cx="120" cy="152" r="7" fill="${P.paper}"/>` +
    SMALL.map(([x, y, r], i) => (i % 3 ? star(x, y, r, { fill: P.gold }) : sparkle(x, y, r + 2))).join('') +
    cluster(120, 296, 0.95),
}
