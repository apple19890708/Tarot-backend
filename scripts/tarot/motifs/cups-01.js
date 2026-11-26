// 聖杯王牌：一只杯滿溢出水，杯口長出一朵白蓮，上方一滴光（新的感情、情感湧現）
// （不畫雲中的手與銜圓餅的鴿子）
module.exports = {
  draw: ({ P, waves, sparkle, cup, glow }) =>
    glow(120, 70, 28, P.goldLight, 0.7) +
    `<path d="M120 52Q130 68 130 76A10 10 0 0 1 110 76Q110 68 120 52Z" fill="${P.goldLight}" stroke="${P.gold}" stroke-width="1.2"/>` +
    `<ellipse cx="120" cy="276" rx="96" ry="18" fill="${P.sky}"/>` +
    waves(50, 272, 140, { rows: 2, gap: 8 }) +
    // 溢出的水
    `<path d="M82 134Q70 170 76 214Q78 240 70 268M158 134Q170 170 164 214Q162 240 170 268" fill="none" stroke="${P.water}" stroke-width="2.6" stroke-linecap="round"/>` +
    `<path d="M86 134Q76 172 82 220M154 134Q164 172 158 220" fill="none" stroke="${P.sky}" stroke-width="1.4" stroke-linecap="round"/>` +
    cup(120, 134, 2.1, { water: true }) +
    // 白蓮
    `<g fill="${P.white}" stroke="${P.petalEdge}" stroke-width=".8">` +
    `<path d="M120 132Q96 124 92 104Q110 108 120 132Z"/>` +
    `<path d="M120 132Q144 124 148 104Q130 108 120 132Z"/>` +
    `<path d="M120 132Q104 114 108 94Q118 104 120 132Z"/>` +
    `<path d="M120 132Q136 114 132 94Q122 104 120 132Z"/>` +
    `<path d="M120 132Q110 108 120 86Q130 108 120 132Z"/>` +
    `</g>` +
    `<circle cx="120" cy="118" r="3.4" fill="${P.gold}"/>` +
    sparkle(60, 100, 5) +
    sparkle(182, 92, 4),
}
