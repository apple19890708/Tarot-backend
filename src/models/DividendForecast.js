const mongoose = require('mongoose')

// 股利預估的紀錄（v20，2026-11-10 使用者要求「正式公布後比較預估準不準」）：每檔每月一筆，全站共用
// （推估只看股票自己的配息歷史，和是誰在看無關）。
// firstEstimate：第一次推估；lastEstimate：官方公布前最後一次推估（actual 有值後就不再更新）；actual：公告或實際除息的數字
const pointSchema = new mongoose.Schema(
  {
    perShare: { type: Number, required: true },
    // 除息日（推估的是推的日期，可能是 null）
    date: { type: String, default: null },
    at: { type: Date, required: true },
    // actual 才有：announced（證交所預告／Yahoo 已列出）、exDone（已除息）或 decided（董事會決議，date 是決議日）
    source: { type: String, default: null },
    // 推估才有：算法（latest＝最近一次配息，2026-11-11 起）；沒有的是舊算法（近 12 個月平均），讀取時重算（forecastLog.estimateOf）
    method: { type: String, default: null },
  },
  { _id: false },
)

const dividendForecastSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true },
    code: { type: String, default: null },
    market: { type: String, enum: ['tw', 'us'], required: true },
    // YYYY-MM（除息月）
    month: { type: String, required: true },
    firstEstimate: { type: pointSchema, default: null },
    lastEstimate: { type: pointSchema, default: null },
    actual: { type: pointSchema, default: null },
  },
  { timestamps: true },
)

dividendForecastSchema.index({ symbol: 1, month: 1 }, { unique: true })

module.exports = mongoose.model('DividendForecast', dividendForecastSchema)
