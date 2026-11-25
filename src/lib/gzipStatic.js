// 預先壓縮的靜態文字檔（v27 雷諾曼牌面 SVG）。
// express.static 不做 gzip，jsonCompression 也只處理 res.json；SVG 是純文字，gzip 後只剩約 2 成（557KB → 約 102KB），
// 傳出流量是 Cloud Run 免費額度最容易超過的項目（CLAUDE.md），所以啟動時把資料夾裡的檔案壓好放在記憶體。
//
// - 只處理 GET／HEAD、檔名在清單裡、而且瀏覽器接受 gzip 的請求；其他一律 next()，交給後面的 express.static（不支援 gzip 的舊瀏覽器照樣拿得到原檔）。
// - 帶 ETag，瀏覽器重新驗證時回 304。
// - 記憶體：只放壓縮後的內容（雷諾曼 52 張合計約 100KB），啟動時壓一次，不會每個請求重壓。
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const zlib = require('zlib')
const { acceptsGzip } = require('./acceptEncoding')

const TYPES = { '.svg': 'image/svg+xml; charset=utf-8' }

function loadCompressed(dir, extensions) {
  const files = new Map()
  if (!fs.existsSync(dir)) return files
  for (const name of fs.readdirSync(dir)) {
    const ext = path.extname(name).toLowerCase()
    if (!extensions.includes(ext) || name.startsWith('.')) continue
    const raw = fs.readFileSync(path.join(dir, name))
    const body = zlib.gzipSync(raw, { level: 9 })
    const etag = `"gz-${crypto.createHash('sha1').update(raw).digest('base64url').slice(0, 20)}"`
    files.set(`/${name}`, { body, etag, type: TYPES[ext] })
  }
  return files
}

// maxAgeSeconds：瀏覽器快取秒數，和後面 express.static 的 maxAge 一致
function gzipStatic(dir, { maxAgeSeconds, extensions = ['.svg'] } = {}) {
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 0) throw new Error('gzipStatic 需要 maxAgeSeconds（整數秒）。')
  const files = loadCompressed(dir, extensions)

  function middleware(req, res, next) {
    // 壓不壓縮會因 Accept-Encoding 不同，快取（瀏覽器、CDN）要分開存；沒壓縮、交給 express.static 的回應也要帶
    res.vary('Accept-Encoding')
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    const file = files.get(req.path)
    if (!file || !acceptsGzip(req)) return next()

    res.set({
      'Content-Type': file.type,
      'Content-Encoding': 'gzip',
      'Cache-Control': `public, max-age=${maxAgeSeconds}`,
      ETag: file.etag,
    })
    if (req.fresh) {
      res.status(304).end()
      return
    }
    res.set('Content-Length', String(file.body.length))
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(file.body)
  }

  middleware.files = files
  return middleware
}

module.exports = { gzipStatic }
