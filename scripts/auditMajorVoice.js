// 檢查大牌 × 大牌段落的「造樣造句」程度（唯讀原始檔，不連資料庫，不呼叫 AI）。
//
// 用法：
//   node scripts/auditMajorVoice.js            五個領域全掃
//   node scripts/auditMajorVoice.js love       只看感情
//
// 驗收標準（v11）：
//   1. 同一張來源牌的 84 句，開頭不得重複
//   2. 整個領域內不得有一模一樣的句子
//   3. 不得再出現「既…也…」這個舊模具
const DOMAINS = ['love', 'work', 'money', 'social', 'study']

function auditDomain(domain) {
  let COMBOS
  try {
    ;({ COMBOS } = require(`./pairs/${domain}/major.js`))
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      console.log(`\n=== ${domain} ===\n  （尚未建立）`)
      return
    }
    throw error
  }

  const sources = [...new Set(COMBOS.map((row) => row[0]))]
  const all = COMBOS.flatMap((row) => row[2])

  const bad = []
  sources.forEach((source) => {
    const texts = COMBOS.filter((row) => row[0] === source).flatMap((row) => row[2])
    const heads = {}
    texts.forEach((text) => {
      const head = text.split(/[，。]/)[0]
      heads[head] = (heads[head] || 0) + 1
    })
    const dup = Object.entries(heads).filter(([, count]) => count > 1)
    if (dup.length > 0) {
      bad.push(`${source}：開頭重複 ${dup.map(([head, count]) => `${head}×${count}`).join('、')}`)
    }
  })

  const sentences = {}
  all.forEach((text) => {
    sentences[text] = (sentences[text] || 0) + 1
  })
  const repeated = Object.entries(sentences).filter(([, count]) => count > 1)
  const oldMould = all.filter((text) => /既[^，]*也/.test(text))

  console.log(`\n=== ${domain}（${sources.length} 張來源牌、${all.length} 句）===`)
  console.log(`  整句重複：${repeated.length}`)
  console.log(`  仍用「既…也…」：${oldMould.length}`)
  console.log(`  開頭有重複的來源牌：${bad.length} / ${sources.length}`)
  bad.forEach((line) => console.log(`    ${line}`))
  repeated.slice(0, 5).forEach(([text, count]) => console.log(`    整句 ×${count}：${text}`))
}

const target = process.argv[2]
;(target ? [target] : DOMAINS).forEach(auditDomain)
