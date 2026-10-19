// 財務領域．跨花色（來源＝swords）：14 × 42 = 588 組
// 短語表在 ../_phrases/money.js，組合規則在 ../_phrases/build.js
const { buildCross } = require('../_phrases/build')
const table = require('../_phrases/money')

module.exports = { COMBOS: buildCross('swords', table) }
