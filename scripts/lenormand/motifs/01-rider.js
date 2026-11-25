// 1 騎士：騎馬的人往右前進（朝右：消息從這個方向帶來）
module.exports = {
  facing: 'right',
  draw: ({ P, ground, cluster, grass }) => {
    const horse = P.lavDeep
    return (
      ground(120, 266, 104) +
      grass(36, 266, 28) +
      grass(206, 266, 26) +
      `<g fill="${horse}">` +
      `<path d="M70 186Q48 196 50 238Q60 214 76 204Z"/>` +
      `<ellipse cx="118" cy="196" rx="52" ry="25"/>` +
      `<path d="M148 186Q164 160 170 138L188 144Q184 172 166 206Z"/>` +
      `<path d="M171 136Q192 124 209 140L211 152Q198 158 185 152Z"/>` +
      `<path d="M176 132L180 119L187 134Z"/>` +
      `</g>` +
      `<path d="M88 212L80 260M102 214L110 260M138 214L130 260M152 210L164 256" stroke="${horse}" stroke-width="7" stroke-linecap="round"/>` +
      `<path d="M171 140Q158 152 154 174" stroke="${P.lav}" stroke-width="4" fill="none" stroke-linecap="round"/>` +
      `<path d="M118 128Q98 122 88 132Q102 134 116 138Z" fill="${P.gold}"/>` +
      `<g fill="${P.ink}">` +
      `<path d="M110 176Q104 142 120 126L134 128Q142 150 132 178Z"/>` +
      `<circle cx="128" cy="114" r="9"/>` +
      `<rect x="119" y="91" width="18" height="14" rx="2"/><rect x="114" y="103" width="28" height="3.5" rx="1.5"/>` +
      `<path d="M114 172L122 206H131L128 172Z"/>` +
      `</g>` +
      `<path d="M131 144L178 150" stroke="${P.goldDeep}" stroke-width="1.3"/>` +
      cluster(40, 272, 0.85) +
      cluster(202, 274, 0.75)
    )
  },
}
