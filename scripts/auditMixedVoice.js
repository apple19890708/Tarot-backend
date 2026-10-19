// 檢查大牌 × 小牌（大小混）段落的「造樣造句」程度（唯讀原始檔，不連資料庫，不呼叫 AI）。
//
// 用法：
//   node scripts/auditMixedVoice.js            五個領域全掃
//   node scripts/auditMixedVoice.js love       只看感情
//   node scripts/auditMixedVoice.js love cups  只看感情的聖杯檔
//
// 驗收標準（沿用 v11 大×大 那一套）：
//   1. 同一張來源牌的句子，開頭不得重複
//      （大牌當來源：56 張小牌 × 4 ＝ 224 句；小牌當來源：22 張大牌 × 4 ＝ 88 句）
//   2. 同一個領域的大小混範圍內，不得有一模一樣的句子
//   3. 不得再出現「既…也…」這個舊模具
//   4. 不得殘留外文
//   5. 句型不得單調：分句數要散開、不能一路「，也／，卻／，又／，好在」、
//      結尾祈使句不得大量重複（光看開頭不重複是不夠的）
const DOMAINS = ['love', 'work', 'money', 'social', 'study']
const SUITS = ['wands', 'cups', 'swords', 'pentacles']
const MAJORS = [
  '愚人', '魔術師', '女祭司', '女皇', '皇帝', '教皇', '戀人', '戰車', '力量', '隱士', '命運之輪',
  '正義', '吊人', '死神', '節制', '惡魔', '塔', '星星', '月亮', '太陽', '審判', '世界',
]
const FOREIGN = /[A-Za-z\uAC00-\uD7A3\u3131-\u318E]/

// 我自己最愛用的幾個轉折詞，用來抓「換了模具還是同一個模具」
const CONNECTIVES = ['也', '卻', '又', '好在', '倒是']

const isMajor = (name) => MAJORS.includes(name)
// 大小混＝兩端剛好一張大牌一張小牌
const isMixed = (row) => isMajor(row[0]) !== isMajor(row[1])

function collect(domain, suitFilter) {
  const rows = []
  for (const suit of SUITS) {
    if (suitFilter && suit !== suitFilter) continue
    let COMBOS
    try {
      ;({ COMBOS } = require(`./pairs/${domain}/${suit}.js`))
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') continue
      throw error
    }
    COMBOS.filter(isMixed).forEach((row) => rows.push(row))
  }
  return rows
}

function auditDomain(domain, suitFilter) {
  const rows = collect(domain, suitFilter)
  if (rows.length === 0) {
    console.log(`\n=== ${domain} ===\n  （尚未建立）`)
    return
  }

  const all = rows.flatMap((row) => row[2])
  const sources = [...new Set(rows.map((row) => row[0]))]

  // 1. 同一張來源牌的開頭重複
  const bad = []
  sources.forEach((source) => {
    const texts = rows.filter((row) => row[0] === source).flatMap((row) => row[2])
    const heads = {}
    texts.forEach((text) => {
      const head = text.split(/[，。]/)[0]
      heads[head] = (heads[head] || 0) + 1
    })
    const dup = Object.entries(heads).filter(([, count]) => count > 1)
    if (dup.length > 0) {
      const detail = dup
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([head, count]) => `${head}×${count}`)
        .join('、')
      bad.push(`${source}（${texts.length} 句）：${detail}${dup.length > 6 ? ` …共 ${dup.length} 種` : ''}`)
    }
  })

  // 2. 整句重複
  const sentences = {}
  all.forEach((text) => {
    sentences[text] = (sentences[text] || 0) + 1
  })
  const repeated = Object.entries(sentences).filter(([, count]) => count > 1)

  // 3 / 4
  const oldMould = all.filter((text) => /既[^，]*也/.test(text))
  const foreign = all.filter((text) => FOREIGN.test(text))

  // 5. 句型單調度
  const segments = {}
  all.forEach((text) => {
    const n = text.split(/[，。]/).filter(Boolean).length
    segments[n] = (segments[n] || 0) + 1
  })
  const topSeg = Object.entries(segments).sort((a, b) => b[1] - a[1])[0]
  const connective = all.filter((text) => CONNECTIVES.some((word) => text.includes(`，${word}`)))
  const tails = {}
  all.forEach((text) => {
    const parts = text.split('。').filter(Boolean)
    const tail = parts[parts.length - 1]
    tails[tail] = (tails[tail] || 0) + 1
  })
  const topTails = Object.entries(tails).sort((a, b) => b[1] - a[1])

  // 6. 深度：v11 的標準是每句 60–100 字，低於 55 字通常就退回「兩張牌義並排」的淺寫法
  const lengths = all.map((text) => text.length)
  const average = Math.round(lengths.reduce((sum, n) => sum + n, 0) / lengths.length)
  const tooShort = lengths.filter((n) => n < 55).length

  const pct = (n) => `${Math.round((n * 100) / all.length)}%`

  const scope = suitFilter ? `${domain}／${suitFilter}` : domain
  console.log(`\n=== ${scope}（${rows.length} 組、${all.length} 句）===`)
  console.log(`  整句重複：${repeated.length}`)
  console.log(`  仍用「既…也…」：${oldMould.length}`)
  console.log(`  外文殘留：${foreign.length}`)
  console.log(`  開頭有重複的來源牌：${bad.length} / ${sources.length}`)
  bad.slice(0, 12).forEach((line) => console.log(`    ${line}`))
  if (bad.length > 12) console.log(`    …另有 ${bad.length - 12} 張`)
  repeated.slice(0, 5).forEach(([text, count]) => console.log(`    整句 ×${count}：${text}`))
  console.log(`  句型：最常見的 ${topSeg[0]} 分句佔 ${pct(topSeg[1])}；用「，也／，卻／，又／，好在／，倒是」的佔 ${pct(connective.length)}`)
  console.log(`  深度：平均 ${average} 字，不足 55 字的有 ${tooShort} 句（${pct(tooShort)}）`)
  console.log(`  結尾短語：${Object.keys(tails).length} 種／${all.length} 句，最常見 ${topTails
    .slice(0, 5)
    .map(([tail, count]) => `${tail}×${count}`)
    .join('、')}`)
}

const [target, suit] = process.argv.slice(2)
;(target ? [target] : DOMAINS).forEach((domain) => auditDomain(domain, suit))
