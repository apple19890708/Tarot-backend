// 48 音樂：豎琴與飄出的音符
function note(P, x, y, s = 1, double = false) {
  const head = (hx, hy) => `<ellipse cx="${hx}" cy="${hy}" rx="${6 * s}" ry="${4.5 * s}" transform="rotate(-20 ${hx} ${hy})" fill="${P.lavDeep}"/>`
  if (double) {
    return (
      head(x, y) +
      head(x + 20 * s, y - 6 * s) +
      `<path d="M${x + 5 * s} ${y}V${y - 30 * s}L${x + 25 * s} ${y - 36 * s}V${y - 6 * s}" fill="none" stroke="${P.lavDeep}" stroke-width="${2 * s}"/>`
    )
  }
  return head(x, y) + `<path d="M${x + 5 * s} ${y}V${y - 30 * s}Q${x + 16 * s} ${y - 24 * s} ${x + 14 * s} ${y - 14 * s}" fill="none" stroke="${P.lavDeep}" stroke-width="${2 * s}"/>`
}

module.exports = {
  facing: null,
  draw: ({ P, cluster }) => {
    let strings = ''
    for (let i = 0; i < 6; i += 1) strings += `M${98 + i * 9} 124V226`
    return (
      `<path d="M84 110Q60 196 100 236H140Q180 196 156 110" fill="none" stroke="${P.gold}" stroke-width="8" stroke-linecap="round"/>` +
      `<path d="M84 110Q60 196 100 236H140Q180 196 156 110" fill="none" stroke="${P.goldLight}" stroke-width="2" stroke-linecap="round"/>` +
      `<path d="M78 122H162" stroke="${P.goldDeep}" stroke-width="5" stroke-linecap="round"/>` +
      `<path d="${strings}" stroke="${P.goldDeep}" stroke-width=".9"/>` +
      `<circle cx="80" cy="106" r="7" fill="${P.goldDeep}"/><circle cx="160" cy="106" r="7" fill="${P.goldDeep}"/>` +
      `<rect x="96" y="234" width="48" height="14" rx="4" fill="${P.goldDeep}"/>` +
      note(P, 44, 112, 1) +
      note(P, 176, 84, 0.9, true) +
      note(P, 190, 196, 0.8) +
      note(P, 40, 210, 0.7, true) +
      cluster(120, 292, 1)
    )
  },
}
