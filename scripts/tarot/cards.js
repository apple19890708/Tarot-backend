// 塔羅 78 張牌的靜態清單（v28 原創牌面用，見 doc/v28-tarot-original-art-plan.md 3-1）。
// - key：檔名（不含副檔名），和 public/cards/*.jpg 一一對應，只換副檔名
// - 牌名照目前資料庫的寫法（愚人、隱士、塔、吊人、錢幣…，和 scripts/buildCuratedPairs.js 的對照表一致）
// 原始牌義文字檔不在每台電腦上，所以不從 tarotParser 讀，也不連資料庫。
const pad2 = (n) => String(n).padStart(2, '0')

const MAJORS = [
  ['fool', '愚人', 'The Fool'],
  ['magician', '魔術師', 'The Magician'],
  ['high-priestess', '女祭司', 'The High Priestess'],
  ['empress', '皇后', 'The Empress'],
  ['emperor', '皇帝', 'The Emperor'],
  ['hierophant', '教皇', 'The Hierophant'],
  ['lovers', '戀人', 'The Lovers'],
  ['chariot', '戰車', 'The Chariot'],
  ['strength', '力量', 'Strength'],
  ['hermit', '隱士', 'The Hermit'],
  ['wheel-of-fortune', '命運之輪', 'Wheel of Fortune'],
  ['justice', '正義', 'Justice'],
  ['hanged-man', '吊人', 'The Hanged Man'],
  ['death', '死神', 'Death'],
  ['temperance', '節制', 'Temperance'],
  ['devil', '惡魔', 'The Devil'],
  ['tower', '塔', 'The Tower'],
  ['star', '星星', 'The Star'],
  ['moon', '月亮', 'The Moon'],
  ['sun', '太陽', 'The Sun'],
  ['judgement', '審判', 'Judgement'],
  ['world', '世界', 'The World'],
]

const SUITS = [
  { suit: 'wands', zh: '權杖', en: 'Wands' },
  { suit: 'cups', zh: '聖杯', en: 'Cups' },
  { suit: 'swords', zh: '寶劍', en: 'Swords' },
  { suit: 'pentacles', zh: '錢幣', en: 'Pentacles' },
]

const RANK_ZH = ['王牌', '二', '三', '四', '五', '六', '七', '八', '九', '十', '侍者', '騎士', '皇后', '國王']
const RANK_EN = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Page', 'Knight', 'Queen', 'King']

const cards = [
  ...MAJORS.map(([slug, nameZh, nameEn], number) => ({
    key: `major-${pad2(number)}-${slug}`,
    arcanaType: 'major',
    suit: null,
    number,
    nameZh,
    nameEn,
  })),
  ...SUITS.flatMap(({ suit, zh, en }) =>
    RANK_ZH.map((rankZh, i) => ({
      key: `${suit}-${pad2(i + 1)}`,
      arcanaType: 'minor',
      suit,
      number: i + 1,
      nameZh: `${zh}${rankZh}`,
      nameEn: `${RANK_EN[i]} of ${en}`,
    })),
  ),
].map((card) => ({ ...card, image: `/cards/${card.key}.svg` }))

module.exports = { cards, SUITS }
