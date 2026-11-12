const ReadingModel = require('../models/Reading')
const { MAX_READINGS_PER_USER } = ReadingModel

// 建立一筆占卜紀錄。只存重算需要的輸入，分析文字不存（見 models/Reading.js）。
// narration 是使用者按保存時手上已經產生好的 AI 解讀（可省略）。
// Reading 可以換掉，測試才不必連資料庫。
async function saveReading({
  userId,
  question,
  domain,
  spread,
  drawn,
  cards,
  narration = null,
  Reading = ReadingModel,
}) {
  const record = await Reading.create({
    user: userId,
    question: question || '',
    domain: domain || null,
    // 自訂牌陣（key 為 custom）不是真的牌陣，重算時要走 positions
    spreadKey: spread && spread.key !== 'custom' ? spread.key : null,
    spreadName: spread ? spread.name : '自選牌',
    positions:
      spread && spread.key === 'custom'
        ? spread.positions.map((position) => ({ label: position.label, prompt: position.prompt }))
        : undefined,
    cards: drawn.map((item, index) => ({
      cardId: item.id,
      orientation: item.orientation,
      nameZh: cards[index] ? cards[index].nameZh : '',
    })),
    narration,
  })

  await trimHistory(userId, Reading)

  return record
}

// 超過上限就從最舊的開始刪。用 _id 清單刪，避免 skip 期間有新資料插入導致誤刪。
// createdAt 只到毫秒，同一毫秒的多筆順序未定義，所以再用 _id 當第二個排序鍵。
async function trimHistory(userId, Reading = ReadingModel) {
  const total = await Reading.countDocuments({ user: userId })
  if (total <= MAX_READINGS_PER_USER) {
    return
  }

  const stale = await Reading.find({ user: userId })
    .sort({ createdAt: -1, _id: -1 })
    .skip(MAX_READINGS_PER_USER)
    .select('_id')
    .lean()

  if (stale.length > 0) {
    await Reading.deleteMany({ _id: { $in: stale.map((item) => item._id) }, user: userId })
  }
}

// 把紀錄還原成重算所需的參數；spreads 由呼叫端提供，這裡不碰資料來源
function toReadingInput(record, spreads) {
  const drawn = record.cards.map((card) => ({
    id: String(card.cardId),
    orientation: card.orientation,
  }))

  let spread = null
  if (record.spreadKey) {
    spread = spreads.find((item) => item.key === record.spreadKey) || null
    // 牌陣被改名或移除時，退回「沒有牌陣」而不是讓整筆紀錄打不開
    if (spread && spread.cardCount !== drawn.length) {
      spread = null
    }
  } else if (record.positions && record.positions.length === drawn.length) {
    spread = {
      key: 'custom',
      name: '自訂牌陣',
      description: `由提問者自行定義的 ${drawn.length} 個位置。`,
      cardCount: drawn.length,
      positions: record.positions.map((position, index) => ({
        key: `custom-${index + 1}`,
        label: position.label,
        prompt: position.prompt || position.label,
      })),
      relations: null,
    }
  }

  return { drawn, spread }
}

// 這段 AI 解讀講的是不是這筆紀錄的牌：張數、每張的牌與正逆位都要一樣。
// 存回解讀的兩條路（AI 寫完後端存回、前端補存 PUT）共用，否則紀錄會配上一段和畫面無關的文字
function isSameCards(recordCards, drawn) {
  return (
    Array.isArray(drawn) &&
    recordCards.length === drawn.length &&
    recordCards.every((card, index) => String(card.cardId) === String(drawn[index]?.id) && card.orientation === drawn[index]?.orientation)
  )
}

module.exports = { saveReading, trimHistory, toReadingInput, isSameCards }
