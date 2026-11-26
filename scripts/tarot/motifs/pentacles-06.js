// 錢幣六：一個大碗傾斜，錢幣一枚枚流向下方三個小碗（分享、給予與接受）
// （不畫拿天平施捨的商人）
function bowl(P, x, y, w) {
  return (
    `<path d="M${x - w} ${y}Q${x} ${y + w * 0.9} ${x + w} ${y}Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1.2"/>` +
    `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${w * 0.18}" fill="${P.paper}" stroke="${P.lavDeep}" stroke-width="1"/>`
  )
}

module.exports = {
  draw: ({ P, ground, cluster, coin, sparkle }) =>
    ground(120, 290, 104) +
    // 大碗
    `<g transform="rotate(22 104 104)">${coin(104, 96, 13)}${bowl(P, 104, 104, 38)}</g>` +
    // 落下的錢幣
    coin(140, 142, 9) +
    coin(126, 178, 9) +
    `<path d="M150 130Q160 150 150 170M136 168Q128 190 120 214" fill="none" stroke="${P.goldLight}" stroke-width="1.2" stroke-dasharray="2 4"/>` +
    // 三個小碗
    coin(60, 244, 9) +
    bowl(P, 60, 252, 24) +
    coin(120, 248, 9) +
    bowl(P, 120, 256, 24) +
    coin(180, 244, 9) +
    bowl(P, 180, 252, 24) +
    sparkle(190, 110, 5) +
    cluster(120, 294, 0.65),
}
