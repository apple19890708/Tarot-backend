// 40 沙漏：正在流動的沙漏，纏著一枝小花
module.exports = {
  facing: null,
  draw: ({ P, sprig, ground }) =>
    ground(120, 290, 80) +
    `<path d="M86 96H154Q154 140 126 160Q154 180 154 252H86Q86 180 114 160Q86 140 86 96Z" fill="${P.sky}" opacity=".55" stroke="${P.gold}" stroke-width="1.6"/>` +
    `<path d="M96 120H144Q140 140 124 154H116Q100 140 96 120Z" fill="${P.goldLight}"/>` +
    `<path d="M120 156V236" stroke="${P.gold}" stroke-width="1.6" stroke-dasharray="2 3"/>` +
    `<path d="M90 252Q98 220 120 214Q142 220 150 252Z" fill="${P.goldLight}"/>` +
    `<path d="M98 108Q96 140 112 152" fill="none" stroke="${P.paper}" stroke-width="2.4" stroke-linecap="round" opacity=".8"/>` +
    `<rect x="72" y="84" width="96" height="12" rx="4" fill="${P.goldDeep}"/>` +
    `<rect x="72" y="252" width="96" height="12" rx="4" fill="${P.goldDeep}"/>` +
    `<path d="M80 96V252M160 96V252" stroke="${P.goldDeep}" stroke-width="5" stroke-linecap="round"/>` +
    `<circle cx="80" cy="96" r="4" fill="${P.gold}"/><circle cx="160" cy="96" r="4" fill="${P.gold}"/><circle cx="80" cy="252" r="4" fill="${P.gold}"/><circle cx="160" cy="252" r="4" fill="${P.gold}"/>` +
    sprig(60, 286, 130, -78, { leaves: 5, tipSize: 8 }) +
    sprig(184, 286, 90, -104, { leaves: 3, tip: 'bud', tipSize: 7 }),
}
