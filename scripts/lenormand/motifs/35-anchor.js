// 35 錨：纏著繩子的錨
module.exports = {
  facing: null,
  draw: ({ P, ground, cluster }) => {
    const c = P.lavDeep
    return (
      ground(120, 292, 92) +
      `<circle cx="120" cy="82" r="13" fill="none" stroke="${c}" stroke-width="6"/>` +
      `<rect x="114" y="94" width="12" height="178" rx="3" fill="${c}"/>` +
      `<rect x="80" y="110" width="80" height="10" rx="5" fill="${c}"/>` +
      `<path d="M62 220Q72 278 120 280Q168 278 178 220" fill="none" stroke="${c}" stroke-width="10" stroke-linecap="round"/>` +
      `<path d="M50 232L62 208L76 230Z" fill="${c}"/><path d="M190 232L178 208L164 230Z" fill="${c}"/>` +
      `<path d="M120 70Q150 84 132 120Q104 150 126 176Q150 204 116 230Q96 248 118 266" fill="none" stroke="${P.gold}" stroke-width="3.5" stroke-linecap="round"/>` +
      `<path d="M120 70Q150 84 132 120Q104 150 126 176Q150 204 116 230Q96 248 118 266" fill="none" stroke="${P.goldLight}" stroke-width="1.2" stroke-dasharray="3 3"/>` +
      cluster(58, 292, 0.85) +
      cluster(182, 292, 0.85)
    )
  },
}
