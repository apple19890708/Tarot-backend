// 股市總覽的版面（v19 計畫書）：使用者自己排的區塊與卡片，存在 MarketProfile.dashboard。
// 這裡只做驗證與整理，區塊怎麼畫由前端決定。不合格的整份擋下（回 error），不默默丟掉一部分
const { PICK_TYPES } = require('./dailyPicks')

const MAX_BLOCKS = 20
// 版面格式的版本：2（2026-11-08）起「推薦／熱門股票」預設放在自選清單上面；前端讀到 1 的會調整一次再存成 2
const DASHBOARD_VERSION = 2
const MAX_CARDS = 20

// 每種區塊認得的設定：
// - cards：卡片 id 的清單（增減與排序）。fixed 是固定的選項，只收這些；沒有 fixed 的收符合 CARD_ID 格式的 id
//   （重點卡會放大盤的指數代號與自己追蹤的個股，階段 2 再細分）
// - top：類股熱力圖只看漲跌最多的前幾個（null＝全部）
// - group：自選清單區塊要顯示哪個清單（自訂清單的 id；沒有＝第一個清單）
// - pickType：推薦類型（dailyPicks.PICK_TYPES）；自選清單沒有清單時顯示的推薦也用它
// - view：卡片或表格（card／table）
const BLOCKS = {
  highlights: { cards: { max: 8 } },
  macro: { cards: { fixed: ['cpi', 'coreCpi', 'pce', 'corePce', 'nfp'] } },
  breadth: { cards: { fixed: ['tse', 'otc'] } },
  sectors: { top: true },
  institutional: {},
  us: { cards: { max: MAX_CARDS } },
  // 第二批（階段 3）：使用者自己的資料
  watchGroup: { group: true, pickType: true, view: true },
  picks: { pickType: true, view: true },
  // 持股總覽、價位提醒 2026-11-08 拿掉（使用者決定）；前端讀到舊版面裡的會略過，存回來時就不會再有
  news: {},
}
const OBJECT_ID = /^[a-f0-9]{24}$/i
const BLOCK_TYPES = Object.keys(BLOCKS)
// 指數代號（^TWII、TWD=X、DX-Y.NYB）、自訂 id（txf-night、TPEX）、自己的個股（watch:<id>）
const CARD_ID = /^[\w^=.:-]{1,40}$/

function parseCards(raw, rule) {
  if (raw === undefined) return { cards: undefined }
  if (!Array.isArray(raw) || raw.length > MAX_CARDS) return { error: '卡片設定格式不正確。' }
  // 0 張不收：前端整塊（連同設定的筆）會消失、回不來；不想看整塊請隱藏區塊
  if (raw.length === 0) return { error: '每個區塊至少要留一張卡片；不想看可以把整個區塊隱藏。' }
  const cards = [...new Set(raw)]
  if (!cards.every((id) => typeof id === 'string' && CARD_ID.test(id))) return { error: '卡片設定格式不正確。' }
  if (rule.fixed && !cards.every((id) => rule.fixed.includes(id))) return { error: '卡片設定裡有不認得的項目。' }
  if (rule.max && cards.length > rule.max) return { error: `這個區塊最多放 ${rule.max} 張卡片。` }
  return { cards }
}

// raw：{ blocks: [{ type, visible, options }] }；null 代表恢復預設（不存版面）
function parseDashboard(raw) {
  if (raw === null) return { dashboard: null }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.blocks)) return { error: '版面設定格式不正確。' }
  if (raw.blocks.length > MAX_BLOCKS) return { error: `區塊最多 ${MAX_BLOCKS} 個。` }
  const seen = new Set()
  const blocks = []
  for (const block of raw.blocks) {
    if (!block || typeof block !== 'object' || !BLOCK_TYPES.includes(block.type)) return { error: '有不認得的區塊。' }
    if (seen.has(block.type)) return { error: '同一種區塊只能放一個。' }
    seen.add(block.type)
    const rule = BLOCKS[block.type]
    const rawOptions = block.options && typeof block.options === 'object' ? block.options : {}
    const options = {}
    if (rule.cards) {
      const { cards, error } = parseCards(rawOptions.cards, rule.cards)
      if (error) return { error }
      if (cards) options.cards = cards
    }
    if (rule.top && rawOptions.top !== undefined && rawOptions.top !== null) {
      if (!Number.isInteger(rawOptions.top) || rawOptions.top < 1 || rawOptions.top > 60) return { error: '熱力圖的數量要是 1～60。' }
      options.top = rawOptions.top
    }
    if (rule.group && rawOptions.group !== undefined && rawOptions.group !== null) {
      // 清單是不是自己的不在這裡查：前端找不到這個清單時改顯示第一個清單
      if (typeof rawOptions.group !== 'string' || !OBJECT_ID.test(rawOptions.group)) return { error: '清單設定格式不正確。' }
      options.group = rawOptions.group
    }
    if (rule.pickType && rawOptions.pickType !== undefined && rawOptions.pickType !== null) {
      if (!PICK_TYPES.includes(rawOptions.pickType)) return { error: '不認得的推薦類型。' }
      options.pickType = rawOptions.pickType
    }
    if (rule.view && rawOptions.view !== undefined && rawOptions.view !== null) {
      if (!['card', 'table'].includes(rawOptions.view)) return { error: '不認得的顯示方式。' }
      options.view = rawOptions.view
    }
    blocks.push({ type: block.type, visible: block.visible !== false, options })
  }
  return { dashboard: { version: DASHBOARD_VERSION, blocks } }
}

module.exports = { BLOCK_TYPES, MAX_BLOCKS, DASHBOARD_VERSION, parseDashboard }
