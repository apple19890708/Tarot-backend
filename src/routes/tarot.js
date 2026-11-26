// 塔羅占卜路由（v29 項目 9：從 server.js 抽出來，依賴用注入的方式，測試載入得到）。網址不變，掛在 app 底下（完整路徑）：
//   GET  /api/spreads                 牌陣定義
//   GET  /api/cards                   手動選牌用的全牌清單
//   GET  /api/cards/random            隨機抽牌（訪客限速）
//   POST /api/readings/draw           抽牌並解讀（訪客限速；紀錄不在這裡存）
//   POST /api/readings/manual         手動選牌解讀（訪客限速）
//   POST /api/readings/narrate        AI 解讀（要 AI 權限；NDJSON 串流）
//   POST /api/readings/follow-up/draw 追問抽牌（訪客限速）
//   POST /api/readings/follow-up/narrate 追問的 AI 延伸回答（要 AI 權限；NDJSON 串流）
// 紀錄（保存、列表、詳情）在 routes/readings.js，掛在 /api/readings；兩邊的路徑不重疊。
const express = require('express')
const mongoose = require('mongoose')

const spreads = require('../data/spreads')
const { getCardProfile } = require('../data/cardAttributes')
const { compareCards, validateManualCards, validateQuestion, resolveDomain, resolveCustomSpread } = require('../services/manualDraw')
const { isSameCards, followUpRelation, mergeFollowUpRecords } = require('../services/readingHistory')
const {
  FOLLOW_UP_MAX_ROUNDS,
  FOLLOW_UP_MAX_CARDS,
  validateFollowUpQuestion,
  validateFollowUps,
  loadFollowUps,
  buildFollowUpEntries,
  buildFollowUpContext,
  keepAnsweredSections,
  mergeFollowUpAnswer,
} = require('../services/followUp')
const { streamAiResponse, watchClose, endAborted, BUSY_MESSAGE } = require('../services/aiStream')
const { createGuestLimiter } = require('../lib/guestLimiter')

const ORIENTATIONS = ['upright', 'reversed']
const MANUAL_KEYS = ['manual', 'custom']
// 先前的 AI 解讀交給追問時的長度上限（和 narrationService 的 PREVIOUS_NARRATION_MAX 一致）
const PREVIOUS_NARRATION_MAX = 6000
// 前端送來的「已經寫好的追問回答」上限：只有還沒保存時才用（有紀錄一律用紀錄裡存的）
const FOLLOW_UP_TEXT_MAX = 20000

/**
 * @param deps 依賴（server.js 傳入正式的；測試傳假的）
 *   ensureDatabase, optionalAuth, requireAiAccess, ensureDomainAllowed
 *   Card, Reading, MarketCall：資料表
 *   loadCardsInOrder, buildReadingWithDictionary：牌庫與解讀
 *   aiQuota：tarotAiQuota（每日次數、用量、同時請求的鎖）
 *   ai：{ isAvailable, streamNarration, streamFollowUpNarration }
 *   market：{ buildSnapshot, recordCalls }（股市諮詢）
 *   isDatabaseReady：記錄 AI 建議前確認資料庫
 *   guestLimiter：訪客限速（測試可以換掉）
 *   random：追問抽牌的正逆位亂數（測試可以固定）
 */
function createTarotRouter({
  ensureDatabase,
  optionalAuth,
  requireAiAccess,
  ensureDomainAllowed,
  Card,
  Reading,
  MarketCall,
  loadCardsInOrder,
  buildReadingWithDictionary,
  aiQuota,
  ai,
  market,
  isDatabaseReady = () => mongoose.connection.readyState === 1,
  guestLimiter = createGuestLimiter(),
  random = Math.random,
}) {
  const router = express.Router()
  // 訪客限速要知道是不是登入的人：先 optionalAuth 再限速（登入的人略過）
  const guest = [optionalAuth, guestLimiter]

  router.get('/api/spreads', (_req, res) => {
    res.json(spreads)
  })

  router.get('/api/cards/random', ...guest, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const requestedCount = Number.parseInt(String(req.query.count || '1'), 10)
      const count = Number.isNaN(requestedCount) ? 1 : Math.min(Math.max(requestedCount, 1), 10)
      const cards = await Card.aggregate([{ $sample: { size: count } }])
      res.json(cards)
    } catch (error) {
      next(error)
    }
  })

  router.post('/api/readings/draw', ...guest, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const spread = spreads.find((item) => item.key === req.body.spreadKey)
      if (!spread) {
        res.status(400).json({ message: '找不到指定牌陣。' })
        return
      }
      // 問題長度在這裡就擋掉，和 manual／narrate 一致（它會被回聲，也可能被存成紀錄）
      const { question, error: questionError } = validateQuestion(req.body.question)
      if (questionError) {
        res.status(400).json({ message: questionError })
        return
      }
      const { domain, error: domainError } = resolveDomain(req.body.domain)
      if (domainError) {
        res.status(400).json({ message: domainError })
        return
      }
      if (!(await ensureDomainAllowed(req, res, domain))) return

      const cards = await Card.aggregate([{ $sample: { size: spread.cardCount } }])
      if (cards.length < spread.cardCount) {
        res.status(400).json({ message: '資料庫中的牌卡數量不足，請先執行 seed。' })
        return
      }
      // 紀錄不在這裡存：要不要留存由使用者在結果頁自己決定（POST /api/readings）
      res.json(await buildReadingWithDictionary({ question, spread, cards, domain }))
    } catch (error) {
      next(error)
    }
  })

  // 手動選牌用的全牌清單，只回傳選牌需要的欄位
  router.get('/api/cards', async (_req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const cards = await Card.find({}, 'nameZh nameEn suit arcanaType number image').lean()
      const list = cards.sort(compareCards).map((card) => {
        // 宮廷牌的判斷集中在 getCardProfile（依牌名），由後端給 kind，前端只拿來分組顯示。
        // 號碼本身四個牌組一致（侍者 11、騎士 12、皇后 13、國王 14，2026-11-04 查資料庫確認）
        const profile = getCardProfile(card)
        return {
          id: card._id,
          nameZh: card.nameZh,
          nameEn: card.nameEn,
          suit: card.suit,
          arcanaType: card.arcanaType,
          number: card.number,
          image: card.image || '',
          kind: profile.kind,
          courtRank: profile.courtRank,
        }
      })
      res.json(list)
    } catch (error) {
      next(error)
    }
  })

  // 手動選牌解讀：有帶 spreadKey 就套牌陣位置（關係對與位置權重照常生效），沒帶就維持自由張數
  router.post('/api/readings/manual', ...guest, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const { question, error: questionError } = validateQuestion(req.body.question)
      if (questionError) {
        res.status(400).json({ message: questionError })
        return
      }
      const { domain, error: domainError } = resolveDomain(req.body.domain)
      if (domainError) {
        res.status(400).json({ message: domainError })
        return
      }
      if (!(await ensureDomainAllowed(req, res, domain))) return

      const { drawn, error } = validateManualCards(req.body.cards)
      if (error) {
        res.status(400).json({ message: error })
        return
      }
      // spreadKey 省略時維持舊行為（自由張數、無位置）；給了就必須存在
      let spread = null
      if (req.body.spreadKey) {
        spread = spreads.find((item) => item.key === req.body.spreadKey) || null
        if (!spread) {
          res.status(400).json({ message: '找不到指定牌陣。' })
          return
        }
        if (drawn.length !== spread.cardCount) {
          res.status(400).json({ message: `${spread.name} 需要 ${spread.cardCount} 張牌，目前選了 ${drawn.length} 張。` })
          return
        }
      } else {
        const custom = resolveCustomSpread(req.body.positions, drawn.length)
        if (custom.error) {
          res.status(400).json({ message: custom.error })
          return
        }
        spread = custom.spread
      }
      const { cards, error: loadError } = await loadCardsInOrder(drawn)
      if (loadError) {
        res.status(400).json({ message: loadError })
        return
      }
      const reading = await buildReadingWithDictionary({ question, spread, cards, drawOrientation: (index) => drawn[index].orientation, domain })
      res.json(reading)
    } catch (error) {
      next(error)
    }
  })

  // ---- AI ----

  // AI 解讀與追問共用：檢查並還原「原本那次占卜」（牌陣或自訂位置、牌與正逆位、問題、類型）。
  // 依牌與正逆位重算組合分析，不信任前端傳來的分析文字。有問題時直接回應並回傳 null
  async function resolveNarrateReading(req, res) {
    // spreadKey 省略、manual 或 custom 時走手動選牌（位置由 positions 決定）；否則依指定牌陣
    const isManual = !req.body.spreadKey || MANUAL_KEYS.includes(req.body.spreadKey)
    const spread = isManual ? null : spreads.find((item) => item.key === req.body.spreadKey)
    if (!isManual && !spread) {
      res.status(400).json({ message: '找不到指定牌陣。' })
      return null
    }
    const { question, error: questionError } = validateQuestion(req.body.question)
    if (questionError) {
      res.status(400).json({ message: questionError })
      return null
    }
    const { domain, error: domainError } = resolveDomain(req.body.domain)
    if (domainError) {
      res.status(400).json({ message: domainError })
      return null
    }
    // requireAiAccess 只確認 AI 權限；股市諮詢還要金融股市權限，否則會拿到行情、回測與操作建議
    if (!(await ensureDomainAllowed(req, res, domain))) return null

    let drawn
    let narrateSpread = spread
    if (isManual) {
      const result = validateManualCards(req.body.cards)
      if (result.error) {
        res.status(400).json({ message: result.error })
        return null
      }
      drawn = result.drawn
      // 自訂位置要一起帶進來，否則 AI 解讀會看不到使用者定義的位置含意
      const custom = resolveCustomSpread(req.body.positions, drawn.length)
      if (custom.error) {
        res.status(400).json({ message: custom.error })
        return null
      }
      narrateSpread = custom.spread
    } else {
      drawn = Array.isArray(req.body.cards) ? req.body.cards : []
      const isValid =
        drawn.length === spread.cardCount && drawn.every((item) => mongoose.isValidObjectId(item?.id) && ORIENTATIONS.includes(item?.orientation))
      if (!isValid) {
        res.status(400).json({ message: '牌卡資料格式不正確。' })
        return null
      }
    }
    const { cards, error: loadError } = await loadCardsInOrder(drawn)
    if (loadError) {
      res.status(400).json({ message: loadError })
      return null
    }
    const reading = await buildReadingWithDictionary({
      question,
      spread: narrateSpread,
      cards,
      drawOrientation: (index) => drawn[index].orientation,
      domain,
    })
    return { reading, cards, drawn, question, domain }
  }

  // 自己的那筆紀錄而且牌一樣（存回解讀、拿先前的解讀都要這個條件）；不是就 null
  async function ownRecordWithSameCards(readingId, userId, drawn) {
    if (!readingId || !userId || !mongoose.isValidObjectId(readingId)) return null
    const record = await Reading.findOne({ _id: readingId, user: userId })
    return record && isSameCards(record.cards, drawn) ? record : null
  }

  // 把完整產生的 AI 解讀存回使用者自己的那筆紀錄。回傳 null（沒帶 readingId）、true（已存）、false（沒存成）。
  // 重新產生時直接覆蓋同一筆的 narration；結果要回報給前端，否則存檔失敗只寫在 log，使用者以為紀錄已經更新
  async function saveNarration({ readingId, userId, text, model, market: snapshot, drawn }) {
    if (!readingId) return null
    if (!userId || !text || !mongoose.isValidObjectId(readingId)) return false
    try {
      // 確認這段解讀講的就是那筆紀錄的牌，否則紀錄會配上一段和畫面無關的文字
      const record = await ownRecordWithSameCards(readingId, userId, drawn)
      if (!record) return false
      record.narration = { text, model: model || '', market: snapshot || null, createdAt: new Date() }
      await record.save()
      return true
    } catch (error) {
      console.error('AI 解讀存檔失敗：', error.message)
      return false
    }
  }

  // 追問的延伸回答存回紀錄（規則同 saveNarration），連同這次的追問清單一起寫入
  async function saveFollowUpNarration({ readingId, userId, text, model, drawn, followUps }) {
    if (!readingId) return null
    if (!userId || !text || !mongoose.isValidObjectId(readingId)) return false
    try {
      const record = await ownRecordWithSameCards(readingId, userId, drawn)
      if (!record) return false
      // 寫的途中使用者可能又抽了一次追問並同步過：紀錄比這次請求新時只存回答，不動追問清單；
      // 對不起來（換成另一組追問）就不存，讓前端用手上完整的清單補存
      const relation = followUpRelation(record.followUps, followUps)
      if (relation === 'different') return false
      if (relation !== 'behind') record.followUps = mergeFollowUpRecords(record.followUps, followUps)
      record.followUpNarration = { text, model: model || '', rounds: followUps.length, createdAt: new Date() }
      await record.save()
      return true
    } catch (error) {
      console.error('AI 追問存檔失敗：', error.message)
      return false
    }
  }

  // 同一人同一種 AI 同時只能一個（v29 項目 1）：新請求取代進行中的舊請求；拿不到時已回 409
  async function lockOrReject(req, res, kind, controller) {
    if (await aiQuota.takeOver(req.auth.userId, kind, controller)) return true
    if (controller.signal.aborted) endAborted(res)
    else res.status(409).json({ message: BUSY_MESSAGE })
    return false
  }

  const usageOf = (userId, kind) => ({
    record: () => aiQuota.record(userId, kind),
    refund: (pending) => aiQuota.refund(pending),
    report: (pending, usage, model) => aiQuota.report(pending, usage, model),
  })

  router.post('/api/readings/narrate', requireAiAccess, async (req, res, next) => {
    // 一開始就監聽斷線：查次數、查行情要等，這段期間使用者按了重新產生（前端會先中斷舊的），就不要再呼叫 AI
    const controller = watchClose(res)
    try {
      if (!ai.isAvailable()) {
        res.status(503).json({ message: 'AI 解讀尚未設定（缺少 OPENROUTER_API_KEY）。' })
        return
      }
      if (!ensureDatabase(res)) return
      const resolved = await resolveNarrateReading(req, res)
      if (!resolved) return
      const { reading, cards, drawn, question, domain } = resolved
      const userId = req.auth.userId

      if (!(await lockOrReject(req, res, 'tarot', controller))) return
      try {
        const quota = await aiQuota.check(req.auth, 'tarot')
        if (!quota.allowed) {
          res.status(429).json({ message: aiQuota.limitMessage('tarot', quota.limit) })
          return
        }
        // 只有「股市諮詢」才查即時報價與技術指標一起交給 AI；查詢失敗不影響解讀，只是少了數據
        const snapshot =
          domain === 'stock'
            ? await market.buildSnapshot(question).catch((error) => {
                console.error('市場資料查詢失敗：', error.message)
                return null
              })
            : null
        // AI 解讀時查到的建議也記下來（自動對答案用）；失敗不影響解讀
        if (snapshot && isDatabaseReady()) {
          market.recordCalls(MarketCall, userId, snapshot).catch((err) => console.error('建議紀錄失敗：', err.message))
        }

        // 等待的期間斷線（或被同一人的新請求取代）：不呼叫 AI、不計費
        if (controller.signal.aborted) return endAborted(res)
        // NDJSON 事件：market（股市問題才有、排在最前面）、delta、done（saved）、error
        await streamAiResponse({
          res,
          controller,
          label: 'AI 解讀',
          messages: { refused: 'AI 無法產生這次的解讀。', failed: 'AI 解讀中途發生錯誤，請再試一次。' },
          usage: usageOf(userId, 'tarot'),
          run: ({ signal, onStart, onDelta }) => ai.streamNarration({ reading, cards, market: snapshot, signal, onStart, onDelta }),
          onStarted: (writeEvent) => {
            if (snapshot) writeEvent({ type: 'market', snapshot })
          },
          // 只有完整產生才存；中途被停止的半截文字不留（紀錄裡原本那篇也保持不動）
          onComplete: async ({ text, model }) => ({
            saved: await saveNarration({ readingId: req.body.readingId, userId, text, model, market: snapshot, drawn }),
          }),
        })
      } finally {
        aiQuota.release(userId, 'tarot')
      }
    } catch (error) {
      next(error)
    }
  })

  // ---- 抽牌追問（v23）----
  // 追問抽牌：從還沒出現過的牌裡抽 1～3 張。不存檔（和占卜一樣，由前端決定要不要保存）。
  // body：{ cards: 原牌陣的牌, followUps: 之前的追問, question: 這次追問的內容, count: 1～3, picks?: 自己抽的牌 }
  // picks：使用者在扇形牌堆自己抽的牌（正逆位在前端洗牌時就決定，同手動抽牌）；有帶就用它、不另外抽
  router.post('/api/readings/follow-up/draw', ...guest, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const { drawn: baseDrawn, error: cardsError } = validateManualCards(req.body.cards)
      if (cardsError) {
        res.status(400).json({ message: cardsError })
        return
      }
      const { followUps, error: followUpError } = validateFollowUps(req.body.followUps, baseDrawn)
      if (followUpError) {
        res.status(400).json({ message: followUpError })
        return
      }
      if (followUps.length >= FOLLOW_UP_MAX_ROUNDS) {
        res.status(400).json({ message: `追問最多 ${FOLLOW_UP_MAX_ROUNDS} 次。` })
        return
      }
      const { question, error: questionError } = validateFollowUpQuestion(req.body.question)
      if (questionError) {
        res.status(400).json({ message: questionError })
        return
      }
      // 自己抽的牌：和之前的追問放在一起檢查（張數、格式、不能和桌上的牌重複），再照順序從牌庫載入
      if (req.body.picks !== undefined) {
        const { followUps: checked, error: picksError } = validateFollowUps(
          [...followUps.map((item) => ({ question: item.question, cards: item.drawn })), { question, cards: req.body.picks }],
          baseDrawn,
        )
        if (picksError) {
          res.status(400).json({ message: picksError })
          return
        }
        const pickedDrawn = checked[checked.length - 1].drawn
        const { cards: pickedCards, error: loadError } = await loadCardsInOrder(pickedDrawn)
        if (loadError) {
          res.status(400).json({ message: loadError })
          return
        }
        res.json({ question, cards: buildFollowUpEntries(pickedCards, pickedDrawn) })
        return
      }
      const count = Number.parseInt(String(req.body.count), 10)
      if (!Number.isInteger(count) || count < 1 || count > FOLLOW_UP_MAX_CARDS) {
        res.status(400).json({ message: `每次追問抽 1 到 ${FOLLOW_UP_MAX_CARDS} 張牌。` })
        return
      }
      // 同一副牌：已經在桌上的牌（原牌陣與之前的補充牌）不會再被抽到
      const used = [...baseDrawn, ...followUps.flatMap((item) => item.drawn)].map((item) => new mongoose.Types.ObjectId(String(item.id)))
      const cards = await Card.aggregate([{ $match: { _id: { $nin: used } } }, { $sample: { size: count } }])
      if (cards.length < count) {
        res.status(400).json({ message: '牌庫剩下的牌不夠了。' })
        return
      }
      const drawn = cards.map((card) => ({ id: String(card._id), orientation: random() > 0.5 ? 'upright' : 'reversed' }))
      res.json({ question, cards: buildFollowUpEntries(cards, drawn) })
    } catch (error) {
      next(error)
    }
  })

  // 追問的 AI 延伸回答：把原牌陣、先前的解讀與所有追問的補充牌一起交給 AI。
  // body：同 /api/readings/narrate（原本那次占卜），加上 followUps、narration（先前的解讀全文，可省略）、readingId（可省略）。
  // 回應是 NDJSON：start（kept）、delta、done（saved）、error。不查市場資料（追問只談牌）
  router.post('/api/readings/follow-up/narrate', requireAiAccess, async (req, res, next) => {
    const controller = watchClose(res)
    try {
      if (!ai.isAvailable()) {
        res.status(503).json({ message: 'AI 解讀尚未設定（缺少 OPENROUTER_API_KEY）。' })
        return
      }
      if (!ensureDatabase(res)) return
      const resolved = await resolveNarrateReading(req, res)
      if (!resolved) return
      const { reading, cards, drawn, question } = resolved
      const userId = req.auth.userId

      if (!(await lockOrReject(req, res, 'followUp', controller))) return
      try {
        const quota = await aiQuota.check(req.auth, 'followUp')
        if (!quota.allowed) {
          res.status(429).json({ message: aiQuota.limitMessage('followUp', quota.limit) })
          return
        }
        const { followUps, error: followUpError } = await loadFollowUps(req.body.followUps, drawn, loadCardsInOrder)
        if (followUpError) {
          res.status(400).json({ message: followUpError })
          return
        }
        if (followUps.length === 0) {
          res.status(400).json({ message: '還沒有追問，請先寫下追問並抽補充牌。' })
          return
        }
        // 先前的解讀與已寫好的回答：有紀錄（自己的、牌一樣）一律用紀錄裡存的；
        // 沒有紀錄（還沒保存）才用前端送來的，並截短（v29 項目 6：不信任前端送來的長文字）
        const record = await ownRecordWithSameCards(req.body.readingId, userId, drawn).catch(() => null)
        const previousNarration = record?.narration?.text
          ? record.narration.text.slice(0, PREVIOUS_NARRATION_MAX)
          : typeof req.body.narration === 'string'
            ? req.body.narration.slice(0, PREVIOUS_NARRATION_MAX)
            : ''

        const context = buildFollowUpContext({
          question,
          baseCards: cards,
          baseDrawn: drawn,
          positionKeys: reading.cards.every((entry) => entry.position) ? reading.cards.map((entry) => entry.position.key) : null,
          rounds: followUps,
        })
        // 只回答新的追問（2026-11-13 使用者要求）：body.answeredRounds＝前幾次已經有回答、要保留。
        // 至少留最後一次給 AI 寫（「重新回答」沒有新追問時，重寫最後一次與綜合來看）
        const requested = Number.parseInt(String(req.body.answeredRounds ?? 0), 10)
        const keepCount = Number.isInteger(requested) ? Math.min(Math.max(requested, 0), followUps.length - 1) : 0
        // 已經寫好的回答：紀錄裡有就用紀錄的；沒有（還沒保存、或存檔失敗）才用前端送來的
        let previousAnswer = ''
        if (keepCount > 0) {
          previousAnswer =
            record?.followUpNarration?.text || (typeof req.body.followUpText === 'string' ? req.body.followUpText.slice(0, FOLLOW_UP_TEXT_MAX) : '')
        }
        const answered = keepAnsweredSections(previousAnswer, keepCount)

        if (controller.signal.aborted) return endAborted(res)
        await streamAiResponse({
          res,
          controller,
          label: 'AI 追問',
          messages: { refused: 'AI 無法產生這次的回答。', failed: 'AI 追問中途發生錯誤，請再試一次。' },
          usage: usageOf(userId, 'followUp'),
          run: ({ signal, onStart, onDelta }) =>
            ai.streamFollowUpNarration({
              reading,
              cards,
              context,
              previousNarration,
              answered: answered.kept,
              answeredText: answered.text,
              signal,
              onStart,
              onDelta,
            }),
          // kept：保留了前幾次追問的回答，前端照這個數字把舊的段落接在新寫的前面
          onStarted: (writeEvent) => writeEvent({ type: 'start', kept: answered.kept }),
          onComplete: async ({ text, model }) => ({
            saved: await saveFollowUpNarration({
              readingId: req.body.readingId,
              userId,
              text: mergeFollowUpAnswer(answered.text, text),
              model,
              drawn,
              followUps,
            }),
          }),
        })
      } finally {
        aiQuota.release(userId, 'followUp')
      }
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createTarotRouter, PREVIOUS_NARRATION_MAX, FOLLOW_UP_TEXT_MAX }
