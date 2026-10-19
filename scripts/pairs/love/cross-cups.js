// 感情領域．跨花色（來源＝cups）：14 × 42 = 588 組
// 短語表在 ../_phrases/love.js，組合規則在 ../_phrases/build.js
const { buildCross } = require('../_phrases/build')
const table = require('../_phrases/love')

module.exports = { COMBOS: buildCross('cups', table) }
