// 財經新聞（v17 規格 G）：股市追蹤的「財經新聞」分頁與 AI 影響分析。
// 新聞列表不呼叫 AI；只有 POST /finance-news/analysis 會呼叫（要 AI 權限、有次數限制，使用者手動按）。
// 依賴以參數注入，測試時不必連資料庫、外部來源或 AI。
const express = require('express')
const mongoose = require('mongoose')

const { NEWS_THEMES } = require('../data/newsThemes')
const { tradesOf } = require('../services/market/portfolio')
const { buildFinanceNewsMessages } = require('../services/market/financeNewsAnalysis')
const { clusterNews, isMopsRepost } = require('../services/market/financeNews')
const { watchMatchers } = require('../services/market/newsDigest')
const { NarrationRefusedError } = require('../services/narrationService')
const { startOfTaipeiDay } = require('./marketAnalysis')
const { startNdjson } = require('../lib/ndjsonStream')

// 每人每天最多幾次（admin 不限）；兩次之間至少隔多久（中斷的也算）
const DAILY_LIMIT = 10
const COOLDOWN_MS = 10 * 60 * 1000
// 交給 AI 的新聞：最近 24 小時取最新 40 則，不足 10 則放寬到 72 小時
const AI_NEWS_LIMIT = 40
const AI_NEWS_MIN = 10
// 交給 AI 的追蹤股票上限（追蹤清單可能有幾十檔，全丟會讓輸入變長、回答也只會逐檔說「沒關聯」）
const AI_WATCH_LIMIT = 15
const LIST_DAYS = 3
const LIST_LIMIT = 200
const REGIONS = ['all', 'tw', 'intl']
const THEME_KEYS = new Set(NEWS_THEMES.map((theme) => theme.key))

function holdsShares(watch) {
  const total = tradesOf(watch).reduce((sum, t) => sum + (t.side === 'sell' ? -1 : 1) * (Number(t.quantity) || 0), 0)
  return total > 0
}

// 從追蹤清單挑出要給 AI 的：新聞（標題、摘要、全文提到的個股）有提到的優先，其次是有持股的，最多 AI_WATCH_LIMIT 檔。
// 排序：提到且有持股 → 提到 → 有持股；新聞沒提到也沒持股的不給（AI 只能憑產業關聯硬湊）
function pickWatchesForAi(watches, news) {
  const matchers = new Map(watchMatchers(watches).map((m) => [m.key, m]))
  const texts = news.map((n) => `${n.title} ${n.summary || ''}`)
  const mentionedKeys = new Set(news.flatMap((n) => n.mentions || []))
  const candidates = watches.map((w, index) => {
    const t = w.target || {}
    const key = t.market === 'tw' ? `tw:${t.code}` : `us:${t.symbol}`
    const matcher = matchers.get(key)
    const mentioned = mentionedKeys.has(key) || Boolean(matcher && texts.some((text) => matcher.test(text)))
    return { index, mentioned, holding: holdsShares(w), target: t }
  })
  const rank = (c) => (c.mentioned ? 0 : 2) + (c.holding ? 0 : 1)
  const picked = candidates
    .filter((c) => c.mentioned || c.holding)
    .sort((a, b) => rank(a) - rank(b) || a.index - b.index)
    .slice(0, AI_WATCH_LIMIT)
  return {
    watchlist: picked.map((c) => ({
      name: c.target.name,
      code: c.target.code,
      symbol: c.target.symbol,
      market: c.target.market,
      holding: c.holding,
      mentioned: c.mentioned,
    })),
    omitted: watches.length - picked.length,
  }
}

function createFinanceNewsRouter({
  requireStockAccess,
  requireAiAccess,
  ensureDatabase,
  // createFinanceNewsSync 的結果：sync()、list()、status()
  financeNews,
  // createNewsDigest 的結果：getDigest(id)；沒傳就不開新聞重點彈窗
  newsDigest = null,
  MarketWatch,
  FinanceNewsAnalysis,
  // AI：isAvailable() 與 stream({ messages, signal, onStart, onDelta }) → { model }
  ai,
  // AI 用量紀錄（每日次數）：AI 開始產生就記一筆，中途停止的也算。沒傳時改數存下來的分析（只有完整產生的）
  MarketAiUsage = null,
  now = () => Date.now(),
}) {
  const router = express.Router()

  // AI 開始產生（開始計費）時記一筆用量；記錄失敗只寫 log，不中斷分析
  function recordUsage(userId) {
    if (!MarketAiUsage) return null
    const expireAt = new Date(now() + (MarketAiUsage.KEEP_DAYS || 2) * 86400000)
    return Promise.resolve(MarketAiUsage.create({ user: userId, kind: 'news', expireAt })).catch((error) => {
      console.error('AI 用量記錄失敗：', error.message)
      return null
    })
  }
  // 伺服器或 AI 那邊出錯（不是使用者停止）時退還這次的次數
  async function refundUsage(pending) {
    const record = await pending
    if (!record?._id || !MarketAiUsage?.deleteOne) return
    await Promise.resolve(MarketAiUsage.deleteOne({ _id: record._id })).catch((error) =>
      console.error('AI 用量退還失敗：', error.message),
    )
  }
  const running = new Set()
  const startedAt = new Map()

  async function syncQuietly() {
    try {
      await financeNews.sync()
    } catch (error) {
      console.error('財經新聞同步失敗：', error.message)
    }
  }

  async function watchesOf(userId) {
    return (await MarketWatch.find({ user: userId })) || []
  }

  async function quotaOf(req) {
    const userId = req.auth.userId
    const [usedToday, latest] = await Promise.all([
      (MarketAiUsage || FinanceNewsAnalysis).countDocuments({
        user: userId,
        ...(MarketAiUsage ? { kind: 'news' } : {}),
        createdAt: { $gte: startOfTaipeiDay(now()) },
      }),
      FinanceNewsAnalysis.findOne({ user: userId }).sort({ createdAt: -1 }),
    ])
    const lastStart = Math.max(latest ? new Date(latest.createdAt).getTime() : 0, startedAt.get(userId) || 0)
    const retryAt = lastStart && lastStart + COOLDOWN_MS > now() ? new Date(lastStart + COOLDOWN_MS).toISOString() : null
    return { quota: { dailyLimit: req.auth.role === 'admin' ? null : DAILY_LIMIT, usedToday, retryAt }, latest }
  }

  function parseScope(body) {
    const region = body?.region ?? 'all'
    const theme = body?.theme ?? null
    if (!REGIONS.includes(region)) return { error: '分析範圍不正確。' }
    if (theme !== null && !(typeof theme === 'string' && THEME_KEYS.has(theme))) return { error: '主題不正確。' }
    return { region, theme }
  }

  // 後端自己挑新聞，不收前端送來的內容
  // 同一件事的多則報導只取最新一則，40 則的名額不要被重複新聞佔掉（所以先多抓一些再去重）
  // Yahoo 轉貼的觀測站公告（月營收、董事會決議）不給 AI，名額留給真正的新聞
  const onePerEvent = (items) =>
    clusterNews(items.filter((item) => !isMopsRepost(item)))
      .filter((item) => item.clusterId === item.id)
      .slice(0, AI_NEWS_LIMIT)
      .map(({ clusterId, ...item }) => item)
  async function newsForAi({ region, theme }) {
    const filter = { region: region === 'all' ? null : region, theme, limit: AI_NEWS_LIMIT * 3 }
    const recent = onePerEvent(await financeNews.list({ ...filter, since: new Date(now() - 24 * 3600000) }))
    if (recent.length >= AI_NEWS_MIN) return recent
    return onePerEvent(await financeNews.list({ ...filter, since: new Date(now() - 72 * 3600000) }))
  }

  // ---- 新聞列表（不呼叫 AI）----

  router.get('/finance-news', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      await syncQuietly()
      const [news, watches, { quota, latest }] = await Promise.all([
        financeNews.list({ days: LIST_DAYS, limit: LIST_LIMIT }),
        watchesOf(req.auth.userId),
        quotaOf(req),
      ])
      // 與我追蹤相關：用追蹤清單的代號與名稱比對標題＋摘要（台股、美股都算）
      const matchers = watchMatchers(watches)
      res.json({
        // clusterId：同一件事的報導有相同的值（群裡最新那則的 id），畫面合併成一張卡
        // 與我追蹤相關：標題＋摘要比對，再加上全文產生的新聞重點裡提到的（和彈窗一致）
        // Yahoo 轉貼的觀測站公告（多半是小型股的月營收、董事會決議）只留公司在追蹤清單裡的，比對標題就好
        news: clusterNews(news)
          .map(({ mentions = [], ...item }) => {
            if (isMopsRepost(item)) return { ...item, watched: matchers.filter((m) => m.test(item.title)).map((m) => m.label) }
            const text = `${item.title} ${item.summary}`
            const inArticle = new Set(mentions)
            return { ...item, watched: matchers.filter((m) => inArticle.has(m.key) || m.test(text)).map((m) => m.label) }
          })
          .filter((item) => !isMopsRepost(item) || item.watched.length),
        themes: NEWS_THEMES.map((theme) => ({ key: theme.key, label: theme.label })),
        status: financeNews.status(),
        quota,
        // 最近一份分析（含當時的新聞清單，畫面才能把 [n] 對回新聞）
        latest: latest ? latest.toDetailJSON() : null,
      })
    } catch (error) {
      next(error)
    }
  })

  // ---- 新聞重點彈窗（不呼叫 AI）----

  router.get('/finance-news/:id/digest', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!newsDigest || !mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這則新聞，可能已經超過保存期限。' })
        return
      }
      const [digest, watches] = await Promise.all([newsDigest.getDigest(req.params.id), watchesOf(req.auth.userId)])
      if (!digest) {
        res.status(404).json({ message: '找不到這則新聞，可能已經超過保存期限。' })
        return
      }
      // 提及的個股是否在我的追蹤清單裡（個人資料，不進共用的結果）
      const mine = new Set(watches.map((w) => (w.target?.market === 'tw' ? `tw:${w.target.code}` : `us:${w.target?.symbol}`)))
      const keyOf = (stock) => (stock.market === 'tw' ? `tw:${stock.code}` : `us:${stock.symbol}`)
      // 只顯示前 10 檔；排在後面、但在我追蹤清單裡的也要補上（不然列表標了「與我追蹤相關」，彈窗卻找不到）
      const { moreStocks = [], ...rest } = digest
      const shown = [...(digest.stocks || []), ...moreStocks.filter((stock) => mine.has(keyOf(stock)))]
      res.json({
        digest: {
          ...rest,
          stocks: shown.map((stock) => ({ ...stock, watched: mine.has(keyOf(stock)) })),
        },
      })
    } catch (error) {
      next(error)
    }
  })

  // ---- AI 影響分析（會計費）----

  router.post('/finance-news/analysis', requireStockAccess, requireAiAccess, async (req, res, next) => {
    const userId = req.auth.userId
    let locked = false
    try {
      if (!ai?.isAvailable()) {
        res.status(503).json({ message: 'AI 分析尚未設定（缺少 OPENROUTER_API_KEY）。' })
        return
      }
      if (!ensureDatabase(res)) return
      const scope = parseScope(req.body)
      if (scope.error) {
        res.status(400).json({ message: scope.error })
        return
      }
      if (running.has(userId)) {
        res.status(409).json({ message: '上一個 AI 分析還在進行，請等它完成。' })
        return
      }
      // 檢查完立刻上鎖（同步執行），同時送多個請求也只有一個能往下走；早退時由 finally 釋放
      running.add(userId)
      locked = true
      // 一開始就監聽中斷：同步新聞時使用者已經關掉的話，就不呼叫 AI
      const controller = new AbortController()
      res.on('close', () => {
        if (!res.writableFinished) controller.abort()
      })
      const { quota } = await quotaOf(req)
      if (quota.retryAt) {
        res.status(429).json({ message: '剛分析過，請稍後再試。', retryAt: quota.retryAt })
        return
      }
      if (quota.dailyLimit !== null && quota.usedToday >= quota.dailyLimit) {
        res.status(429).json({ message: `今天的新聞 AI 分析已用完（每天 ${quota.dailyLimit} 次），明天再試。` })
        return
      }

      await syncQuietly()
      const [news, watches] = await Promise.all([newsForAi(scope), watchesOf(userId)])
      if (!news.length) {
        res.status(422).json({ message: '這個範圍最近 3 天沒有新聞，換個範圍再試。' })
        return
      }
      if (controller.signal.aborted) return
      startedAt.set(userId, now())
      // 追蹤清單可能有幾十檔：只交給 AI 新聞有提到的、有持股的，最多 AI_WATCH_LIMIT 檔
      const { watchlist, omitted: omittedWatches } = pickWatchesForAi(watches, news)

      const writeEvent = (event) => res.write(`${JSON.stringify(event)}\n`)
      let text = ''
      let usage = null

      try {
        const { model } = await ai.stream({
          messages: buildFinanceNewsMessages({ news, watchlist, omittedWatches, ...scope, now: new Date(now()) }),
          signal: controller.signal,
          onStart: () => {
            // 送出標頭並開始心跳（前端靠它分辨「還在等 AI」和「連線斷了」）
            startNdjson(res)
            usage = recordUsage(userId)
          },
          onDelta: (delta) => {
            text += delta
            writeEvent({ type: 'delta', text: delta })
          },
        })
        let saved = null
        try {
          const record = await FinanceNewsAnalysis.create({
            user: userId,
            region: scope.region,
            theme: scope.theme,
            text,
            model: model || '',
            news: news.map((n) => ({ title: n.title, sourceLabel: n.sourceLabel, region: n.region, url: n.url, publishedAt: n.publishedAt })),
          })
          saved = record.toSummaryJSON()
          await trimOldest(userId)
        } catch (error) {
          console.error('新聞分析存檔失敗：', error.message)
        }
        writeEvent({ type: 'done', model, analysis: saved })
        res.end()
      } catch (error) {
        if (controller.signal.aborted) {
          console.log('新聞 AI 分析已由使用者中斷')
          return
        }
        // 伺服器或 AI 出錯（不是使用者停止）：不算冷卻、退還次數，可以馬上重試
        startedAt.delete(userId)
        void refundUsage(usage)
        if (!res.headersSent) throw error
        console.error(error)
        writeEvent({
          type: 'error',
          message: error instanceof NarrationRefusedError ? 'AI 無法產生這次的分析。' : 'AI 分析中途發生錯誤，這次不算次數，請再試一次。',
        })
        res.end()
      }
    } catch (error) {
      if (error instanceof NarrationRefusedError) {
        res.status(422).json({ message: 'AI 無法產生這次的分析。' })
        return
      }
      next(error)
    } finally {
      if (locked) running.delete(userId)
    }
  })

  async function trimOldest(userId) {
    const max = FinanceNewsAnalysis.MAX_ANALYSES_PER_USER || 30
    const extra = await FinanceNewsAnalysis.find({ user: userId }).sort({ createdAt: -1, _id: -1 }).skip(max).select('_id')
    if (extra.length) await FinanceNewsAnalysis.deleteMany({ _id: { $in: extra.map((doc) => doc._id) } })
  }

  // ---- 我的新聞分析紀錄（只要股市權限：AI 權限收回後，付費產生的紀錄還是看得到）----

  router.get('/finance-news/analyses', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const records = await FinanceNewsAnalysis.find({ user: req.auth.userId }).sort({ createdAt: -1, _id: -1 }).select('-text')
      res.json({ analyses: records.map((record) => record.toSummaryJSON()) })
    } catch (error) {
      next(error)
    }
  })

  async function findOwn(req, res) {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(404).json({ message: '找不到這筆分析紀錄。' })
      return null
    }
    const record = await FinanceNewsAnalysis.findOne({ _id: req.params.id, user: req.auth.userId })
    if (!record) res.status(404).json({ message: '找不到這筆分析紀錄。' })
    return record
  }

  router.get('/finance-news/analyses/:id', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const record = await findOwn(req, res)
      if (!record) return
      res.json({ analysis: record.toDetailJSON() })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/finance-news/analyses/:id', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這筆分析紀錄。' })
        return
      }
      const result = await FinanceNewsAnalysis.deleteOne({ _id: req.params.id, user: req.auth.userId })
      if (result.deletedCount === 0) {
        res.status(404).json({ message: '找不到這筆分析紀錄。' })
        return
      }
      res.json({ deleted: true })
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createFinanceNewsRouter, pickWatchesForAi, DAILY_LIMIT, COOLDOWN_MS, AI_NEWS_LIMIT, AI_WATCH_LIMIT }
