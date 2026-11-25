// XI 正義：一架天平懸在兩根交會的橄欖枝下，兩盤平衡；下方直立一片劍形長葉（公正、平衡）
// （不畫端坐持劍與天平的女性）
function pan(P, x) {
  return (
    `<path d="M${x} 116L${x - 20} 170M${x} 116L${x + 20} 170" stroke="${P.goldDeep}" stroke-width=".9"/>` +
    `<path d="M${x - 24} 170Q${x} 188 ${x + 24} 170Z" fill="${P.goldLight}" stroke="${P.gold}" stroke-width="1.4"/>`
  )
}

module.exports = {
  draw: ({ P, leaf, flower, sprig, ground, cluster, sparkle }) =>
    // 交會的橄欖枝
    sprig(6, 56, 118, 14, { leaves: 7, tip: 'none', bend: -0.12 }) +
    sprig(234, 56, 118, 166, { leaves: 7, tip: 'none', bend: 0.12 }) +
    `<g fill="${P.sageDeep}"><ellipse cx="40" cy="70" rx="3" ry="4.4"/><ellipse cx="74" cy="74" rx="3" ry="4.4"/><ellipse cx="200" cy="70" rx="3" ry="4.4"/><ellipse cx="166" cy="74" rx="3" ry="4.4"/></g>` +
    // 天平
    `<path d="M120 82V108" stroke="${P.goldDeep}" stroke-width="1.4"/>` +
    `<circle cx="120" cy="110" r="5" fill="${P.gold}"/>` +
    `<path d="M52 114H188" stroke="${P.gold}" stroke-width="3.2" stroke-linecap="round"/>` +
    `<path d="M120 110L114 124H126Z" fill="${P.gold}"/>` +
    `<circle cx="52" cy="114" r="3" fill="${P.goldDeep}"/><circle cx="188" cy="114" r="3" fill="${P.goldDeep}"/>` +
    pan(P, 52) +
    pan(P, 188) +
    flower(52, 168, 5) +
    flower(188, 168, 5) +
    // 劍形長葉
    ground(120, 290, 80) +
    leaf(120, 292, 110, -90, P.sage, 0.11) +
    `<path d="M120 290V190" stroke="${P.sageDeep}" stroke-width="1" opacity=".7"/>` +
    leaf(120, 268, 14, 180, P.sageDeep, 0.4) +
    leaf(120, 268, 14, 0, P.sageDeep, 0.4) +
    sparkle(120, 168, 5) +
    cluster(64, 294, 0.75) +
    cluster(178, 294, 0.75),
}
