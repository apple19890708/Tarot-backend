// 10 鐮刀：刀刃朝左的長柄鐮刀，旁邊是麥穗（朝左：刀刃指的方向被切斷）
function wheat(P) {
  let out = ''
  for (let i = 0; i < 4; i += 1) {
    const x = 50 + i * 15
    const top = 168 + (i % 2) * 14
    out += `<path d="M${x} 292Q${x - 4} ${top + 50} ${x + 2} ${top}" fill="none" stroke="${P.goldDeep}" stroke-width="1.4"/>`
    for (let k = 0; k < 5; k += 1) {
      const y = top + 4 + k * 8
      out += `<ellipse cx="${x - 3}" cy="${y}" rx="2.6" ry="5" transform="rotate(-25 ${x - 3} ${y})" fill="${P.gold}"/><ellipse cx="${x + 5}" cy="${y + 3}" rx="2.6" ry="5" transform="rotate(25 ${x + 5} ${y + 3})" fill="${P.gold}"/>`
    }
  }
  return out
}

module.exports = {
  facing: 'left',
  draw: ({ P, ground, flower }) =>
    ground(120, 292, 96) +
    wheat(P) +
    `<path d="M176 292Q170 180 154 84" fill="none" stroke="${P.bark}" stroke-width="6" stroke-linecap="round"/>` +
    `<path d="M166 196L142 202" stroke="${P.bark}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M156 86Q98 66 40 112Q94 90 152 104Z" fill="#c3c7cd" stroke="${P.ink}" stroke-width="1"/>` +
    `<path d="M150 92Q102 80 58 104" fill="none" stroke="${P.paper}" stroke-width="1.4" opacity=".9"/>` +
    `<rect x="148" y="84" width="14" height="12" rx="2" transform="rotate(-10 155 90)" fill="${P.goldDeep}"/>` +
    flower(196, 282, 7) +
    flower(210, 270, 5.5),
}
