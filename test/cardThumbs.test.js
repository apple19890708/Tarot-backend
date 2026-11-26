// 塔羅原版牌面的縮圖（v29 項目 5）：78 張 JPEG 都有 public/cards/thumb/<同檔名>.webp，
// 經 /cards 的靜態路由送出、快取和原圖一樣 7 天；沒有的縮圖回 404（前端會退回原圖）。
// 不 require sharp：測試只看產生好的檔案，不重新產生。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const http = require('http')
const express = require('express')
const { securityHeaders } = require('../src/lib/securityHeaders')
const { gzipStatic } = require('../src/lib/gzipStatic')
const { thumbName, WIDTH } = require('../scripts/buildCardThumbs')

const CARDS_DIR = path.join(__dirname, '..', 'public', 'cards')
const THUMB_DIR = path.join(CARDS_DIR, 'thumb')
const jpegs = fs.readdirSync(CARDS_DIR).filter((name) => /\.jpe?g$/i.test(name))

// WebP（VP8／VP8L／VP8X）標頭裡的寬度
function webpWidth(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buffer.toString('ascii', 8, 12), 'WEBP')
  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8 ') return buffer.readUInt16LE(26) & 0x3fff
  if (chunk === 'VP8L') return (((buffer[22] & 0x3f) << 8) | buffer[21]) + 1
  if (chunk === 'VP8X') return buffer.readUIntLE(24, 3) + 1
  throw new Error(`不認得的 WebP 區塊：${chunk}`)
}

test('78 張原版 JPEG 都有對應的縮圖：WebP、寬 240px、每張不超過 60KB；thumb 底下沒有多餘的檔案', () => {
  assert.equal(jpegs.length, 78)
  for (const name of jpegs) {
    const file = path.join(THUMB_DIR, thumbName(name))
    assert.ok(fs.existsSync(file), `缺縮圖：${thumbName(name)}（執行 node scripts/buildCardThumbs.js）`)
    const buffer = fs.readFileSync(file)
    assert.equal(webpWidth(buffer), WIDTH, name)
    assert.ok(buffer.length <= 60 * 1024, `${thumbName(name)} ${buffer.length} bytes`)
  }
  const expected = new Set(jpegs.map(thumbName))
  assert.deepEqual(
    fs.readdirSync(THUMB_DIR).filter((name) => !expected.has(name)),
    [],
  )
  assert.equal(thumbName('major-00-fool.jpg'), 'major-00-fool.webp')
})

test('/cards/thumb：由 express.static 送 WebP、快取 7 天、可跨網域載入；沒有的回 404；gzipStatic 不讀子資料夾', async () => {
  const app = express()
  app.use(securityHeaders())
  app.use('/cards', gzipStatic(CARDS_DIR, { maxAgeSeconds: 7 * 24 * 60 * 60 }))
  app.use('/cards', express.static(CARDS_DIR, { maxAge: '7d' }))
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  const get = (url) =>
    new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${server.address().port}${url}`, { headers: { 'Accept-Encoding': 'gzip' } }, (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
        })
        .on('error', reject)
    })
  try {
    const thumb = await get('/cards/thumb/major-00-fool.webp')
    assert.equal(thumb.status, 200)
    assert.match(thumb.headers['content-type'], /^image\/webp/)
    assert.equal(thumb.headers['content-encoding'], undefined)
    assert.match(thumb.headers['cache-control'], /max-age=604800/)
    assert.equal(thumb.headers['cross-origin-resource-policy'], 'cross-origin')
    assert.equal(thumb.body.length, fs.statSync(path.join(THUMB_DIR, 'major-00-fool.webp')).size)

    // 水彩 SVG 沒有縮圖：回 404，前端退回原圖
    assert.equal((await get('/cards/thumb/major-00-fool.svg')).status, 404)
    assert.equal((await get('/cards/thumb/not-a-card.webp')).status, 404)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  assert.equal(gzipStatic(CARDS_DIR, { maxAgeSeconds: 60 }).files.has('/thumb'), false)
})
