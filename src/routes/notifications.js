// 通知中心 API（v26 計畫 5）。全部要登入，只看得到、只動得到自己的：
//   GET    /notifications?before=<id>&limit=30   新到舊，一次最多 50 則；before 是上一頁最後一則的 id（載入更多）
//   GET    /notifications/unread-count           未讀幾則（頂欄鈴鐺；前端換頁、回到前景、每 60 秒查一次）
//   PUT    /notifications/read                   標成已讀 { ids?: string[] }；沒給 ids 就是全部
//   DELETE /notifications/:id                    刪一則
//   DELETE /notifications?read=true              清除已讀（沒帶 read=true 不收，不提供一次刪全部）
// 寫入在 services/notificationCenter.js（由 notifier 呼叫），這裡沒有新增的 API。依賴可以注入，測試不必連資料庫
const express = require('express')
const mongoose = require('mongoose')

const NotificationModel = require('../models/Notification')
const { notificationView } = require('../services/notificationCenter')

const PAGE_DEFAULT = 30
const PAGE_MAX = 50
const IDS_MAX = 200

function createNotificationsRouter({ ensureDatabase, requireAuth, Notification = NotificationModel }) {
  const router = express.Router()

  router.get('/notifications', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const limit = Math.min(PAGE_MAX, Math.max(1, Number.parseInt(req.query.limit, 10) || PAGE_DEFAULT))
      const filter = { user: req.auth.userId }
      if (req.query.before !== undefined) {
        if (typeof req.query.before !== 'string' || !mongoose.isValidObjectId(req.query.before)) {
          res.status(400).json({ message: '分頁參數不正確。' })
          return
        }
        filter._id = { $lt: new mongoose.Types.ObjectId(req.query.before) }
      }
      // 多拿一則判斷還有沒有下一頁
      const docs = await Notification.find(filter).sort({ _id: -1 }).limit(limit + 1).lean()
      res.json({ notifications: docs.slice(0, limit).map(notificationView), hasMore: docs.length > limit })
    } catch (error) {
      next(error)
    }
  })

  router.get('/notifications/unread-count', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const count = await Notification.countDocuments({ user: req.auth.userId, readAt: null })
      res.json({ count })
    } catch (error) {
      next(error)
    }
  })

  router.put('/notifications/read', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const ids = req.body?.ids
      const filter = { user: req.auth.userId, readAt: null }
      if (ids !== undefined) {
        if (!Array.isArray(ids) || ids.length > IDS_MAX || !ids.every((id) => typeof id === 'string' && mongoose.isValidObjectId(id))) {
          res.status(400).json({ message: '要標成已讀的通知不正確。' })
          return
        }
        if (!ids.length) {
          res.json({ updated: 0 })
          return
        }
        filter._id = { $in: ids }
      }
      const result = await Notification.updateMany(filter, { $set: { readAt: new Date() } })
      res.json({ updated: result.modifiedCount ?? 0 })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/notifications/:id', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這則通知。' })
        return
      }
      const result = await Notification.deleteOne({ _id: req.params.id, user: req.auth.userId })
      if (result.deletedCount === 0) {
        res.status(404).json({ message: '找不到這則通知。' })
        return
      }
      res.json({ deleted: true })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/notifications', requireAuth, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (req.query.read !== 'true') {
        res.status(400).json({ message: '只能清除已讀的通知。' })
        return
      }
      const result = await Notification.deleteMany({ user: req.auth.userId, readAt: { $ne: null } })
      res.json({ deleted: result.deletedCount ?? 0 })
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createNotificationsRouter }
