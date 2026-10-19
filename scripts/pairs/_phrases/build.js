// 跨花色小牌牌對的組合器（人工撰寫短語，未使用 AI）。
//
// 既有辭典的條目本來就是「前句＋連接詞＋後句」的結構，例如：
//   正正 認識了實在的人，也還應付得過來。
//   逆正 沒認識什麼人，好在應付得過來。
// 這裡把同一套寫法抽出來，讓 56 張小牌 × 其他三花色 42 張共 2352 組能一致地產生。
//
// 重點：連接詞要看「語意正負」而不是「正逆位」。
// 寶劍五、聖杯五這類牌正位才是壞的，逆位反而是鬆一口氣，
// 若一律把逆位當負面，就會寫出「好在被排擠了」這種反話。

const SUITS = ['wands', 'cups', 'swords', 'pentacles']

const SUIT_CARDS = {
  wands: '權杖',
  cups: '聖杯',
  swords: '寶劍',
  pentacles: '錢幣',
}

const RANKS = ['王牌', '二', '三', '四', '五', '六', '七', '八', '九', '十', '侍者', '騎士', '皇后', '國王']

function cardName(suit, rankIndex) {
  return `${SUIT_CARDS[suit]}${RANKS[rankIndex]}`
}

/**
 * 依兩個短語的正負挑連接詞。
 *  好 + 好 → 「，」直接並列
 *  好 + 壞 → 「，但」
 *  壞 + 好 → 「，好在」
 *  壞 + 壞 → 「既…也…，<收尾>」用精簡形，避免兩個長句疊在一起
 */
function join(from, to, toTail) {
  if (from.good && to.good) {
    return `${from.text}，${to.text}。`
  }
  if (from.good && !to.good) {
    return `${from.text}，但${to.text}。`
  }
  if (!from.good && to.good) {
    return `${from.text}，好在${to.text}。`
  }
  return `既${from.short}也${to.short}，${toTail}。`
}

/**
 * @param table 該領域的短語表：{ [牌名]: { u, r, us, rs, tail, uBad?, rGood? } }
 *   u/r    正位／逆位的完整子句
 *   us/rs  正位／逆位的精簡形，只在「既…也…」時用到
 *   tail   這張牌當後句且兩邊都是負面時的收尾
 *   uBad   正位本身就是負面（五、寶劍三／八／九／十 這類）
 *   rGood  逆位反而是好的（負面牌翻過來通常如此）
 */
function sideOf(entry, orientation) {
  const upGood = !entry.uBad
  const revGood = Boolean(entry.rGood)

  return orientation === 'upright'
    ? { text: entry.u, short: entry.us, good: upGood }
    : { text: entry.r, short: entry.rs, good: revGood }
}

// 產生「from 花色 → 其他三個花色」的 14 × 42 = 588 組
function buildCross(fromSuit, table) {
  const combos = []

  for (let i = 0; i < RANKS.length; i += 1) {
    const fromName = cardName(fromSuit, i)
    const fromEntry = table[fromName]
    if (!fromEntry) {
      throw new Error(`短語表缺少 ${fromName}`)
    }

    for (const toSuit of SUITS) {
      if (toSuit === fromSuit) {
        continue
      }

      for (let j = 0; j < RANKS.length; j += 1) {
        const toName = cardName(toSuit, j)
        const toEntry = table[toName]
        if (!toEntry) {
          throw new Error(`短語表缺少 ${toName}`)
        }

        combos.push([
          fromName,
          toName,
          [
            join(sideOf(fromEntry, 'upright'), sideOf(toEntry, 'upright'), toEntry.tail),
            join(sideOf(fromEntry, 'upright'), sideOf(toEntry, 'reversed'), toEntry.tail),
            join(sideOf(fromEntry, 'reversed'), sideOf(toEntry, 'upright'), toEntry.tail),
            join(sideOf(fromEntry, 'reversed'), sideOf(toEntry, 'reversed'), toEntry.tail),
          ],
        ])
      }
    }
  }

  return combos
}

module.exports = { buildCross, SUITS, RANKS, cardName }
