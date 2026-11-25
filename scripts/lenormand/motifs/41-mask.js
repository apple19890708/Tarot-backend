// 41 面具：帶羽毛與緞帶的舞會面具
module.exports = {
  facing: null,
  draw: ({ P, cluster, sparkle }) =>
    `<path d="M178 168L200 290" stroke="${P.goldDeep}" stroke-width="4" stroke-linecap="round"/>` +
    `<path d="M168 138Q196 70 226 60Q206 100 188 140Z" fill="${P.lavLight}" stroke="${P.lav}" stroke-width="1.2"/>` +
    `<path d="M178 136Q200 92 222 66M186 116l12-4M192 100l12-6M182 128l10-2" stroke="${P.lav}" stroke-width="1" fill="none"/>` +
    `<path d="M38 150Q58 118 100 134Q120 144 140 134Q182 118 202 150Q198 186 160 188Q132 188 120 168Q108 188 80 188Q42 186 38 150Z" fill="${P.lavDeep}" stroke="${P.gold}" stroke-width="2"/>` +
    `<path d="M62 156Q76 142 98 154Q86 170 70 166Z" fill="${P.paper}"/><path d="M178 156Q164 142 142 154Q154 170 170 166Z" fill="${P.paper}"/>` +
    `<path d="M50 150Q60 132 84 136M190 150Q180 132 156 136" fill="none" stroke="${P.goldLight}" stroke-width="1.4"/>` +
    `<g fill="${P.gold}"><circle cx="120" cy="150" r="3"/><circle cx="56" cy="170" r="2"/><circle cx="184" cy="170" r="2"/></g>` +
    `<path d="M40 152Q24 180 34 214M40 152Q34 186 50 206" fill="none" stroke="${P.rose}" stroke-width="3" stroke-linecap="round"/>` +
    sparkle(80, 96, 6) +
    sparkle(140, 236, 5) +
    cluster(84, 292, 0.85),
}
