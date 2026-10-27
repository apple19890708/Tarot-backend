const Card = require('../models/Card')

// 依指定順序把 drawn（{ id, orientation }）對應回資料庫的牌，回傳 { error } 或 { cards }。
// 占卜、AI 解讀、歷史紀錄重算都用這一份，避免各自寫一次順序對應。
async function loadCardsInOrder(drawn) {
  const found = await Card.find({ _id: { $in: drawn.map((item) => item.id) } }).lean()
  const byId = new Map(found.map((card) => [String(card._id), card]))
  const cards = drawn.map((item) => byId.get(String(item.id)))
  if (cards.some((card) => !card)) {
    return { error: '找不到部分牌卡。' }
  }
  return { cards }
}

module.exports = { loadCardsInOrder }
