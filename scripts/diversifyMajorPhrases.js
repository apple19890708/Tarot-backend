// 讓大牌逆位的說法不要一句講到底（v8 B4）。
//
// 用法：
//   node scripts/diversifyMajorPhrases.js --dry   預覽
//   node scripts/diversifyMajorPhrases.js         寫回檔案
//
// 問題：某些大牌逆位在同一個領域裡，56～77 組有五成以上開頭是同一句。
// 最糟的是工作領域的愚人逆位，56 組裡 53 組都是「不敢動」。
//
// 重點不是換同義詞，是寫出這張牌逆位的**不同面向**。
// 例如愚人逆位在工作上可以是不敢動、也可以是沒準備就衝、也可以是想太多錯過時機，
// 這三種是同一張牌的不同臉，不是同一句話的三種寫法。

const fs = require('fs')
const path = require('path')

// 每組：主導說法 → 要輪替的面向（含原句，排在第一個）
const VARIANTS = {
  work: {
    愚人: ['不敢動', '沒準備好就衝', '想太久錯過了時機', '把冒險當成了莽撞'],
    女皇: ['資源不足', '付出沒被接住', '把人照顧到自己空了', '想做好卻使不上力'],
    力量: ['撐不住', '靠硬撐在維持', '耐性先耗完了', '用力的方式不對'],
    命運之輪: ['時機未到', '循環還沒轉過來', '機會錯身而過', '外在條件還沒鬆動'],
    吊人: ['卡住了', '等太久變成拖延', '該換角度卻沒換', '犧牲了卻沒換到什麼'],
    星星: ['沒有目標', '對前景失去信心', '方向看得見卻走不到', '期待落空了一次'],
    月亮: ['疑慮散去', '該知道的沒讓你知道', '憑感覺做了判斷', '看似清楚其實還有盲點'],
  },
  money: {
    愚人: ['不敢動', '沒做功課就進場', '猶豫太久錯過價位', '把投機當成投資'],
    戀人: ['沒共識', '合夥的條件沒談攏', '選了不該選的那個', '感情用事做了決定'],
    力量: ['撐不住', '靠硬撐在周轉', '耐性先用完了', '用力的方向不對'],
    隱士: ['沒做功課', '一個人悶著算', '該問人卻沒問', '研究太久沒出手'],
    命運之輪: ['時機未到', '循環還沒轉過來', '機會錯身而過', '大環境還沒鬆動'],
    正義: ['帳沒算清', '責任歸屬還沒劃開', '帳面漂亮但不實在', '少算了看不見的成本'],
    吊人: ['卡住了', '資金被綁住動不了', '等太久變成拖延', '該停損卻捨不得'],
    節制: ['比例失衡', '配置偏了一邊', '節制不下來', '分批的節奏亂了'],
  },
  love: {
    愚人: ['不敢動', '沒準備好就投入', '猶豫太久錯過了', '把衝動當成了心動'],
    女皇: ['溫度不夠', '付出沒被接住', '照顧到自己空了', '想對他好卻使不上力'],
    命運之輪: ['時機未到', '緣分還沒轉過來', '錯過了那個時機', '彼此的節奏對不上'],
    塔: ['危機還撐著', '表面沒事底下在裂', '該攤開的還壓著', '延後的衝擊遲早要來'],
    月亮: ['疑慮散去', '有話沒說出口', '憑想像在猜對方', '看似明朗其實還有盲點'],
  },
  social: {
    女皇: ['熱度不夠', '付出沒被接住', '照顧到自己空了', '想對人好卻使不上力'],
    命運之輪: ['時機未到', '緣分還沒轉過來', '錯過了那個場合', '彼此的節奏對不上'],
    塔: ['危機還撐著', '表面沒事底下在裂', '該攤開的還壓著', '延後的衝突遲早要來'],
    月亮: ['疑慮散去', '有話沒說開', '憑猜測在判斷別人', '看似融洽其實還有盲點'],
  },
  study: {
    命運之輪: ['時機未到', '循環還沒轉過來', '錯過了那個節點', '外在條件還沒配合'],
  },
}

// 只換開頭那一段（到第一個全形逗號為止），後面的內容不動
function rewrite(source, card, variants) {
  const [origin, ...rest] = variants
  let turn = 0
  let changed = 0

  const pattern = new RegExp(`(\\['${card}', '[^']+', \\[[^\\]]*?')${origin}，`, 'g')
  const next = source.replace(pattern, (whole, head) => {
    // 第一個仍用原句，之後輪替，保留原句的比重但不再一面倒
    turn += 1
    if (turn % (rest.length + 1) === 1) {
      return whole
    }
    changed += 1
    return `${head}${rest[(turn - 1) % rest.length]}，`
  })

  return { next, changed }
}

function main() {
  const dry = process.argv.includes('--dry')
  let total = 0

  for (const [domain, cards] of Object.entries(VARIANTS)) {
    const dir = path.join(__dirname, 'pairs', domain)
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js') && !name.startsWith('cross-'))
    let domainChanged = 0

    for (const name of files) {
      const file = path.join(dir, name)
      let text = fs.readFileSync(file, 'utf8')

      for (const [card, variants] of Object.entries(cards)) {
        const { next, changed } = rewrite(text, card, variants)
        text = next
        domainChanged += changed
      }

      if (!dry) {
        fs.writeFileSync(file, text, 'utf8')
      }
    }

    console.log(`${domain.padEnd(8)} 替換 ${domainChanged} 處`)
    total += domainChanged
  }

  console.log(`合計 ${total} 處${dry ? '（預覽，未寫檔）' : ''}`)
}

main()
