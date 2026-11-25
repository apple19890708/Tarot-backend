// III 皇后：一頂白花花冠放在麥穗與石榴之上，周圍盛開的白玫瑰
// （不畫坐在軟墊上的女性與金星盾牌）
function wheat(P, f, angle, len) {
  const a = (angle * Math.PI) / 180
  const x2 = 120 + len * Math.cos(a)
  const y2 = 276 + len * Math.sin(a)
  let ear = ''
  for (let i = 0; i < 5; i += 1) {
    const t = 1 - i * 0.07
    const x = 120 + len * t * Math.cos(a)
    const y = 276 + len * t * Math.sin(a)
    ear += `<ellipse cx="${f(x - 3)}" cy="${f(y)}" rx="2.4" ry="5" transform="rotate(${f(angle + 60)} ${f(x - 3)} ${f(y)})"/>`
    ear += `<ellipse cx="${f(x + 3)}" cy="${f(y)}" rx="2.4" ry="5" transform="rotate(${f(angle + 120)} ${f(x + 3)} ${f(y)})"/>`
  }
  return `<path d="M120 276L${f(x2)} ${f(y2)}" stroke="${P.ochre}" stroke-width="1.4"/><g fill="${P.gold}">${ear}</g>`
}

function pomegranate(P, x, y, r) {
  return (
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${P.rose}"/>` +
    `<path d="M${x - 4} ${y - r + 1}L${x - 5} ${y - r - 6}L${x - 1} ${y - r - 2}L${x} ${y - r - 7}L${x + 2} ${y - r - 2}L${x + 6} ${y - r - 6}L${x + 4} ${y - r + 1}Z" fill="${P.rose}"/>` +
    `<circle cx="${x - r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.28}" fill="${P.roseLight}" opacity=".8"/>`
  )
}

module.exports = {
  draw: ({ P, f, leaf, flower, ground, star, sparkle }) => {
    let crown = ''
    for (let i = 0; i < 10; i += 1) {
      const a = (Math.PI * 2 * i) / 10
      const x = 120 + 42 * Math.cos(a)
      const y = 138 + 13 * Math.sin(a)
      crown += leaf(x, y, 11, (a * 180) / Math.PI + 90, i % 2 ? P.sage : P.sageDeep)
    }
    for (let i = 0; i < 9; i += 1) {
      const a = (Math.PI * 2 * i) / 9 + 0.3
      crown += flower(120 + 42 * Math.cos(a), 138 + 13 * Math.sin(a), 7.5, { rot: i * 17 })
    }
    const roses = [
      [48, 178, 12],
      [192, 174, 12],
      [34, 228, 9],
      [206, 226, 9],
      [70, 140, 8],
      [170, 140, 8],
    ]
    return (
      ground(120, 290, 96) +
      roses.map(([x, y, r], i) => leaf(x, y, r * 2, 150 + i * 40, P.sage) + leaf(x, y, r * 1.8, 20 + i * 40, P.sageDeep)).join('') +
      [-64, -76, -88, -100, -112, -124].map((a, i) => wheat(P, f, a, 104 + (i % 2) * 12)).join('') +
      `<path d="M106 256Q120 262 134 256L132 266Q120 270 108 266Z" fill="${P.lav}"/>` +
      pomegranate(P, 78, 250, 15) +
      pomegranate(P, 164, 254, 13) +
      leaf(92, 262, 18, 200, P.sage) +
      leaf(150, 266, 18, -20, P.sage) +
      // 花冠
      `<ellipse cx="120" cy="138" rx="42" ry="13" fill="none" stroke="${P.sageDeep}" stroke-width="1.4"/>` +
      crown +
      roses.map(([x, y, r], i) => flower(x, y, r, { petals: 6, rot: i * 13 })).join('') +
      star(120, 96, 6, { fill: P.gold }) +
      sparkle(92, 104, 4) +
      sparkle(150, 104, 4)
    )
  },
}
