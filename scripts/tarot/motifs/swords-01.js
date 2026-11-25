// 寶劍王牌：一柄劍尖朝上直立，劍尖一圈光暈，旁邊飄著一片羽毛（清晰的想法、突破）
// （不畫雲中的手與劍尖上的王冠）
module.exports = {
  draw: ({ P, ground, cluster, sparkle, sword, glow, rays, feather }) =>
    glow(120, 66, 30, P.goldLight, 0.6) +
    `<circle cx="120" cy="66" r="18" fill="none" stroke="${P.gold}" stroke-width="1.6"/>` +
    rays(120, 66, 24, 38, 12, { color: P.gold, width: 1.2, opacity: 0.6 }) +
    ground(120, 290, 80) +
    sword(120, 244, 188, -90) +
    feather(156, 120, 34, -130) +
    sparkle(70, 110, 4) +
    sparkle(176, 180, 4) +
    cluster(84, 294, 0.75) +
    cluster(156, 294, 0.75),
}
