// 價位提醒的推播，兩個管道：
// - 瀏覽器推播（Web Push）：所有會員都能用。一台裝置一筆訂閱，同一個會員可以有多台
// - Discord Webhook：只給 admin（設定要貼 webhook 網址，不適合一般會員）。綁定、顯示、送出都檢查 admin
//
// Webhook 網址等於密碼，只存在資料庫，對外只回遮罩後的提示。
const { alertMessage, alertPushPayload } = require('./alertChecker')
const { maskWebhook, parseWebhookUrl } = require('../discord')
const { PushGoneError, parseSubscription } = require('../webPush')

// MarketAlert：有傳時用條件式更新搶 notifiedAt，網頁與排程同時觸發也只推播一次
function createNotifier({ discord, webPush, MarketProfile, PushSubscription, User, MarketAlert = null, now = () => new Date() }) {
  async function claim(alert) {
    if (!MarketAlert) return true
    const result = await MarketAlert.updateOne({ _id: alert._id, notifiedAt: null }, { $set: { notifiedAt: now() } })
    return result.modifiedCount === 1
  }
  async function release(alert) {
    if (MarketAlert) await MarketAlert.updateOne({ _id: alert._id }, { $set: { notifiedAt: null } })
  }

  async function isAdmin(userId) {
    const user = await User.findById(userId)
    return user?.role === 'admin'
  }

  async function status(userId, { admin = false } = {}) {
    const devices = await PushSubscription.find({ user: userId }).sort({ createdAt: 1 })
    const result = {
      push: {
        available: webPush.available,
        publicKey: webPush.publicKey,
        devices: devices.map((d) => ({ id: String(d._id), label: d.label || '', endpoint: d.endpoint, createdAt: d.createdAt })),
      },
      // 不是 admin 就完全不回 Discord 的資訊
      discord: null,
    }
    if (admin) {
      const profile = await MarketProfile.findOne({ user: userId })
      const url = profile?.discord?.webhookUrl || null
      result.discord = { linked: Boolean(url), linkedAt: url ? profile.discord.linkedAt : null, hint: url ? maskWebhook(url) : null }
    }
    return result
  }

  // ---- 瀏覽器推播 ----

  async function addDevice(userId, rawSubscription, label = '') {
    if (!webPush.available) return { error: '伺服器還沒設定瀏覽器推播。' }
    const subscription = parseSubscription(rawSubscription)
    if (!subscription) return { error: '這個瀏覽器的推播訂閱格式不正確。' }
    const existing = await PushSubscription.findOne({ endpoint: subscription.endpoint })
    if (!existing || String(existing.user) !== String(userId)) {
      const count = await PushSubscription.countDocuments({ user: userId })
      if (count >= PushSubscription.MAX_DEVICES_PER_USER) {
        return { error: `最多 ${PushSubscription.MAX_DEVICES_PER_USER} 台裝置，請先移除不用的。` }
      }
    }
    // 同一台裝置換帳號登入時，改掛到目前的帳號（endpoint 全域唯一）
    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      { $set: { user: userId, keys: subscription.keys, label: typeof label === 'string' ? label.slice(0, 60) : '' } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    return {}
  }

  async function removeDevice(userId, deviceId) {
    const result = await PushSubscription.deleteOne({ _id: deviceId, user: userId })
    return result.deletedCount > 0
  }

  // 送到這個會員的每一台裝置；失效的訂閱順手刪掉。回傳 { sent: 成功台數, removed: 刪掉的失效訂閱數, errors: 失敗原因 }
  async function pushToUser(userId, payload) {
    const result = { sent: 0, removed: 0, errors: [] }
    if (!webPush.available) return result
    const devices = await PushSubscription.find({ user: userId })
    for (const device of devices) {
      try {
        await webPush.send({ endpoint: device.endpoint, keys: device.keys }, payload)
        result.sent += 1
      } catch (error) {
        if (error instanceof PushGoneError) {
          await PushSubscription.deleteOne({ _id: device._id })
          result.removed += 1
        } else {
          console.error('瀏覽器推播失敗：', error.message)
          result.errors.push(`${device.label || '裝置'}：${error.message}`)
        }
      }
    }
    return result
  }

  // ---- Discord（只給 admin）----

  // 先送確認訊息，送得出去才存（網址打錯、webhook 被刪掉都會在這裡發現）
  async function linkDiscord(userId, rawUrl) {
    const parsed = parseWebhookUrl(rawUrl)
    if (!parsed) return { error: 'Webhook 網址格式不正確，應該是 https://discord.com/api/webhooks/… 開頭。' }
    try {
      await discord.send(parsed.url, '✅ 綁定完成。價位提醒到價時會在這個頻道通知你。')
    } catch (error) {
      return { error: `送不出確認訊息：${error.message}` }
    }
    await MarketProfile.findOneAndUpdate(
      { user: userId },
      { $set: { 'discord.webhookUrl': parsed.url, 'discord.linkedAt': now() } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )
    return {}
  }

  async function unlinkDiscord(userId) {
    await MarketProfile.updateOne({ user: userId }, { $set: { 'discord.webhookUrl': null, 'discord.linkedAt': null } })
  }

  async function discordUrlOf(userId) {
    if (!(await isAdmin(userId))) return null
    const profile = await MarketProfile.findOne({ user: userId })
    return profile?.discord?.webhookUrl || null
  }

  // ---- 共用 ----

  // 測試通知：送到所有已開啟的管道。回傳 { push: 台數, discord: 是否送出 }
  // 測試通知：送到所有已開啟的管道。失敗的原因放在 errors，畫面上才知道是哪裡出問題
  async function sendTest(userId) {
    const push = await pushToUser(userId, { title: '測試通知', body: '價位提醒到價時會像這樣通知你。', url: 'market?tab=alerts' })
    const errors = [...push.errors]
    if (push.removed) errors.push(`有 ${push.removed} 台裝置的通知已經失效（可能關掉了通知或清除了瀏覽器資料），已自動移除，請重新開啟。`)
    let sentDiscord = false
    const url = await discordUrlOf(userId)
    if (url) {
      try {
        await discord.send(url, '這是測試通知：價位提醒到價時會像這樣通知你。')
        sentDiscord = true
      } catch (error) {
        errors.push(`Discord：${error.message}`)
      }
    }
    return { push: push.sent, discord: sentDiscord, errors }
  }

  // 有開啟任何推播的會員（排程只檢查這些人的提醒）
  async function subscriberIds() {
    const [pushUsers, profiles] = await Promise.all([
      PushSubscription.distinct('user'),
      MarketProfile.find({ 'discord.webhookUrl': { $ne: null } }),
    ])
    // Discord 只給 admin：被降級的人留著的 webhook 不算（不然排程每一輪都要白跑一次「送不出去」，v20 審查）
    // 綁 Discord 的人很少（只有 admin 能綁），逐一用 isAdmin 確認即可
    const discordUsers = profiles.map((p) => p.user)
    const admins = (await Promise.all(discordUsers.map(async (id) => ((await isAdmin(id)) ? id : null)))).filter(Boolean)
    const ids = new Map([...pushUsers, ...admins].map((id) => [String(id), id]))
    return [...ids.values()]
  }

  // 已觸發、還沒通知過的提醒逐一推播；任一管道成功就記 notifiedAt。回傳送出的提醒數
  async function notifyAlerts(alerts) {
    const pending = alerts.filter((alert) => !alert.notifiedAt)
    if (pending.length === 0) return 0
    const discordUrls = new Map()
    for (const userId of new Set(pending.map((alert) => String(alert.user)))) {
      discordUrls.set(userId, await discordUrlOf(userId))
    }
    let sent = 0
    for (const alert of pending) {
      try {
        // 先搶下這筆（另一邊已經在送就跳過）；全部管道都失敗再放掉，下次重試
        if (!(await claim(alert))) continue
        let delivered = (await pushToUser(alert.user, alertPushPayload(alert))).sent > 0
        const url = discordUrls.get(String(alert.user))
        if (url) {
          try {
            await discord.send(url, alertMessage(alert))
            delivered = true
          } catch (error) {
            // 不印出網址
            console.error('Discord 推播失敗：', error.message)
          }
        }
        if (delivered) {
          alert.notifiedAt = now()
          if (!MarketAlert) await alert.save()
          sent += 1
        } else {
          await release(alert)
        }
      } catch (error) {
        console.error('提醒推播失敗：', error.message)
      }
    }
    return sent
  }

  // 一則一般通知（v20 除息前推播）：瀏覽器推播＋admin 的 Discord。任一管道送出回 true
  async function notifyUser(userId, { title, body, url }) {
    let delivered = (await pushToUser(userId, { title, body, url })).sent > 0
    const discordUrl = await discordUrlOf(userId)
    if (discordUrl) {
      try {
        await discord.send(discordUrl, `${title}\n${body}`)
        delivered = true
      } catch (error) {
        // 不印出網址
        console.error('Discord 推播失敗：', error.message)
      }
    }
    return delivered
  }

  return { status, addDevice, removeDevice, linkDiscord, unlinkDiscord, sendTest, subscriberIds, notifyAlerts, notifyUser }
}

module.exports = { createNotifier }
