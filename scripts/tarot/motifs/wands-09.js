// 權杖九：九根木枝排成柵欄，正中那根纏著像繃帶的藤（受了傷，但還守得住）
// （不畫頭纏繃帶的守衛）
module.exports = {
  draw: ({ P, leaf, flower, ground, grass, wand }) => {
    let fence = ''
    for (let i = 0; i < 9; i += 1) {
      const x = 32 + i * 22
      const h = i === 4 ? 160 : 124 + ((i * 7) % 3) * 6
      fence += wand(x, 288, h, -90, { w: i === 4 ? 6 : 4.4 })
    }
    return (
      ground(120, 292, 106) +
      fence +
      `<path d="M28 220H212M28 250H212" stroke="${P.bark}" stroke-width="2.4" stroke-linecap="round"/>` +
      // 繃帶般纏繞的藤
      `<path d="M112 230L128 222M112 216L128 208M112 202L128 194M112 188L128 180" stroke="${P.paper}" stroke-width="4" stroke-linecap="round"/>` +
      `<path d="M112 230L128 222M112 216L128 208M112 202L128 194M112 188L128 180" stroke="${P.roseLight}" stroke-width="1" stroke-linecap="round"/>` +
      leaf(128, 182, 12, -30, P.sage) +
      flower(130, 178, 5) +
      grass(60, 290, 22) +
      grass(180, 290, 22)
    )
  },
}
