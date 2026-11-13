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
  // 追問：[{ question, drawn, cards（資料庫文件） }]；followUpNarration：{ text, model, createdAt }
  followUps = [],
  followUpNarration = null,
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
    followUps: followUps.length > 0 ? followUps.map(toFollowUpRecord) : undefined,
    // 沒有追問就不會有延伸回答
    followUpNarration: followUps.length > 0 && followUpNarration ? { ...followUpNarration, rounds: followUps.length } : null,
  })

  await trimHistory(userId, Reading)

  return record
}

// 追問存進紀錄的樣子：問題、牌 id 與正逆位，加一份牌名快照
function toFollowUpRecord(followUp) {
  return {
    question: followUp.question,
    cards: followUp.drawn.map((item, index) => ({
      cardId: item.id,
      orientation: item.orientation,
      nameZh: followUp.cards?.[index]?.nameZh || '',
    })),
    createdAt: new Date(),
  }
}

const isSameRound = (stored, followUp) => stored.question === followUp.question && isSameCards(stored.cards, followUp.drawn)

// 紀錄裡的追問和送來的清單是什麼關係（api-reviewer 2026-11-13：整批取代時不能蓋掉較新的追問）：
// same＝完全相同；extended＝送來的是紀錄的延伸（多了新的追問）；
// behind＝送來的比紀錄少（紀錄已經有更新的追問，例如 AI 寫的途中又抽了一次）；different＝對不起來
function followUpRelation(recordFollowUps, followUps) {
  const stored = Array.isArray(recordFollowUps) ? recordFollowUps : []
  const shared = Math.min(stored.length, followUps.length)
  for (let index = 0; index < shared; index += 1) {
    if (!isSameRound(stored[index], followUps[index])) return 'different'
  }
  if (stored.length === followUps.length) return 'same'
  return stored.length < followUps.length ? 'extended' : 'behind'
}

// 整批取代時，同一位置、問題與牌都沒變的追問沿用原本的時間，不要每次同步都變成現在
function mergeFollowUpRecords(recordFollowUps, followUps) {
  const stored = Array.isArray(recordFollowUps) ? recordFollowUps : []
  return followUps.map((followUp, index) => {
    const record = toFollowUpRecord(followUp)
    const previous = stored[index]
    if (previous && previous.createdAt && isSameRound(previous, followUp)) record.createdAt = previous.createdAt
    return record
  })
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

module.exports = {
  saveReading,
  trimHistory,
  toReadingInput,
  isSameCards,
  toFollowUpRecord,
  followUpRelation,
  mergeFollowUpRecords,
}
