// 外部排程（GitHub Actions／cron-job.org）呼叫的端點：網頁關著時也能檢查價位提醒並推播（Discord）。
// 不需要登入，改用共用密鑰（CRON_SECRET，放在環境變數與排程服務的 secret，不寫進程式）。
// 沒設定密鑰時整條關閉（回 503），避免被任何人觸發。
const crypto = require('crypto')
const express = require('express')

const { evaluateAlerts, isMarketOpen } = require('../services/market/alertChecker')

function secretMatches(given, expected) {
  if (typeof given !== 'string' || !expected) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function createCronRouter({
  secret = process.env.CRON_SECRET,
  ensureDatabase,
  marketService,
  notifier,
  MarketAlert,
  User,
  now = () => new Date(),
  // 階段 3 的每日資產快照，由同一個排程觸發；沒傳就略過
  recordSnapshots = null,
  // 重大訊息同步（來源只有當天的，要定期抓下來存）；沒傳就略過
  syncNews = null,
  // 財經新聞同步（v17 規格 G，自己有 15 分鐘的間隔限制）；沒傳就略過
  syncFinanceNews = null,
  // 除息前推播（v20 階段 6，台股盤中才跑、自己去重）；沒傳就略過
  remindExDividends = null,
}) {
  const router = express.Router()

  router.use((req, res, next) => {
    if (!secret) {
      res.status(503).json({ message: '排程尚未設定。' })
      return
    }
    if (!secretMatches(req.get('x-cron-secret'), secret)) {
      res.status(401).json({ message: '密鑰不正確。' })
      return
    }
    next()
  })

  router.post('/market', async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const result = { checked: 0, triggered: 0, notified: 0, snapshots: null, skipped: null }

      // 1. 只檢查有綁定通知、而且仍有金融股市權限的使用者，以及目前開盤中的市場
      const openMarkets = ['tw', 'us'].filter((market) => isMarketOpen(market, now()))
      if (openMarkets.length === 0) {
        result.skipped = '目前台股、美股都沒有開盤'
      } else {
        const userIds = await notifier.subscriberIds()
        const users = userIds.length ? await User.find({ _id: { $in: userIds } }) : []
        const allowed = users.filter((user) => user.canUseStock()).map((user) => user._id)
        const alerts = allowed.length
          ? (await MarketAlert.find({ user: { $in: allowed }, active: true })).filter((alert) =>
              openMarkets.includes(alert.target.market),
            )
          : []
        result.checked = alerts.length
        if (alerts.length) {
          const { triggered } = await evaluateAlerts(alerts, (target) => marketService.getQuote(target), {
            now,
            Model: MarketAlert.findOneAndUpdate ? MarketAlert : null,
            getSignals: marketService.getAlertSignals ? (target) => marketService.getAlertSignals(target) : null,
          })
          result.triggered = triggered.length
          result.notified = await notifier.notifyAlerts(triggered)
        }
      }

      // 2. 重大訊息（自己有 30 分鐘的間隔限制）
      if (syncNews) {
        try {
          result.news = await syncNews()
        } catch (error) {
          console.error('重大訊息同步失敗：', error.message)
        }
      }
      if (syncFinanceNews) {
        try {
          result.financeNews = await syncFinanceNews()
        } catch (error) {
          console.error('財經新聞同步失敗：', error.message)
        }
      }

      // 2b. 除息前推播
      if (remindExDividends) {
        try {
          result.exDividendReminders = await remindExDividends()
        } catch (error) {
          console.error('除息前推播失敗：', error.message)
        }
      }

      // 3. 每日資產快照（台股收盤後才記）
      if (recordSnapshots) {
        try {
          result.snapshots = await recordSnapshots()
        } catch (error) {
          console.error('資產快照失敗：', error.message)
        }
      }

      res.json(result)
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createCronRouter, secretMatches }
