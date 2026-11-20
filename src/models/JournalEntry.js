// 占卜日記（v26 計畫 2）：寫在一筆塔羅紀錄或一天的每日一牌底下，記錄這件事後來的發展。
// 一個對象可以寫很多篇，依日期排成時間軸。獨立一個 collection，不塞進 Reading（紀錄文件不會越長越大）。
// 內容只有本人看得到：不送給 AI、不放進分享卡片、不出現在公開頁面
const mongoose = require('mongoose')

// stock：一檔股票一本（v26 計畫 2-2），targetId 是股票鍵 <市場>:<代號>（tw:0050、us:NVDA）。
//   2026-11-20 第一版是「每筆分析一本」（targetId＝分析的 _id），啟動時由 services/stockJournal.js 轉成股票鍵。
// daily（每日一牌）2026-11-20 使用者決定拿掉：API 不再接受，enum 留著讓舊資料讀得出來
const TARGET_KINDS = ['reading', 'daily', 'stock']
const { STOCK_ACTIONS, QUANTITY_UNITS } = require('../services/stockJournal')

// 股票日記每篇可選填的「記錄股票」欄位（D8）：只是紀錄，不會改股市追蹤的持股
const stockRecordSchema = new mongoose.Schema(
  {
    action: { type: String, enum: [...STOCK_ACTIONS, null], default: null },
    price: { type: Number, default: null },
    quantity: { type: Number, default: null },
    unit: { type: String, enum: [...QUANTITY_UNITS, null], default: null },
    // 寫的時候的股價（開日記時帶入的最新收盤價），之後拿來比「寫的時候 vs 現在」
    quoteAtWrite: { type: Number, default: null },
    quoteDate: { type: String, default: null },
    targetPrice: { type: Number, default: null },
    stopPrice: { type: Number, default: null },
  },
  { _id: false },
)
// 結果標記：應驗了／部分應驗／沒有應驗；null＝還不知道（之後拿來統計準不準）
const OUTCOMES = ['hit', 'partial', 'miss']
const TITLE_MAX = 100

const journalEntrySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 寫在什麼底下：reading＝塔羅紀錄（id 是紀錄的 _id）；daily＝每日一牌（id 是那天的日期 YYYY-MM-DD，每人每天只有一張）
    targetKind: { type: String, enum: TARGET_KINDS, required: true },
    targetId: { type: String, required: true },
    // 標題（2026-11-20 使用者要求；列表預覽顯示標題＋內文第一行），可以空白
    title: { type: String, default: '', maxlength: TITLE_MAX },
    // Tiptap 的 JSON（存之前在 services/journalContent.js 驗證節點白名單與大小）
    content: { type: mongoose.Schema.Types.Mixed, required: true },
    // 純文字摘要，給清單與月曆顯示
    text: { type: String, default: '' },
    outcome: { type: String, enum: [...OUTCOMES, null], default: null },
    // 這篇記的是哪一天（台北時間 YYYY-MM-DD），預設寫的當天，可以補記以前的
    entryDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    // 只有股票日記用；沒填是 null
    stock: { type: stockRecordSchema, default: null },
  },
  { timestamps: true },
)

journalEntrySchema.index({ user: 1, targetKind: 1, targetId: 1, entryDate: 1 })
// 月曆：這個月每天寫了哪些
journalEntrySchema.index({ user: 1, entryDate: 1 })

module.exports = mongoose.model('JournalEntry', journalEntrySchema)
module.exports.TARGET_KINDS = TARGET_KINDS
module.exports.OUTCOMES = OUTCOMES
module.exports.TITLE_MAX = TITLE_MAX
