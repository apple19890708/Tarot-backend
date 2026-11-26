// 權杖王牌：一根新枝直立，頂端冒出嫩葉與白花，周圍淡金光芒（新的熱情、開始行動）
// （不畫雲中伸出的手）
module.exports = {
  draw: ({ P, leaf, ground, grass, cluster, sparkle, wand, rays, glow }) =>
    glow(120, 92, 60, P.goldLight, 0.5) +
    rays(120, 92, 40, 74, 16, { color: P.gold, width: 1.4, opacity: 0.6 }) +
    ground(120, 290, 80) +
    wand(120, 292, 206, -90, { w: 8 }) +
    leaf(120, 210, 24, -150, P.sage) +
    leaf(120, 196, 22, -30, P.sageDeep) +
    leaf(120, 150, 18, -140, P.sageDeep) +
    sparkle(76, 70, 5) +
    sparkle(166, 60, 4) +
    sparkle(178, 120, 4) +
    grass(84, 290, 22) +
    cluster(160, 294, 0.75),
}
