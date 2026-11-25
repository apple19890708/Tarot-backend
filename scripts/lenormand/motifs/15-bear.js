// 15 熊：往左走的熊（朝左）
module.exports = {
  facing: 'left',
  draw: ({ P, ground, cluster, grass }) => {
    const fur = '#8f8478'
    return (
      ground(120, 286, 104) +
      `<g fill="${fur}">` +
      `<ellipse cx="132" cy="204" rx="64" ry="38"/>` +
      `<path d="M150 170Q168 160 186 178L176 196Z"/>` +
      `<circle cx="72" cy="184" r="23"/><ellipse cx="53" cy="193" rx="13" ry="10"/>` +
      `<circle cx="66" cy="164" r="7"/><circle cx="82" cy="164" r="6.5"/>` +
      `<rect x="78" y="214" width="20" height="66" rx="8"/><rect x="104" y="222" width="20" height="58" rx="8"/>` +
      `<rect x="152" y="222" width="20" height="58" rx="8"/><rect x="176" y="212" width="20" height="68" rx="8"/>` +
      `</g>` +
      `<ellipse cx="44" cy="190" rx="4" ry="3" fill="${P.ink}"/><circle cx="64" cy="178" r="2.2" fill="${P.ink}"/>` +
      `<circle cx="66" cy="164" r="3" fill="${P.roseLight}" opacity=".7"/>` +
      `<path d="M96 196Q130 186 170 194" stroke="${P.paper}" stroke-width="2" fill="none" opacity=".25"/>` +
      grass(36, 286, 26) +
      cluster(212, 290, 0.8)
    )
  },
}
