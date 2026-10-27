const mongoose = require('mongoose')

const ORIENTATIONS = ['upright', 'reversed']
const MANUAL_MAX_CARDS = 10
const SUIT_ORDER = { wands: 0, cups: 1, swords: 2, pentacles: 3 }

// 大牌依編號、小牌依花色再依編號，供前端分組顯示
function compareCards(a, b) {
  if (a.arcanaType !== b.arcanaType) {
    return a.arcanaType === 'major' ? -1 : 1
  }
  if (a.arcanaType === 'minor' && a.suit !== b.suit) {
    return (SUIT_ORDER[a.suit] ?? 99) - (SUIT_ORDER[b.suit] ?? 99)
  }
  return a.number - b.number
}

// 驗證手動選牌送來的 cards，回傳 { error } 或 { drawn }
function validateManualCards(raw) {
  const drawn = Array.isArray(raw) ? raw : []
  if (drawn.length < 1 || drawn.length > MANUAL_MAX_CARDS) {
    return { error: `請選擇 1 到 ${MANUAL_MAX_CARDS} 張牌。` }
  }
  const ids = new Set()
  for (const item of drawn) {
    if (!mongoose.isValidObjectId(item?.id) || !ORIENTATIONS.includes(item?.orientation)) {
      return { error: '牌卡資料格式不正確。' }
    }
    if (ids.has(String(item.id))) {
      return { error: '同一張牌不可重複選取。' }
    }
    ids.add(String(item.id))
  }
  return { drawn }
}

const { SELECTABLE_DOMAINS } = require('../data/ruleConfig')

const QUESTION_MAX_LENGTH = 500
const POSITION_LABEL_MAX = 20
const POSITION_PROMPT_MAX = 120

// 問題是使用者輸入，長度要擋；回傳 { error } 或 { question }
function validateQuestion(raw) {
  const question = typeof raw === 'string' ? raw.trim() : ''
  if (question.length > QUESTION_MAX_LENGTH) {
    return { error: `問題長度不可超過 ${QUESTION_MAX_LENGTH} 字。` }
  }
  return { question }
}

// 問題類型為選填；未指定時回傳 null，由規則引擎走關鍵詞比對
function resolveDomain(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { domain: null }
  }
  if (typeof raw !== 'string' || !SELECTABLE_DOMAINS.includes(raw)) {
    return { error: '問題類型不正確。' }
  }
  return { domain: raw }
}

// 不指定牌陣時，使用者可以自己為每個位置命名與寫含意。
// 組成一個臨時牌陣物件，後面的流程（位置權重、敘述、AI 提示）就能照常使用位置資訊。
// 沒有 relations，牌對會退回相鄰配對。
function resolveCustomSpread(raw, cardCount) {
  if (raw === undefined || raw === null) {
    return { spread: null }
  }
  if (!Array.isArray(raw) || raw.length !== cardCount) {
    return { error: `自訂位置需要 ${cardCount} 筆，與牌數一致。` }
  }

  const positions = []
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index] || {}
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : ''
    if (!label) {
      return { error: `第 ${index + 1} 個位置還沒命名。` }
    }
    if (label.length > POSITION_LABEL_MAX) {
      return { error: `位置名稱不可超過 ${POSITION_LABEL_MAX} 字。` }
    }
    if (prompt.length > POSITION_PROMPT_MAX) {
      return { error: `位置說明不可超過 ${POSITION_PROMPT_MAX} 字。` }
    }
    positions.push({ key: `custom-${index + 1}`, label, prompt: prompt || label })
  }

  return {
    spread: {
      key: 'custom',
      name: '自訂牌陣',
      description: `由提問者自行定義的 ${cardCount} 個位置。`,
      cardCount,
      positions,
      relations: null,
    },
  }
}

module.exports = {
  MANUAL_MAX_CARDS,
  QUESTION_MAX_LENGTH,
  POSITION_LABEL_MAX,
  POSITION_PROMPT_MAX,
  compareCards,
  validateQuestion,
  validateManualCards,
  resolveDomain,
  resolveCustomSpread,
}
