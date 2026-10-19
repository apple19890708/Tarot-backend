// 工作領域．跨花色（來源＝wands）：14 × 42 = 588 組
// 短語表在 ../_phrases/work.js，組合規則在 ../_phrases/build.js
const { buildCross } = require('../_phrases/build')
const table = require('../_phrases/work')

module.exports = { COMBOS: buildCross('wands', table) }
