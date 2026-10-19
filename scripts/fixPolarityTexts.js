// 改寫「兩張牌本質都負面、逆逆卻被寫成最慘」的條目（v9 P3）。
//
// 用法：
//   node scripts/fixPolarityTexts.js work --dry   只看會改成什麼
//   node scripts/fixPolarityTexts.js work         實際寫回檔案
//
// 道理：逆位是「那股能量沒有全力展開」。本質負面的牌逆位，等於那份壞沒有全開，
// 相對是鬆一口氣。所以兩張負面牌的逆逆格應該是四格裡最輕的，不是最慘的。
// 既有辭典一律寫成「既…也…，<最壞的收尾>」，是把逆位當成了扣分。

const fs = require('fs')
const path = require('path')

// 13 張本質負面的牌，各領域「逆位＝那股壞沒全開」的說法。
// 前句用於第一張牌，後句用於第二張，組成「A，B，<收尾>。」
const EASING = {
  work: {
    寶劍三: '傷口在癒合', 寶劍五: '內耗緩下來', 寶劍七: '不再想走捷徑', 寶劍八: '綁住你的鬆開了',
    寶劍九: '焦慮在退', 寶劍十: '最壞的已經過去', 聖杯五: '注意力轉回還有的',
    權杖五: '摩擦淡下來', 權杖十: '擔子卸掉一些', 錢幣五: '緊的狀況在好轉',
    惡魔: '擺脫了綁住你的東西', 塔: '風波過去了', 月亮: '疑慮解開了',
  },
  money: {
    寶劍三: '帳面的痛在過去', 寶劍五: '為錢的爭執收場', 寶劍七: '不再想取巧', 寶劍八: '被錢綁住的感覺鬆了',
    寶劍九: '為錢的焦慮在退', 寶劍十: '最壞的已經認列完', 聖杯五: '注意力轉回還留著的',
    權杖五: '搶資源的狀況緩了', 權杖十: '負擔卸掉一些', 錢幣五: '手頭緊的狀況在好轉',
    惡魔: '擺脫了套牢你的東西', 塔: '風波過去了', 月亮: '不透明的部分清楚了',
  },
  love: {
    寶劍三: '心痛在淡', 寶劍五: '爭執收場', 寶劍七: '不再瞞著對方', 寶劍八: '被關係綁住的感覺鬆了',
    寶劍九: '焦慮在退', 寶劍十: '最壞的已經過去', 聖杯五: '注意力轉回身邊的人',
    權杖五: '爭吵緩下來', 權杖十: '這段的負擔輕了', 錢幣五: '疏離的感覺在好轉',
    惡魔: '擺脫了糾纏', 塔: '風波過去了', 月亮: '誤會解開了',
  },
  social: {
    寶劍三: '被刺傷的感覺在淡', 寶劍五: '爭執收場', 寶劍七: '不再藏話', 寶劍八: '被人際綁住的感覺鬆了',
    寶劍九: '焦慮在退', 寶劍十: '最壞的已經過去', 聖杯五: '注意力轉回還在的人',
    權杖五: '摩擦緩下來', 權杖十: '應酬的負擔輕了', 錢幣五: '被冷落的狀況在好轉',
    惡魔: '擺脫了糾纏', 塔: '風波過去了', 月亮: '誤會解開了',
  },
  study: {
    寶劍三: '打擊在過去', 寶劍五: '好勝的心緩下來', 寶劍七: '不再取巧', 寶劍八: '困住你的鬆開了',
    寶劍九: '焦慮在退', 寶劍十: '最壞的已經過去', 聖杯五: '注意力轉回還能補的',
    權杖五: '競爭的壓力緩了', 權杖十: '科目的負擔輕了', 錢幣五: '吃力的狀況在好轉',
    惡魔: '擺脫了壞習慣', 塔: '計畫的衝擊過去了', 月亮: '方向清楚了一些',
  },
}

// 收尾輪替，避免幾十句長得一模一樣
const TAILS = [
  '最難的那段過去了',
  '壓力都在鬆開',
  '雖然還沒好全，方向是對的',
  '這時候適合重新整理',
  '先把力氣養回來',
]

// 收尾不能和前兩句用到同樣的字，否則會出現
// 「最壞的已經過去，傷口在癒合，最難的那段過去了」這種同字重複
const TAIL_KEYWORDS = ['過去', '鬆開', '方向', '整理', '力氣']

function pickTail(head, order) {
  for (let i = 0; i < TAILS.length; i += 1) {
    const index = (order + i) % TAILS.length
    if (!head.includes(TAIL_KEYWORDS[index])) {
      return TAILS[index]
    }
  }
  return TAILS[order % TAILS.length]
}

function newText(domain, from, to, order) {
  const table = EASING[domain]
  const a = table[from]
  const b = table[to]
  if (!a || !b) {
    return null
  }
  const head = `${a}，${b}`
  return `${head}，${pickTail(head, order)}。`
}

// 把某一組牌對的第 4 段文字換掉。條目可能跨多行，所以用括號配對而不是逐行比對。
function replaceFourth(source, from, to, replacement) {
  const head = `['${from}', '${to}', [`
  const start = source.indexOf(head)
  if (start === -1) {
    return null
  }
  const open = start + head.length - 1
  let depth = 0
  let end = -1
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '[') depth += 1
    else if (source[i] === ']') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) {
    return null
  }

  const body = source.slice(open + 1, end)
  // 取最後一個字串常值
  const lastQuote = body.lastIndexOf("'")
  const firstQuote = body.lastIndexOf("'", lastQuote - 1)
  if (lastQuote === -1 || firstQuote === -1) {
    return null
  }

  return source.slice(0, open + 1) + body.slice(0, firstQuote + 1) + replacement + body.slice(lastQuote) + source.slice(end)
}

async function main() {
  const args = process.argv.slice(2)
  const dry = args.includes('--dry')
  const domain = args.find((arg) => !arg.startsWith('--'))
  if (!domain || !EASING[domain]) {
    console.error('請指定領域：work / money / love / social / study')
    process.exit(1)
  }

  const listPath = path.join(__dirname, '..', `${domain}.tmp.json`)
  const targets = JSON.parse(fs.readFileSync(listPath, 'utf8'))

  const dir = path.join(__dirname, 'pairs', domain)
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js') && !name.startsWith('cross-'))
  const contents = Object.fromEntries(files.map((name) => [name, fs.readFileSync(path.join(dir, name), 'utf8')]))

  let done = 0
  let failed = 0

  targets.forEach((target, order) => {
    const text = newText(domain, target.f, target.t, order)
    if (!text) {
      console.error(`  ✗ 短語表缺少 ${target.f} 或 ${target.t}`)
      failed += 1
      return
    }

    const file = files.find((name) => contents[name].includes(`['${target.f}', '${target.t}', [`))
    if (!file) {
      console.error(`  ✗ 找不到條目 ${target.f}→${target.t}`)
      failed += 1
      return
    }

    const next = replaceFourth(contents[file], target.f, target.t, text)
    if (!next) {
      console.error(`  ✗ 無法改寫 ${target.f}→${target.t}`)
      failed += 1
      return
    }
    contents[file] = next
    done += 1
    if (dry && done <= 8) {
      console.log(`  ${target.f}→${target.t}`)
      console.log(`    舊：${target.cur}`)
      console.log(`    新：${text}`)
    }
  })

  if (!dry) {
    Object.entries(contents).forEach(([name, text]) => fs.writeFileSync(path.join(dir, name), text, 'utf8'))
  }

  console.log(`${domain}：改寫 ${done} 筆${failed ? `，失敗 ${failed} 筆` : ''}${dry ? '（預覽，未寫檔）' : ''}`)
}

main()
