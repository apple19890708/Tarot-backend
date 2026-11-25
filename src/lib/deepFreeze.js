// 深度凍結靜態資料（雷諾曼的牌、牌陣、解說表）：路由直接回傳同一份物件，凍結後哪裡不小心改到會直接被擋下（strict mode 會丟錯）
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    Object.values(value).forEach(deepFreeze)
  }
  return value
}

module.exports = { deepFreeze }
