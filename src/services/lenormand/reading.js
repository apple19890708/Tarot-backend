// 雷諾曼抽牌：驗證輸入、洗牌、組回應（v27，回應形狀見 doc/v27-lenormand-plan.md 3-12）。
// 分析一律由後端依牌號重算，不使用前端傳來的分析。回應不存檔（保存是階段 6）。
const crypto = require('crypto')

const { cards: ALL_CARDS, cardById } = require('../../data/lenormand/cards')
const { spreadByKey } = require('../../data/lenormand/spreads')
const { LENORMAND_DOMAINS } = require('../../data/lenormand/ruleConfig')
const { validateQuestion } = require('../manualDraw')
const { analyzeLenormand } = require('./engine')
const { formatLenormand } = require('./formatter')

const SIGNIFICATORS = [28, 29]
// 開放的牌陣（階段 5 起含大藍圖）
const OPEN_SPREADS = ['theme-3', 'theme-5', 'timeline-3', 'nine-box', 'grand-tableau']
const SPREAD_NOT_OPEN = '這個牌陣還沒開放。'

// Fisher–Yates 洗牌。rng(max) 回傳 0～max-1 的整數；預設 crypto.randomInt，測試可以注入固定結果
function shuffle(list, rng = crypto.randomInt) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng(i + 1)
    if (!Number.isInteger(j) || j < 0 || j > i) throw new Error('rng 必須回傳 0～max-1 的整數。')
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// required：一定要放入的牌（大藍圖的代表牌）。其餘從剩下的牌抽，required 的位置也隨機
function drawCardIds(count, rng = crypto.randomInt, required = null) {
  const pool = ALL_CARDS.map((card) => card.id).filter((id) => id !== required)
  if (!required) return shuffle(pool, rng).slice(0, count)
  const picked = shuffle(pool, rng).slice(0, count - 1)
  const at = rng(count)
  if (!Number.isInteger(at) || at < 0 || at >= count) throw new Error('rng 必須回傳 0～max-1 的整數。')
  picked.splice(at, 0, required)
  return picked
}

// 共同的欄位驗證：回傳 { error } 或 { spread, question, domain, significator }
function validateCommon(body) {
  const spread = typeof body.spreadKey === 'string' ? spreadByKey.get(body.spreadKey) : null
  if (!spread) return { error: '找不到指定牌陣。' }
  if (!OPEN_SPREADS.includes(spread.key)) return { error: SPREAD_NOT_OPEN }

  const { question, error: questionError } = validateQuestion(body.question)
  if (questionError) return { error: questionError }

  let domain = null
  if (body.domain !== undefined && body.domain !== null && body.domain !== '') {
    if (typeof body.domain !== 'string' || !Object.hasOwn(LENORMAND_DOMAINS, body.domain)) return { error: '問題類型不正確。' }
    domain = body.domain
  }

  let significator = null
  if (body.significator !== undefined && body.significator !== null) {
    if (!SIGNIFICATORS.includes(body.significator)) return { error: '代表牌只能是紳士（28）或淑女（29）。' }
    significator = body.significator
  }
  if (spread.requiresSignificator && !significator) return { error: '這個牌陣需要選擇代表牌。' }

  return { spread, question, domain, significator }
}

// 手動（扇形、輸入實體牌）的牌號：1～52 的整數、不重複、張數等於牌陣張數
function validateCardIds(raw, spread) {
  if (!Array.isArray(raw) || raw.length !== spread.cardCount) return { error: `請選擇 ${spread.cardCount} 張牌。` }
  const seen = new Set()
  for (const id of raw) {
    if (!Number.isInteger(id) || !cardById.has(id)) return { error: '牌號必須是 1 到 52 的整數。' }
    if (seen.has(id)) return { error: '同一張牌不可重複選取。' }
    seen.add(id)
  }
  return { cardIds: raw }
}

// 回應裡每張牌的精簡欄位（完整牌義由 GET /api/lenormand/cards 提供）
function cardJSON(card) {
  const { id, slug, nameZh, nameEn, image, keywords, tone, facing, playingCard, traditional } = card
  return { id, slug, nameZh, nameEn, image, keywords, tone, facing, playingCard, traditional }
}

/**
 * 組出 3-12 的回應。cardOf 可以注入（測試換掉 facing 等），預設查 cards.js
 */
function buildLenormandReading({ mode, spread, question, domain, significator, cardIds, cardOf = (id) => cardById.get(id) }) {
  const items = cardIds.map((id, index) => ({ index, card: cardOf(id), position: spread.positions[index] }))
  const analysis = analyzeLenormand({ items, spread, question, domain, significator })
  const { overview, guidance, text } = formatLenormand(analysis, items, spread)
  return {
    deck: 'lenormand',
    mode,
    question,
    spread: { key: spread.key, name: spread.name, description: spread.description, cardCount: spread.cardCount, grid: spread.grid },
    significator,
    overview,
    guidance,
    cards: items.map((item) => ({ index: item.index, position: item.position, card: cardJSON(item.card) })),
    analysis,
    text,
  }
}

module.exports = {
  shuffle,
  drawCardIds,
  validateCommon,
  validateCardIds,
  buildLenormandReading,
  OPEN_SPREADS,
  SIGNIFICATORS,
  SPREAD_NOT_OPEN,
}
