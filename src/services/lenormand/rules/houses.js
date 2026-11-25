// L7 宮位（大藍圖）：第 n 格就是第 n 宮，每張牌讀成「這張牌 × 該宮主題」（主題在 position.houseTheme，前端與 formatter 直接用）。
// 這裡只標出特別的：中心落在哪一宮、主題牌落在哪一宮，以及落在自己宮位的牌（第 n 張牌在第 n 宮，主題特別強）。
// 擴充牌（37～52）沒有自己的宮位，落在哪一宮就讀那一宮，不會出現在 own。
function analyzeHouses({ items, center, themeCard }) {
  return {
    center: { index: center.index, house: center.house },
    theme: themeCard && themeCard.present ? { index: themeCard.index, house: themeCard.house } : null,
    own: items.filter((item) => item.card.id === item.position.house).map((item) => ({ index: item.index, cardId: item.card.id })),
  }
}

module.exports = { analyzeHouses }
