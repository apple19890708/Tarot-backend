// 檢查句尾補語是不是在重講前面已經說過的事（唯讀）。
//
// 用法：node scripts/pairtools/checkTail.js <領域> <花色> [來源牌...]
//
// 判準：把句子依「，。：」切成子句，拿最後一個子句和前面的內容比對，
// 取最長共同子字串。中文裡連續 3 個字相同幾乎就是在重複同一件事。
const [domain, suit, ...sources] = process.argv.slice(2)
const { COMBOS } = require(`../pairs/${domain}/${suit}.js`)

// 這些字單獨重複沒有意義，比對前先濾掉
const STOP = /[的了就是在把先再也都不會要你我他們這那有沒很最一二三四五六七八九十個之與和及或]/g

function longestCommon(a, b) {
  let best = ''
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + best.length + 1; j <= a.length; j += 1) {
      const part = a.slice(i, j)
      if (b.includes(part)) best = part
      else break
    }
  }
  return best
}

// 刻意的對仗不算重講：「只寫怎麼分錢，沒寫怎麼分賠」「因為它好才選，不是因為它熟」。
// 這種句尾一定以否定或比較開頭，而且就是要和前一句用同樣的字才對得起來。
const CONTRAST = /^(不是|不像|不知道|沒寫|沒有|沒|非|比|而不是|而非)/
// 前一句就是在鋪陳的時候，句尾用同樣的字是在呼應，不是在重講。
const SETUP = /^(沒|不|非|如果|當初|趁|因為)/

const rows = sources.length > 0 ? COMBOS.filter((r) => sources.includes(r[0])) : COMBOS
const hits = []
rows.forEach((row) => {
  row[2].forEach((text, slot) => {
    const parts = text.split(/(?<=[，。：])/).filter(Boolean)
    if (parts.length < 2) return
    const tail = parts[parts.length - 1].replace(/[，。：]/g, '')
    const head = parts.slice(0, -1).join('')
    const common = longestCommon(tail.replace(STOP, ''), head.replace(STOP, ''))
    if (CONTRAST.test(tail)) return
    if (SETUP.test(parts[parts.length - 2].replace(/^[^，。：]*[，。：]/, '') || parts[parts.length - 2])) return
    if (common.length >= 3) {
      hits.push({ from: row[0], to: row[1], slot, common, tail, text })
    }
  })
})

hits.forEach((h) => console.log(`${h.from} ${h.to} ${h.slot}　重疊【${h.common}】　句尾：${h.tail}`))
console.log(`\n${rows.length} 列 / ${rows.length * 4} 句，句尾重講 ${hits.length} 句`)
