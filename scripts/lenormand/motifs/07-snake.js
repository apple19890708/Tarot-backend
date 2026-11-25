// 7 蛇：S 形的蛇，頭朝左（朝左）
const BODY = 'M206 282C160 296 86 276 104 234C122 192 192 214 176 164C162 124 112 132 88 120'

module.exports = {
  facing: 'left',
  draw: ({ P, sprig, cluster }) =>
    sprig(196, 300, 170, -100, { leaves: 5, tipSize: 8 }) +
    `<path d="${BODY}" fill="none" stroke="${P.sageDeep}" stroke-width="17" stroke-linecap="round"/>` +
    `<path d="${BODY}" fill="none" stroke="${P.sage}" stroke-width="9" stroke-linecap="round" stroke-dasharray="3 7"/>` +
    `<path d="${BODY}" fill="none" stroke="${P.sageLight}" stroke-width="2.5" stroke-linecap="round" transform="translate(0 4)" opacity=".8"/>` +
    `<ellipse cx="78" cy="116" rx="17" ry="11" transform="rotate(-12 78 116)" fill="${P.sageDeep}"/>` +
    `<circle cx="72" cy="111" r="2.4" fill="${P.paper}"/><circle cx="71.6" cy="111" r="1.2" fill="${P.ink}"/>` +
    `<path d="M62 120L48 122M48 122l-6-4M48 122l-6 4" stroke="${P.rose}" stroke-width="1.6" stroke-linecap="round" fill="none"/>` +
    cluster(46, 290, 0.9),
}
