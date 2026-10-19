// 公共領域 Rider-Waite-Smith（1909）在 Wikimedia Commons 的檔名對應。
// 以牌的 number / arcanaType / suit 對應，不依賴資料庫的 nameEn 格式。
// 來源皆為 RWS 1909 原版掃描（公共領域）；商業重繪版不使用。

// 大牌：編號 → Wikimedia 檔名（力量 8、正義 11 採 RWS 標準）
const MAJOR_WIKI = {
  0: 'RWS_Tarot_00_Fool.jpg',
  1: 'RWS_Tarot_01_Magician.jpg',
  2: 'RWS_Tarot_02_High_Priestess.jpg',
  3: 'RWS_Tarot_03_Empress.jpg',
  4: 'RWS_Tarot_04_Emperor.jpg',
  5: 'RWS_Tarot_05_Hierophant.jpg',
  6: 'RWS_Tarot_06_Lovers.jpg',
  7: 'RWS_Tarot_07_Chariot.jpg',
  8: 'RWS_Tarot_08_Strength.jpg',
  9: 'RWS_Tarot_09_Hermit.jpg',
  10: 'RWS_Tarot_10_Wheel_of_Fortune.jpg',
  11: 'RWS_Tarot_11_Justice.jpg',
  12: 'RWS_Tarot_12_Hanged_Man.jpg',
  13: 'RWS_Tarot_13_Death.jpg',
  14: 'RWS_Tarot_14_Temperance.jpg',
  15: 'RWS_Tarot_15_Devil.jpg',
  16: 'RWS_Tarot_16_Tower.jpg',
  17: 'RWS_Tarot_17_Star.jpg',
  18: 'RWS_Tarot_18_Moon.jpg',
  19: 'RWS_Tarot_19_Sun.jpg',
  20: 'RWS_Tarot_20_Judgement.jpg',
  21: 'RWS_Tarot_21_World.jpg',
}

// 小牌：Wikimedia 以花色縮寫 + 兩位數編號（錢幣為 Pents）
const MINOR_WIKI_PREFIX = {
  wands: 'Wands',
  cups: 'Cups',
  swords: 'Swords',
  pentacles: 'Pents',
}

// 專案內的檔名（英文、可讀），存入 public/cards/
const MAJOR_SLUG = {
  0: 'fool', 1: 'magician', 2: 'high-priestess', 3: 'empress', 4: 'emperor',
  5: 'hierophant', 6: 'lovers', 7: 'chariot', 8: 'strength', 9: 'hermit',
  10: 'wheel-of-fortune', 11: 'justice', 12: 'hanged-man', 13: 'death', 14: 'temperance',
  15: 'devil', 16: 'tower', 17: 'star', 18: 'moon', 19: 'sun', 20: 'judgement', 21: 'world',
}

const pad2 = (n) => String(n).padStart(2, '0')

// 回傳 { wikiFile, localFile } 或 null（無法對應）
function resolveImageSource(card) {
  if (card.arcanaType === 'major') {
    const wikiFile = MAJOR_WIKI[card.number]
    const slug = MAJOR_SLUG[card.number]
    if (!wikiFile || !slug) {
      return null
    }
    return { wikiFile, localFile: `major-${pad2(card.number)}-${slug}.jpg` }
  }

  const prefix = MINOR_WIKI_PREFIX[card.suit]
  if (!prefix || card.number < 1 || card.number > 14) {
    return null
  }
  return {
    wikiFile: `${prefix}${pad2(card.number)}.jpg`,
    localFile: `${card.suit}-${pad2(card.number)}.jpg`,
  }
}

module.exports = {
  resolveImageSource,
}
