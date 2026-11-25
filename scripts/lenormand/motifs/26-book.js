// 26 書：扣著金扣的書，上面放著一枝花
module.exports = {
  facing: null,
  draw: ({ P, sprig, ground, flower }) =>
    ground(120, 288, 92) +
    `<path d="M172 118L184 126V286L172 280Z" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width="1"/>` +
    `<path d="M175 130V280M179 132V282" stroke="${P.petalEdge}" stroke-width=".7"/>` +
    `<rect x="66" y="114" width="108" height="168" rx="4" fill="${P.lavDeep}"/>` +
    `<rect x="66" y="114" width="14" height="168" rx="3" fill="${P.ink}" opacity=".35"/>` +
    `<rect x="90" y="130" width="72" height="136" rx="2" fill="none" stroke="${P.gold}" stroke-width="1.4"/>` +
    `<path d="M126 164l8 14 14 2-10 10 2 14-14-7-14 7 2-14-10-10 14-2Z" fill="none" stroke="${P.goldLight}" stroke-width="1.2" transform="translate(-8 4)"/>` +
    `<rect x="164" y="186" width="22" height="16" rx="3" fill="${P.gold}"/><circle cx="178" cy="194" r="2.6" fill="${P.goldDeep}"/>` +
    `<path d="M140 282V306L146 300L152 306V282Z" fill="${P.rose}"/>` +
    sprig(70, 108, 120, -18, { leaves: 4, tipSize: 10 }) +
    flower(88, 102, 7),
}
