// 52 鑽石：切割面的寶石與光芒
module.exports = {
  facing: null,
  draw: ({ P, sparkle, cluster }) =>
    `<path d="M120 60V40M178 84l14-14M62 84L48 70M196 140h18M44 140H26" stroke="${P.goldLight}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M84 104H156L186 140H54Z" fill="${P.lavLight}" stroke="${P.gold}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M54 140H186L120 250Z" fill="${P.sky}" stroke="${P.gold}" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<path d="M84 104L100 140L120 104L140 140L156 104" fill="none" stroke="${P.gold}" stroke-width="1"/>` +
    `<path d="M100 140L120 250L140 140M54 140L120 250M186 140L120 250" fill="none" stroke="${P.gold}" stroke-width="1"/>` +
    `<path d="M100 140L120 104L140 140Z" fill="${P.paper}" opacity=".9"/>` +
    `<path d="M54 140L84 104L100 140Z" fill="${P.lav}" opacity=".6"/>` +
    `<path d="M140 140L120 250L186 140Z" fill="${P.water}" opacity=".35"/>` +
    sparkle(172, 104, 9, P.paper) +
    sparkle(172, 104, 6) +
    sparkle(66, 200, 6) +
    sparkle(188, 210, 4) +
    cluster(120, 294, 0.95),
}
