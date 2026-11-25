// 38 影子：一個人站在光裡，身後拖著長長的影子
function figure(P, fill) {
  return (
    `<circle cx="0" cy="-138" r="13" fill="${fill}"/>` +
    `<path d="M-15 -120Q0 -126 15 -120L22 -40H-22Z" fill="${fill}"/>` +
    `<path d="M-10 -40V0M10 -40V0" stroke="${fill}" stroke-width="8" stroke-linecap="round"/>`
  )
}

module.exports = {
  facing: null,
  draw: ({ P, ground, sparkle, grass }) =>
    `<circle cx="40" cy="72" r="22" fill="${P.goldLight}"/>` +
    `<circle cx="40" cy="72" r="34" fill="${P.goldLight}" opacity=".35"/>` +
    ground(130, 284, 104) +
    `<g transform="translate(86 282) matrix(1 0 -0.75 0.28 0 0)" opacity=".55">${figure(P, P.lavDeep)}</g>` +
    `<g transform="translate(86 282)">${figure(P, P.lav)}</g>` +
    `<path d="M74 160Q86 150 98 160" fill="none" stroke="${P.paper}" stroke-width="1.6" opacity=".7"/>` +
    sparkle(72, 112, 4) +
    grass(30, 284, 22) +
    grass(220, 284, 22),
}
