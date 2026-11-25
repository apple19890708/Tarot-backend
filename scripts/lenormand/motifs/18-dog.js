// 18 狗：坐著、朝右看的狗（朝右）
module.exports = {
  facing: 'right',
  draw: ({ P, ground, cluster }) => {
    const fur = '#b8ac9c'
    const dark = '#8f8476'
    return (
      ground(120, 288, 96) +
      `<path d="M90 268Q60 262 62 234" stroke="${fur}" stroke-width="8" fill="none" stroke-linecap="round"/>` +
      `<path d="M84 284Q76 222 110 194L142 198Q154 248 148 284Z" fill="${fur}"/>` +
      `<path d="M134 240L136 284M148 236L152 284" stroke="${dark}" stroke-width="6" stroke-linecap="round"/>` +
      `<circle cx="148" cy="164" r="23" fill="${fur}"/>` +
      `<ellipse cx="171" cy="172" rx="15" ry="10" fill="${fur}"/>` +
      `<path d="M134 150Q122 170 130 192Q144 174 146 152Z" fill="${dark}"/>` +
      `<circle cx="154" cy="159" r="2.4" fill="${P.ink}"/><ellipse cx="185" cy="168" rx="4" ry="3" fill="${P.ink}"/>` +
      `<path d="M120 192Q136 202 154 190" stroke="${P.rose}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
      `<circle cx="138" cy="200" r="3.5" fill="${P.gold}"/>` +
      cluster(196, 292, 0.85) +
      cluster(44, 292, 0.7)
    )
  },
}
