// 權杖四：四根木枝當籬笆柱，圍出一間開花的小屋（安定、歸屬、值得慶祝的成果）
// （不畫四杖頂掛花環、城堡前的人群）
module.exports = {
  draw: ({ P, leaf, flower, ground, cluster, wand, sparkle }) =>
    ground(120, 288, 104) +
    // 後排柱子與欄杆
    wand(78, 246, 96, -90, { w: 4.4 }) +
    wand(162, 246, 96, -90, { w: 4.4 }) +
    `<path d="M78 212H162M78 230H162" stroke="${P.bark}" stroke-width="2.2"/>` +
    // 小屋
    `<rect x="94" y="190" width="52" height="52" fill="${P.paper}" stroke="${P.bark}" stroke-width="1.4"/>` +
    `<path d="M86 192L120 158L154 192Z" fill="${P.lav}" stroke="${P.lavDeep}" stroke-width="1.2" stroke-linejoin="round"/>` +
    `<rect x="112" y="214" width="16" height="28" rx="7" fill="${P.ochre}"/>` +
    `<rect x="100" y="200" width="10" height="10" fill="${P.goldLight}" stroke="${P.bark}" stroke-width=".8"/>` +
    `<rect x="132" y="200" width="10" height="10" fill="${P.goldLight}" stroke="${P.bark}" stroke-width=".8"/>` +
    leaf(96, 240, 14, -120, P.sage) +
    leaf(144, 240, 14, -60, P.sage) +
    flower(98, 232, 5) +
    flower(142, 232, 5, { rot: 30 }) +
    // 前排柱子與欄杆
    wand(44, 290, 128, -90, { w: 5.5 }) +
    wand(196, 290, 128, -90, { w: 5.5 }) +
    `<path d="M44 236Q120 246 196 236M44 262Q120 272 196 262" fill="none" stroke="${P.bark}" stroke-width="2.6" stroke-linecap="round"/>` +
    flower(70, 246, 6, { rot: 10 }) +
    flower(170, 248, 6, { rot: 40 }) +
    flower(120, 268, 6) +
    sparkle(120, 140, 5) +
    cluster(120, 296, 0.6),
}
