// 權杖三：三根木枝排成扇形，枝頭的新芽都朝向遠方的日出（展望、等待成果）
// （不畫背對畫面看海上船隻的人）
module.exports = {
  draw: ({ P, ground, cluster, sparkle, wand, rays }) =>
    rays(120, 96, 30, 50, 14, { color: P.gold, width: 1.6, opacity: 0.7, offset: -180 }) +
    `<path d="M90 96A30 30 0 0 1 150 96Z" fill="${P.gold}"/>` +
    `<path d="M98 96A22 22 0 0 1 142 96Z" fill="${P.goldLight}"/>` +
    `<path d="M24 98Q120 90 216 98" stroke="${P.lav}" stroke-width="1.4" fill="none"/>` +
    `<path d="M40 106Q120 100 200 106M60 114Q120 110 180 114" stroke="${P.lavLight}" stroke-width="1.4" fill="none"/>` +
    ground(120, 290, 92) +
    wand(120, 290, 160, -116, { w: 6 }) +
    wand(120, 290, 172, -90, { w: 6 }) +
    wand(120, 290, 160, -64, { w: 6 }) +
    sparkle(196, 150, 4) +
    sparkle(44, 160, 4) +
    cluster(120, 294, 0.8),
}
