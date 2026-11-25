// 44 棋子：棋盤上的騎士與兵
module.exports = {
  facing: null,
  draw: ({ P, cluster }) => {
    let board = ''
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 6; c += 1) {
        const y = 250 + r * 14
        const shift = (2 - r) * 10
        const x = 30 + shift / 2 + c * (30 - shift / 6)
        board += `<path d="M${x} ${y}h${30 - shift / 6}l-4 14h-${30 - shift / 6}Z" fill="${(r + c) % 2 ? P.lavLight : P.paper}"/>`
      }
    }
    return (
      board +
      `<path d="M26 250H214L208 292H32Z" fill="none" stroke="${P.gold}" stroke-width="1.4"/>` +
      `<g fill="${P.ink}">` +
      `<path d="M74 262H138V250H130Q136 202 124 172Q140 178 148 164Q134 132 100 126L96 112L88 130Q70 150 78 182Q92 176 100 182Q86 216 90 250H74Z"/>` +
      `<rect x="68" y="260" width="76" height="10" rx="3"/>` +
      `</g>` +
      `<circle cx="112" cy="148" r="3" fill="${P.paper}"/>` +
      `<path d="M96 138Q86 150 86 168" stroke="${P.lavDeep}" stroke-width="3" fill="none"/>` +
      `<circle cx="176" cy="178" r="13" fill="${P.paper}" stroke="${P.ink}" stroke-width="1.6"/>` +
      `<path d="M164 252Q166 214 172 192H180Q186 214 188 252Z" fill="${P.paper}" stroke="${P.ink}" stroke-width="1.6"/>` +
      `<rect x="158" y="250" width="36" height="10" rx="3" fill="${P.paper}" stroke="${P.ink}" stroke-width="1.6"/>` +
      `<rect x="166" y="190" width="20" height="5" rx="2" fill="${P.paper}" stroke="${P.ink}" stroke-width="1.4"/>` +
      cluster(206, 104, 0.6) +
      cluster(34, 96, 0.55)
    )
  },
}
