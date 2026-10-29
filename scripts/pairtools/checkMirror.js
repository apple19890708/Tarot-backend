// 鏡像比對：A→B 與 B→A 對應的兩句，最長共同子字串（去掉標點）達到門檻就列出。
// 四項稽核只抓一字不差的整句重複，抓不到「換了開頭、中間照抄」的鏡像句。
// slot 對應：A→B 的 [正正, 正逆, 逆正, 逆逆] 對上 B→A 的 [正正, 逆正, 正逆, 逆逆]，也就是 0↔0、1↔2、2↔1、3↔3。
// 用法：node scripts/pairtools/checkMirror.js <領域> <花色> <來源牌...>
const path = require('path')

const [domain, suit, ...sources] = process.argv.slice(2)
const { COMBOS } = require(path.resolve(`scripts/pairs/${domain}/${suit}.js`))
const MIN = 8
const SLOT = [0, 2, 1, 3]

function longestCommon(a, b) {
  let best = ''
  for (let i = 0; i < a.length; i++) {
    for (let j = i + best.length + 1; j <= a.length; j++) {
      if (b.includes(a.slice(i, j))) best = a.slice(i, j)
      else break
    }
  }
  return best
}

const mark = (text) => text.replace(/[，。：？]/g, '|')
let hits = 0
for (const source of sources) {
  for (const row of COMBOS.filter((r) => r[0] === source)) {
    const mirror = COMBOS.find((r) => r[0] === row[1] && r[1] === row[0])
    if (!mirror) continue
    row[2].forEach((text, i) => {
      const core = longestCommon(mark(text), mark(mirror[2][SLOT[i]])).replace(/\|/g, '')
      if (core.length >= MIN) {
        hits++
        console.log(`${row[0]}→${row[1]} ${i}　【${core}】`)
      }
    })
  }
}
console.log(`鏡像相似 ${hits} 句`)
