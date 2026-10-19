// money 領域的牌對解讀總表（人工撰寫，未使用 AI）。
// 實際內容依階段拆在 money/ 目錄下，這裡只負責合併。
const stages = [
  'major', 'swords', 'cups', 'wands', 'pentacles',
  // 跨花色小牌：依「來源牌的花色」分四檔，各 14 × 42 = 588 組
  'cross-wands', 'cross-cups', 'cross-swords', 'cross-pentacles',
]
  .map((name) => {
    try {
      return require(`./money/${name}.js`).COMBOS
    } catch (error) {
      if (error.code === 'MODULE_NOT_FOUND') {
        return [] // 這個階段還沒開始寫
      }
      throw error
    }
  })

const COMBOS = stages.flat()

module.exports = { COMBOS }
