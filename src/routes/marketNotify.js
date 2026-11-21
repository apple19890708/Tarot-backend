// 推播設定 API（2026-11-21 從 routes/market.js 拆出來；網址不變）：瀏覽器推播（所有人）、Discord Webhook（只給 admin）、測試通知
//   GET /notify、POST /notify/push、DELETE /notify/push/:id、PUT /notify/discord、DELETE /notify/discord、POST /notify/test
// notifier、MarketProfile 沒傳（測試）時端點回 503
const express = require('express')
const mongoose = require('mongoose')

function createMarketNotifyRouter({ requireStockAccess, ensureDatabase, notifier = null, MarketProfile = null }) {
  const router = express.Router()

  const requireNotifier = (req, res, next) => {
    if (!notifier || !MarketProfile) {
      res.status(503).json({ message: '推播通知尚未設定。' })
      return
    }
    next()
  }
  // requireStockAccess 每次都重新讀使用者，req.auth.role 是最新的
  const isAdminRequest = (req) => req.auth?.role === 'admin'
  const requireAdminRole = (req, res, next) => {
    if (!isAdminRequest(req)) {
      res.status(403).json({ message: 'Discord 通知只開放管理者使用。' })
      return
    }
    next()
  }

  router.get('/notify', requireStockAccess, requireNotifier, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      res.json(await notifier.status(req.auth.userId, { admin: isAdminRequest(req) }))
    } catch (error) {
      next(error)
    }
  })

  // 這台裝置開啟瀏覽器推播：body 是瀏覽器給的 PushSubscription（JSON）與裝置名稱
  router.post('/notify/push', requireStockAccess, requireNotifier, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const { error } = await notifier.addDevice(req.auth.userId, req.body?.subscription, req.body?.label)
      if (error) {
        res.status(400).json({ message: error })
        return
      }
      res.json(await notifier.status(req.auth.userId, { admin: isAdminRequest(req) }))
    } catch (error) {
      next(error)
    }
  })

  router.delete('/notify/push/:id', requireStockAccess, requireNotifier, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id) || !(await notifier.removeDevice(req.auth.userId, req.params.id))) {
        res.status(404).json({ message: '找不到這台裝置。' })
        return
      }
      res.json(await notifier.status(req.auth.userId, { admin: isAdminRequest(req) }))
    } catch (error) {
      next(error)
    }
  })

  // Discord：綁定（或換一個）Webhook，先送確認訊息，成功才存。回應只有遮罩後的提示，不回傳網址
  router.put('/notify/discord', requireStockAccess, requireAdminRole, requireNotifier, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const { error } = await notifier.linkDiscord(req.auth.userId, req.body?.webhookUrl)
      if (error) {
        res.status(400).json({ message: error })
        return
      }
      res.json(await notifier.status(req.auth.userId, { admin: true }))
    } catch (error) {
      next(error)
    }
  })

  router.delete('/notify/discord', requireStockAccess, requireAdminRole, requireNotifier, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      await notifier.unlinkDiscord(req.auth.userId)
      res.json(await notifier.status(req.auth.userId, { admin: true }))
    } catch (error) {
      next(error)
    }
  })

  // 測試通知：送到所有已開啟的管道
  router.post('/notify/test', requireStockAccess, requireNotifier, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const result = await notifier.sendTest(req.auth.userId)
      if (!result.push && !result.discord) {
        // 有失敗原因就直接告訴使用者；完全沒有管道才是「還沒開啟」
        if (result.errors.length) {
          res.status(502).json({ message: `沒有送出：${result.errors.join('；')}` })
        } else {
          res.status(400).json({ message: '還沒有開啟任何推播。' })
        }
        return
      }
      res.json(result)
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createMarketNotifyRouter }
