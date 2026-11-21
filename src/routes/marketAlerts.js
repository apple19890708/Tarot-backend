// 價位提醒 API（2026-11-21 從 routes/market.js 拆出來；網址不變，由 createMarketRouter 掛在 /api/market 底下）：
//   GET /alerts、POST /alerts、POST /alerts/:id/reactivate、DELETE /alerts/:id、POST /alerts/check
// 檢查到價時先存進通知中心，再送推播（v26 計畫 5）
const express = require('express')
const mongoose = require('mongoose')

const { evaluateAlerts, describeAlert, checkCondition } = require('../services/market/alertChecker')
const { isTarget, pickTarget, resolveFromRequest } = require('./marketHelpers')

function alertJSON(alert) {
  return {
    id: String(alert._id),
    target: alert.target,
    kind: alert.kind || 'price',
    condition: alert.condition,
    price: alert.price,
    params: alert.params && alert.params.direction ? { direction: alert.params.direction, value: alert.params.value ?? null, period: alert.params.period ?? null } : null,
    // 條件的文字（後端產生，前端直接顯示）
    description: describeAlert(alert),
    note: alert.note || '',
    active: alert.active,
    triggeredAt: alert.triggeredAt,
    triggeredPrice: alert.triggeredPrice,
    triggeredNote: alert.triggeredNote || '',
    notifiedAt: alert.notifiedAt || null,
    createdAt: alert.createdAt,
  }
}

// 提醒條件的驗證：回傳要存的欄位，或 { error }
function resolveAlertCondition(body) {
  const kind = body.kind === undefined ? 'price' : body.kind
  const p = body.params && typeof body.params === 'object' ? body.params : {}
  const value = Number(p.value)
  const empty = { condition: null, price: null, params: { direction: null, value: null, period: null } }
  switch (kind) {
    case 'price': {
      const price = Number(body.price)
      if (!['above', 'below'].includes(body.condition) || !Number.isFinite(price) || price <= 0) return { error: '提醒條件或價格不正確。' }
      return { ...empty, kind, condition: body.condition, price }
    }
    case 'changePct':
      if (!['up', 'down'].includes(p.direction) || !Number.isFinite(value) || value <= 0 || value > 20) return { error: '漲跌幅要在 0～20% 之間。' }
      return { ...empty, kind, params: { direction: p.direction, value, period: null } }
    case 'ma': {
      const period = Number(p.period)
      if (!['above', 'below'].includes(p.direction) || ![20, 60].includes(period)) return { error: '均線條件不正確（站上或跌破 MA20／MA60）。' }
      return { ...empty, kind, params: { direction: p.direction, value: null, period } }
    }
    case 'kd':
      if (!['golden', 'dead'].includes(p.direction)) return { error: 'KD 條件要選黃金交叉或死亡交叉。' }
      return { ...empty, kind, params: { direction: p.direction, value: null, period: null } }
    case 'rsi':
      if (!['above', 'below'].includes(p.direction) || !Number.isFinite(value) || value <= 0 || value >= 100) return { error: 'RSI 門檻要在 0～100 之間。' }
      return { ...empty, kind, params: { direction: p.direction, value, period: null } }
    case 'volume':
      if (!Number.isFinite(value) || value < 1 || value > 20) return { error: '量比要在 1～20 倍之間。' }
      return { ...empty, kind, params: { direction: 'above', value, period: null } }
    default:
      return { error: '不支援這種提醒條件。' }
  }
}

function createMarketAlertsRouter({ requireStockAccess, ensureDatabase, marketService, MarketAlert, notifier = null }) {
  const router = express.Router()

  router.get('/alerts', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const alerts = await MarketAlert.find({ user: req.auth.userId }).sort({ createdAt: -1 })
      res.json({ alerts: alerts.map(alertJSON) })
    } catch (error) {
      next(error)
    }
  })

  // 建立：帶 target（從操作建議一鍵設定）或 query（手動輸入代號或名稱）
  router.post('/alerts', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const { note } = req.body
      const condition = resolveAlertCondition(req.body)
      if (condition.error) {
        res.status(400).json({ message: condition.error })
        return
      }

      let target = null
      if (isTarget(req.body.target)) {
        target = await resolveFromRequest(marketService, req.body, req.body.target.market)
      } else if (typeof req.body.query === 'string' && req.body.query.trim()) {
        const found = await marketService.resolveTarget(req.body.query.trim().slice(0, 50))
        target = found ? pickTarget(found) : null
      }
      if (!target) {
        res.status(400).json({ message: '找不到這個標的，請輸入股票代號或名稱（例如 2330、台積電、$NVDA）。' })
        return
      }

      const count = await MarketAlert.countDocuments({ user: req.auth.userId })
      if (count >= MarketAlert.MAX_ALERTS_PER_USER) {
        res.status(400).json({ message: `提醒最多 ${MarketAlert.MAX_ALERTS_PER_USER} 個，請先刪除不需要的。` })
        return
      }

      // 均線提醒：先記下目前在均線哪一側，之後穿越才觸發（查不到就等第一次檢查時再記）
      let lastSide = null
      if (condition.kind === 'ma' && marketService.getAlertSignals) {
        try {
          const signals = await marketService.getAlertSignals(target)
          lastSide = signals ? checkCondition({ kind: 'ma', params: condition.params }, signals).side || null : null
        } catch (error) {
          console.error('均線提醒的初始狀態失敗：', error.message)
        }
      }

      const alert = await MarketAlert.create({
        user: req.auth.userId,
        target,
        ...condition,
        lastSide,
        note: typeof note === 'string' ? note.slice(0, 100) : '',
      })
      res.status(201).json({ alert: alertJSON(alert) })
    } catch (error) {
      next(error)
    }
  })

  // 重新啟用已觸發的提醒（清掉觸發紀錄；均線提醒的側別重新記錄）
  router.post('/alerts/:id/reactivate', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這個提醒。' })
        return
      }
      const alert = await MarketAlert.findOneAndUpdate(
        { _id: req.params.id, user: req.auth.userId },
        { $set: { active: true, triggeredAt: null, triggeredPrice: null, triggeredNote: '', notifiedAt: null, lastSide: null } },
        { new: true },
      )
      if (!alert) {
        res.status(404).json({ message: '找不到這個提醒。' })
        return
      }
      res.json({ alert: alertJSON(alert) })
    } catch (error) {
      next(error)
    }
  })

  router.delete('/alerts/:id', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(404).json({ message: '找不到這個提醒。' })
        return
      }
      const result = await MarketAlert.deleteOne({ _id: req.params.id, user: req.auth.userId })
      if (result.deletedCount === 0) {
        res.status(404).json({ message: '找不到這個提醒。' })
        return
      }
      res.json({ deleted: true })
    } catch (error) {
      next(error)
    }
  })

  // 檢查還沒觸發的提醒；回傳全部提醒與這次新觸發的
  router.post('/alerts/check', requireStockAccess, async (req, res, next) => {
    try {
      if (!ensureDatabase(res)) return
      const alerts = await MarketAlert.find({ user: req.auth.userId, active: true })
      // 同一個標的只查一次；和外部排程共用同一套判斷
      const { triggered, quotes } = await evaluateAlerts(alerts, (target) => marketService.getQuote(target), {
        Model: MarketAlert,
        getSignals: marketService.getAlertSignals ? (target) => marketService.getAlertSignals(target) : null,
      })
      // 先存進通知中心（回應前存好，網頁收到到價提示時鈴鐺的未讀數也對得上；失敗只記 log）
      const recorded = Boolean(notifier?.recordAlerts && triggered.length)
      if (recorded) await notifier.recordAlerts(triggered)
      // 有開啟推播的話也送出（手機上不一定開著這個網頁）；失敗不影響回應
      if (notifier && triggered.length) {
        notifier.notifyAlerts(triggered, { recorded }).catch((error) => console.error('提醒推播失敗：', error.message))
      }

      const all = await MarketAlert.find({ user: req.auth.userId }).sort({ createdAt: -1 })
      res.json({
        alerts: all.map(alertJSON),
        triggered: triggered.map(alertJSON),
        // 每個標的目前的價格，畫面上顯示「距離提醒價還有多少」
        prices: Object.fromEntries([...quotes.entries()].filter(([, q]) => q).map(([key, q]) => [key, q.price])),
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}

module.exports = { createMarketAlertsRouter, alertJSON }
