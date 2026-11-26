// 寶劍四：四柄劍收在牆上的劍架，劍架前一盞蠟燭、一隻蜷著睡的小貓（休息、暫停、復原）
// （不畫石棺上躺著的騎士與彩繪玻璃）
module.exports = {
  draw: ({ P, ground, sword, glow, C }) =>
    // 劍架
    `<rect x="40" y="84" width="160" height="128" rx="6" fill="${C.stone}" opacity=".55"/>` +
    `<path d="M50 96V204M190 96V204" stroke="${P.bark}" stroke-width="4" stroke-linecap="round"/>` +
    [110, 136, 162, 188].map((y) => `<circle cx="52" cy="${y}" r="3" fill="${P.goldDeep}"/><circle cx="188" cy="${y}" r="3" fill="${P.goldDeep}"/>`).join('') +
    [110, 136, 162, 188].map((y) => sword(62, y - 4, 140, 0)).join('') +
    ground(120, 284, 100) +
    // 蠟燭
    glow(52, 228, 22, P.goldLight, 0.7) +
    `<rect x="45" y="238" width="14" height="40" rx="2" fill="${P.paper}" stroke="${P.petalEdge}" stroke-width=".8"/>` +
    `<path d="M52 238V232" stroke="${P.ink}" stroke-width="1"/>` +
    `<path d="M52 220Q57 228 52 233Q47 228 52 220Z" fill="${P.gold}"/>` +
    `<ellipse cx="52" cy="279" rx="12" ry="3" fill="${P.gold}"/>` +
    // 睡著的小貓
    `<ellipse cx="140" cy="266" rx="40" ry="18" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1"/>` +
    `<path d="M178 270Q190 286 160 284Q128 284 112 276" fill="none" stroke="${P.lavDeep}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M178 270Q190 286 160 284Q128 284 112 276" fill="none" stroke="${P.lavLight}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="110" cy="260" r="15" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1"/>` +
    `<path d="M98 252L98 238L108 247ZM114 246L122 236L122 251Z" fill="${P.lavLight}" stroke="${P.lavDeep}" stroke-width="1" stroke-linejoin="round"/>` +
    `<path d="M102 260q3 2.5 6 0M114 260q3 2.5 6 0" fill="none" stroke="${P.ink}" stroke-width="1.2" stroke-linecap="round"/>` +
    `<path d="M109 265l2 2l2-2" fill="none" stroke="${P.rose}" stroke-width="1"/>` +
    `<text x="150" y="238" font-family="Georgia,serif" font-size="11" fill="${P.lavDeep}" opacity=".7">z</text>` +
    `<text x="160" y="226" font-family="Georgia,serif" font-size="14" fill="${P.lavDeep}" opacity=".6">z</text>`,
}
