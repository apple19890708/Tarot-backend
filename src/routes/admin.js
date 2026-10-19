// 管理者專用路由。掛載時整個 router 都會先過 requireAdmin。
const express = require('express')
const mongoose = require('mongoose')

const User = require('../models/User')

const PAGE_SIZE_DEFAULT = 20
const PAGE_SIZE_MAX = 100

function createAdminRouter({ ensureDatabase, requireAdmin }) {
  const router = express.Router()

  router.use(requireAdmin)

  router.get('/users', async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) {
        return
      }

      const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1)
      const requestedSize = Number.parseInt(req.query.pageSize || '', 10)
      const pageSize = Math.min(
        PAGE_SIZE_MAX,
        Math.max(1, Number.isNaN(requestedSize) ? PAGE_SIZE_DEFAULT : requestedSize),
      )

      const [total, users] = await Promise.all([
        User.countDocuments(),
        User.find()
          .sort({ createdAt: -1 })
          .skip((page - 1) * pageSize)
          .limit(pageSize),
      ])

      res.json({
        page,
        pageSize,
        total,
        users: users.map((user) => user.toPublicJSON()),
      })
    } catch (error) {
      next(error)
    }
  })

  // 開通／收回某個會員的 AI 解析權限
  router.patch('/users/:id/ai-access', async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) {
        return
      }

      if (typeof req.body.allowed !== 'boolean') {
        res.status(400).json({ message: 'allowed 必須是 true 或 false。' })
        return
      }

      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這位使用者。' })
        return
      }

      const user = await User.findById(req.params.id)
      if (!user) {
        res.status(404).json({ message: '找不到這位使用者。' })
        return
      }

      // admin 本來就有權限，不需要也不應該被這支關掉
      if (user.role === 'admin') {
        res.status(409).json({ message: '管理者本來就能使用 AI 解析，不需要開通。' })
        return
      }

      user.aiAccess = req.body.allowed
      await user.save()

      res.json({ user: user.toPublicJSON() })
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createAdminRouter }
