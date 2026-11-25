// 23 老鼠：兩隻在麥穗旁邊啃食的老鼠
function mouse(P, x, y, s, dir) {
  // dir 1 朝右、-1 朝左
  const fur = '#a8a29a'
  const t = (dx, dy) => `${x + dx * s * dir} ${y + dy * s}`
  return (
    `<path d="M${t(-26, 4)}Q${t(-56, 10)} ${t(-50, -14)}Q${t(-46, -30)} ${t(-66, -30)}" fill="none" stroke="${P.rose}" stroke-width="${2 * s}" stroke-linecap="round"/>` +
    `<path d="M${t(-30, 8)}Q${t(-30, -22)} ${t(0, -22)}Q${t(20, -22)} ${t(32, -2)}L${t(40, 2)}Q${t(30, 10)} ${t(10, 10)}Z" fill="${fur}"/>` +
    `<circle cx="${x + 12 * s * dir}" cy="${y - 20 * s}" r="${8 * s}" fill="${fur}"/>` +
    `<circle cx="${x + 12 * s * dir}" cy="${y - 20 * s}" r="${4.5 * s}" fill="${P.roseLight}"/>` +
    `<circle cx="${x + 26 * s * dir}" cy="${y - 7 * s}" r="${1.8 * s}" fill="${P.ink}"/>` +
    `<circle cx="${x + 40 * s * dir}" cy="${y + 2 * s}" r="${2 * s}" fill="${P.rose}"/>`
  )
}

module.exports = {
  facing: null,
  draw: ({ P, ground, grass }) => {
    let wheat = `<path d="M124 290Q118 220 132 150" fill="none" stroke="${P.goldDeep}" stroke-width="1.6"/>`
    for (let k = 0; k < 7; k += 1) {
      const y = 154 + k * 9
      wheat += `<ellipse cx="128" cy="${y}" rx="3" ry="6" transform="rotate(-25 128 ${y})" fill="${P.gold}"/><ellipse cx="137" cy="${y + 4}" rx="3" ry="6" transform="rotate(25 137 ${y + 4})" fill="${P.gold}"/>`
    }
    return (
      ground(120, 288, 100) +
      wheat +
      `<path d="M150 288Q160 250 186 236" fill="none" stroke="${P.goldDeep}" stroke-width="1.4"/>` +
      `<g fill="${P.goldLight}"><ellipse cx="96" cy="282" rx="3" ry="2"/><ellipse cx="104" cy="286" rx="2.5" ry="2"/><ellipse cx="160" cy="284" rx="3" ry="2"/></g>` +
      mouse(P, 74, 276, 1.05, 1) +
      mouse(P, 176, 280, 0.9, -1) +
      grass(30, 288, 22) +
      grass(214, 288, 22)
    )
  },
}
