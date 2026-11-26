// IV 皇帝：方正的石台上立著金色權杖，兩側修剪整齊的樹籬，背後穩重的群山
// （不畫石王座、公羊頭與坐著的皇帝）
module.exports = {
  draw: ({ P, ground, sparkle, cluster, C }) =>
    `<path d="M0 226L46 140L76 182L120 104L160 170L194 128L240 226Z" fill="${P.lavLight}"/>` +
    `<path d="M120 104L108 128L118 124L124 136L132 120ZM46 140L38 156L48 152L54 160ZM194 128L186 144L196 140L202 148Z" fill="${P.paper}"/>` +
    `<path d="M0 240Q60 206 120 222Q180 206 240 236V260H0Z" fill="${P.sageLight}"/>` +
    ground(120, 290, 104) +
    // 修剪成圓球的樹籬
    [40, 200].map((x) =>
      `<rect x="${x - 3}" y="262" width="6" height="22" fill="${P.bark}"/>` +
      `<circle cx="${x}" cy="246" r="24" fill="${P.sage}"/>` +
      `<path d="M${x - 22} 252Q${x} 274 ${x + 22} 252A24 24 0 0 1 ${x - 22} 252Z" fill="${P.sageDeep}" opacity=".3"/>` +
      `<circle cx="${x - 8}" cy="238" r="8" fill="${P.sageLight}" opacity=".6"/>` +
      `<path d="M${x - 12} 284H${x + 12}L${x + 9} 292H${x - 9}Z" fill="${C.stone}" stroke="${C.stoneEdge}" stroke-width=".8"/>`,
    ).join('') +
    // 石台
    `<rect x="64" y="262" width="112" height="24" rx="2" fill="${C.stone}" stroke="${C.stoneEdge}" stroke-width="1.2"/>` +
    `<rect x="82" y="222" width="76" height="40" rx="2" fill="${C.stone}" stroke="${C.stoneEdge}" stroke-width="1.2"/>` +
    `<path d="M64 274H176M120 262V274M92 274V286M148 274V286M82 242H158M108 222V242M134 242V262" stroke="${C.stoneEdge}" stroke-width=".8"/>` +
    // 權杖
    `<path d="M120 222V118" stroke="${P.goldDeep}" stroke-width="5" stroke-linecap="round"/>` +
    `<path d="M120 216V124" stroke="${P.goldLight}" stroke-width="1.4"/>` +
    `<rect x="110" y="168" width="20" height="5" rx="2" fill="${P.gold}"/>` +
    `<circle cx="120" cy="106" r="13" fill="${P.gold}"/>` +
    `<circle cx="116" cy="102" r="4" fill="${P.goldLight}"/>` +
    `<path d="M107 106H133" stroke="${P.goldDeep}" stroke-width="1.2"/>` +
    sparkle(120, 84, 6) +
    cluster(42, 292, 0.6) +
    cluster(198, 292, 0.6),
}
