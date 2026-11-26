// AI 串流的共用流程（v29 項目 1、6、10，詳見 doc/v29-optimization-plan.md）。
// 塔羅解讀、塔羅追問、雷諾曼解讀、個股分析、財經新聞分析原本各寫一份，規則一樣的部分抽到這裡：
//   - 同一個人同時只能跑一個（createUserLock）：先上鎖再檢查次數，否則同時送很多個請求時全部都會通過檢查
//   - AI 開始產生（開始計費）才記一次用量；使用者自己中斷的照算、不退；伺服器或 AI 出錯的退還
//   - 使用者中斷（關頁面、按停止）時中斷對 AI 的請求，停止計費
//   - 開始串流前 AI 拒絕產生 → 422；串流途中出錯 → error 事件
//   - 用量記錄附上 token 數與費用（項目 6：觀察快取值不值得留；不記問題內容）
const { startNdjson } = require('../lib/ndjsonStream')
const { NarrationRefusedError } = require('./narrationService')

const BUSY_MESSAGE = '上一個 AI 解讀還在進行，請等它完成。'

// 同一個人同時只能有一個進行中的 AI 請求（每種 AI 各自一把鎖）。
// acquire 是同步的：檢查與上鎖之間沒有 await，同時到的請求只有一個拿得到。
// takeOver：同一人的新請求取代舊的（前端「重新產生」會先中斷舊的再送新的，但中斷要一點時間才傳到後端）：
//   先 abort 舊請求的 controller（舊請求還沒呼叫 AI 就不會呼叫；已經在產生就停止計費），等它釋放後再上鎖。
//   被取代的舊請求照「使用者中斷」處理，次數照算、不退，所以不會變成繞過每日上限的方法。
// 計數在記憶體，Cloud Run 多實例各算各的（同 express-rate-limit），只是第一道；每日上限仍以資料庫計數為準
const TAKEOVER_WAIT_MS = 5000

function createUserLock() {
  // key → { controller, released: Promise, done: () => void }
  const running = new Map()

  function acquire(key, controller = null) {
    if (running.has(key)) return false
    let done
    const released = new Promise((resolve) => {
      done = resolve
    })
    running.set(key, { controller, released, done })
    return true
  }

  function release(key) {
    const entry = running.get(key)
    if (!entry) return
    running.delete(key)
    entry.done()
  }

  // 拿不到（舊請求在 waitMs 內沒有結束，或被別的新請求搶先）回 false
  async function takeOver(key, controller, waitMs = TAKEOVER_WAIT_MS) {
    if (acquire(key, controller)) return true
    const old = running.get(key)
    if (!old?.controller) return false
    old.controller.abort()
    let timer
    await Promise.race([old.released, new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))])
    clearTimeout(timer)
    // 等的期間自己也斷線了，就不用再拿
    if (controller?.signal.aborted) return false
    return acquire(key, controller)
  }

  return { acquire, release, takeOver, has: (key) => running.has(key) }
}

// OpenRouter 回報的用量整理成要存的欄位（沒有就是 null）
function summarizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const number = (value) => (Number.isFinite(value) ? value : null)
  return {
    promptTokens: number(usage.prompt_tokens),
    completionTokens: number(usage.completion_tokens),
    cachedTokens: number(usage.prompt_tokens_details?.cached_tokens),
    reasoningTokens: number(usage.completion_tokens_details?.reasoning_tokens),
    cost: number(usage.cost),
  }
}

// AI 用量的記錄、退還與費用回報（MarketAiUsage 一筆＝一次開始產生的 AI 請求）
function createAiUsage({ Usage, now = () => Date.now() } = {}) {
  // 記錄失敗只寫 log，不中斷 AI
  function record(userId, kind) {
    if (!Usage) return null
    const expireAt = new Date(now() + (Usage.KEEP_DAYS || 2) * 86400000)
    return Promise.resolve(Usage.create({ user: userId, kind, expireAt })).catch((error) => {
      console.error('AI 用量記錄失敗：', error.message)
      return null
    })
  }

  async function refund(pending) {
    const entry = await pending
    if (!entry?._id || !Usage?.deleteOne) return
    await Promise.resolve(Usage.deleteOne({ _id: entry._id })).catch((error) => console.error('AI 用量退還失敗：', error.message))
  }

  // 完成後把 token 數與費用寫回那一筆；失敗只寫 log
  async function report(pending, usage, model) {
    const entry = await pending
    const summary = summarizeUsage(usage)
    if (!entry?._id || !Usage?.updateOne || (!summary && !model)) return
    await Promise.resolve(Usage.updateOne({ _id: entry._id }, { $set: { ...(summary || {}), model: model || null } })).catch((error) =>
      console.error('AI 用量回報失敗：', error.message),
    )
  }

  return { record, refund, report }
}

/**
 * 跑一次 AI 串流並回應 NDJSON。
 * @param res Express response
 * @param run ({ signal, onStart, onDelta }) => Promise<{ model, usage? }>：實際呼叫 AI
 * @param usage { record: () => pending, refund: (pending) => Promise, report?: (pending, usage, model) => Promise }
 * @param onStarted (writeEvent) => void：開始串流後、第一段文字前要先送的事件（例如行情、保留的段落數）
 * @param onComplete async ({ text, model }) => object：完整產生後要併進 done 事件的欄位（例如 saved）
 * @param onFailed () => void：伺服器或 AI 出錯時另外要做的事（例如取消冷卻）
 * @param messages { refused, failed }：AI 拒絕、途中出錯時給前端的訊息
 * @param controller 可以傳入已經建立的 AbortController（呼叫 AI 前還有其他等待時，先監聽中斷）
 * @param label log 用的名稱
 * @returns 'done' | 'aborted' | 'failed' | 'refused'；開始前出錯且不是 AI 拒絕時丟出錯誤，由呼叫端交給 next(error)
 */
async function streamAiResponse({ res, run, usage, onStarted = null, onComplete = null, onFailed = null, messages, controller = null, label = 'AI' }) {
  const abort = controller || watchClose(res)
  const writeEvent = (event) => res.write(`${JSON.stringify(event)}\n`)
  let text = ''
  let pending = null
  try {
    const result = await run({
      signal: abort.signal,
      onStart: () => {
        // 送出標頭並開始心跳（前端靠它分辨「還在等 AI」和「連線斷了」）；AI 開始產生才記一次
        startNdjson(res)
        pending = usage.record()
        if (onStarted) onStarted(writeEvent)
      },
      onDelta: (delta) => {
        text += delta
        writeEvent({ type: 'delta', text: delta })
      },
    })
    if (usage.report) void usage.report(pending, result?.usage, result?.model)
    const extra = onComplete ? await onComplete({ text, model: result?.model }) : {}
    writeEvent({ type: 'done', model: result?.model, ...extra })
    res.end()
    return 'done'
  } catch (error) {
    if (abort.signal.aborted) {
      // 請求處理途中的 log 一律走 stderr（v29 項目 2：stdout 和 node --test 的回報共用）
      console.warn(`${label} 已由使用者中斷`)
      // 被同一人的新請求取代時連線還在：要把這次的回應收尾，不然對方會一直等
      endAborted(res)
      return 'aborted'
    }
    // 伺服器或 AI 出錯（不是使用者停止）：退還這次的次數
    void usage.refund(pending)
    if (onFailed) onFailed()
    const refused = error instanceof NarrationRefusedError
    if (!res.headersSent) {
      if (refused) {
        res.status(422).json({ message: messages.refused })
        return 'refused'
      }
      throw error
    }
    console.error(error)
    writeEvent({ type: 'error', message: refused ? messages.refused : messages.failed })
    res.end()
    return 'failed'
  }
}

const REPLACED_MESSAGE = '同一個帳號又送出了新的 AI 請求，這一次已經停止。'

// 中斷後的收尾：使用者自己斷線的就不用回（連線已經關了）；被同一人的新請求取代（takeOver）時連線還在，
// 還沒開始串流就回 409，已經在串流就送一個 error 事件再結束
function endAborted(res) {
  const clientGone = !res.socket || res.socket.destroyed
  if (clientGone || res.writableEnded) return
  if (!res.headersSent) {
    res.status(409).json({ message: REPLACED_MESSAGE })
    return
  }
  res.write(`${JSON.stringify({ type: 'error', message: REPLACED_MESSAGE })}\n`)
  res.end()
}

// 前端中斷連線（按停止、重新抽牌、關閉頁面）時，連帶中斷對 AI 的請求以停止計費
function watchClose(res) {
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) controller.abort()
  })
  return controller
}

module.exports = { createUserLock, createAiUsage, summarizeUsage, streamAiResponse, watchClose, endAborted, BUSY_MESSAGE, REPLACED_MESSAGE, TAKEOVER_WAIT_MS }
