// JSON 回應的 gzip 壓縮（用 Node 內建 zlib，不加套件）。
// 為什麼：Cloud Run 不會替回應壓縮，傳出流量又是唯一可能超過免費額度的項目（北美每月 1 GB）；
// 股市、走勢這類 JSON 壓縮後約剩 20～30%。
// 只包 res.json：AI 串流（NDJSON，res.write 一段一段送）、牌卡圖片（jpg 本身已壓縮）都不經過這裡，
// 串流不會被壓縮緩衝卡住。太小的回應（< minBytes）壓了也省不了多少，照原樣送。
const zlib = require('zlib')

const MIN_BYTES = 1024

function acceptsGzip(req) {
  return /\bgzip\b/i.test(req.headers['accept-encoding'] || '')
}

function jsonCompression({ minBytes = MIN_BYTES } = {}) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res)
    res.json = (body) => {
      // 不論這次有沒有壓縮，回應內容都會因 Accept-Encoding 不同而不同，快取要分開存
      res.vary('Accept-Encoding')
      if (!acceptsGzip(req) || res.headersSent) return originalJson(body)
      const text = JSON.stringify(body)
      if (text === undefined || Buffer.byteLength(text) < minBytes) return originalJson(body)
      zlib.gzip(text, (error, zipped) => {
        if (res.headersSent || res.writableEnded) return
        if (error) {
          originalJson(body)
          return
        }
        if (!res.get('Content-Type')) res.set('Content-Type', 'application/json; charset=utf-8')
        res.set('Content-Encoding', 'gzip')
        res.set('Content-Length', String(zipped.length))
        res.end(zipped)
      })
      return res
    }
    next()
  }
}

module.exports = { jsonCompression, MIN_BYTES }
