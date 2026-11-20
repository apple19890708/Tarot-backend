// 通知中心（v26 計畫 5）：寫入一則通知。notifier（價位提醒、除息前提醒、測試推播）送推播之前先存一筆，
// 推播失敗或使用者沒開推播也照樣存。帶 key 的同一件事只存一次（網頁與排程同時觸發、送失敗下一輪重試都不重複）。
// 每人最多 200 則，超過刪最舊（D11；90 天自動刪由 model 的 TTL 索引負責）
const TITLE_MAX = 120
const BODY_MAX = 500
const URL_MAX = 200

const clip = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')

// 站內路徑：去掉開頭的 /（和推播的 url 同一種寫法，由前端補上網站前綴）；不是站內路徑就不存
function cleanUrl(value) {
  const url = clip(value, URL_MAX).replace(/^\/+/, '')
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('\\')) return ''
  return url
}

function notificationView(doc) {
  return {
    id: String(doc._id),
    kind: doc.kind,
    title: doc.title,
    body: doc.body || '',
    url: doc.url || '',
    read: Boolean(doc.readAt),
    createdAt: doc.createdAt,
  }
}

function createNotificationCenter({ Notification }) {
  const max = Notification.MAX_PER_USER ?? 200

  async function trim(userId) {
    const count = await Notification.countDocuments({ user: userId })
    if (count <= max) return
    const extra = await Notification.find({ user: userId }).sort({ _id: -1 }).skip(max).select('_id').lean()
    if (extra.length) await Notification.deleteMany({ _id: { $in: extra.map((doc) => doc._id) } })
  }

  // 回傳這次有沒有新存一則（同一個 key 已經存過回 false）
  // upsert 不跑 schema 驗證（api-reviewer），種類與 key 長度在這裡先擋，兩條路行為一致
  const kinds = Notification.KINDS ?? null
  async function record(userId, { kind, title, body = '', url = '', key = null }) {
    if (kinds && !kinds.includes(kind)) throw new Error(`通知種類不正確：${kind}`)
    if (key !== null && (typeof key !== 'string' || !key || key.length > 200)) throw new Error('通知的 key 不正確')
    const fields = { user: userId, kind, title: clip(title, TITLE_MAX) || '通知', body: clip(body, BODY_MAX), url: cleanUrl(url) }
    let created
    if (key) {
      try {
        const result = await Notification.updateOne({ user: userId, key }, { $setOnInsert: { ...fields, key, readAt: null } }, { upsert: true })
        created = (result.upsertedCount ?? 0) > 0
      } catch (error) {
        // 兩邊同時 upsert：另一邊已經存了
        if (error?.code === 11000) return false
        throw error
      }
    } else {
      await Notification.create(fields)
      created = true
    }
    if (created) await trim(userId)
    return created
  }

  return { record }
}

module.exports = { createNotificationCenter, notificationView, cleanUrl }
