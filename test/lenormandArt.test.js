// 雷諾曼原創牌面（v27 階段 2）：52 個 SVG 檔存在且和來源一致、格式合法、大小在上限內、朝向有填
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const http = require('http')
const zlib = require('zlib')
const express = require('express')

const { cards, cardById } = require('../src/data/lenormand/cards')
const { securityHeaders } = require('../src/lib/securityHeaders')
const { gzipStatic } = require('../src/lib/gzipStatic')
const { acceptsGzip } = require('../src/lib/acceptEncoding')
const shapes = require('../scripts/lenormand/lib/shapes')
const { buildCardSvg } = require('../scripts/lenormand/lib/frame')
const { motifFileOf, MAX_BYTES } = require('../scripts/lenormand/buildCardArt')

const PUBLIC = path.join(__dirname, '..', 'public')
const fileOf = (card) => path.join(PUBLIC, card.image)

// 有方向感的牌：畫的時候就決定朝左或朝右（計畫書 3-3）
const DIRECTIONAL = [1, 3, 7, 10, 12, 13, 14, 15, 17, 18, 28, 29]

// 簡單的標籤配對檢查（不為了測試加 XML 套件）：開、關標籤要成對，自我結束的不算
function unbalancedTags(svg) {
  const stack = []
  const tagPattern = /<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g
  let match
  while ((match = tagPattern.exec(svg))) {
    const [, closing, name, , selfClosing] = match
    if (selfClosing) continue
    if (!closing) {
      stack.push(name)
      continue
    }
    if (stack.pop() !== name) return `多了 </${name}>`
  }
  return stack.length ? `沒關上：${stack.join(', ')}` : null
}

test('牌面：52 個檔案都在 public/lenormand/，檔名和 cards.js 的 image 一致，沒有多餘的檔', () => {
  for (const card of cards) assert.ok(fs.existsSync(fileOf(card)), `#${card.id} 缺 ${card.image}`)
  const files = fs.readdirSync(path.join(PUBLIC, 'lenormand')).sort()
  assert.deepEqual(files, cards.map((c) => path.basename(c.image)).sort())
})

test('牌面：合法的 SVG（7:12、標籤成對、沒有腳本或外部資源），每張不超過 30KB', () => {
  for (const card of cards) {
    const svg = fs.readFileSync(fileOf(card), 'utf8')
    const label = `#${card.id} ${card.slug}`
    assert.ok(Buffer.byteLength(svg) <= MAX_BYTES, `${label} 太大：${Buffer.byteLength(svg)}`)
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 350 600"/, label)
    assert.ok(svg.endsWith('</svg>'), label)
    assert.equal(unbalancedTags(svg), null, label)
    assert.doesNotMatch(svg, /<script|<image|<foreignObject|\bon[a-z]+=|href=|@import|url\((?!#)/i, `${label} 有腳本或外部資源`)
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${label} 有算錯的數字`)
    // 每張的 id 有前綴，同一頁內嵌多張也不會互相蓋掉
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])
    const prefix = `ln${String(card.id).padStart(2, '0')}`
    assert.ok(ids.length > 0 && ids.every((id) => id.startsWith(prefix)), `${label} id 沒有前綴`)
    assert.ok(svg.includes(`>${card.nameZh}</text>`), `${label} 沒有中文名`)
  }
})

test('牌面：檔案和來源一致（改了主圖或牌框要重跑 node scripts/lenormand/buildCardArt.js）', () => {
  for (const card of cards) {
    const motif = require(motifFileOf(card))
    const expected = buildCardSvg(card, motif.draw(shapes))
    assert.equal(fs.readFileSync(fileOf(card), 'utf8'), expected, `#${card.id} ${card.slug} 的 SVG 過期了`)
  }
})

test('牌面：撲克標記只畫在有 playingCard 的牌（37～52 不畫）', () => {
  for (const card of cards) {
    const svg = fs.readFileSync(fileOf(card), 'utf8')
    const hasPip = svg.includes('rotate(180 175 300)')
    assert.equal(hasPip, card.playingCard !== null, `#${card.id}`)
  }
})

test('朝向：有方向感的牌都有填 facing，和主圖宣告的一致；紳士朝右、淑女朝左（相鄰時對視）', () => {
  for (const id of DIRECTIONAL) {
    assert.ok(['left', 'right'].includes(cardById.get(id).facing), `#${id} 沒填朝向`)
  }
  for (const card of cards) {
    const motif = require(motifFileOf(card))
    assert.equal(motif.facing ?? null, card.facing, `#${card.id} 主圖朝向和 cards.js 不一致`)
    assert.ok(card.facing === null || ['left', 'right'].includes(card.facing))
  }
  assert.equal(cardById.get(28).facing, 'right')
  assert.equal(cardById.get(29).facing, 'left')
})

test('靜態路由：SVG 以 image/svg+xml 提供、gzip 壓縮、可以跨網域載入、瀏覽器快取 7 天；不接受 gzip 的拿原檔', async () => {
  // 和 server.js 同樣的設定：全站 securityHeaders ＋ /lenormand 先 gzipStatic 再 express.static
  const dir = path.join(PUBLIC, 'lenormand')
  const app = express()
  app.use(securityHeaders())
  app.use('/lenormand', gzipStatic(dir, { maxAgeSeconds: 7 * 24 * 60 * 60 }))
  app.use('/lenormand', express.static(dir, { maxAge: '7d' }))
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  const raw = fs.readFileSync(fileOf(cards[0]))
  // 用 node:http 才看得到原始的壓縮內容（fetch 會自動解壓）
  const get = (headers, method = 'GET') =>
    new Promise((resolve, reject) => {
      http
        .request(`${base}${cards[0].image}`, { method, headers }, (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
        })
        .on('error', reject)
        .end()
    })
  try {
    const gz = await get({ 'Accept-Encoding': 'gzip, deflate, br' })
    assert.equal(gz.status, 200)
    assert.equal(gz.headers['content-encoding'], 'gzip')
    assert.match(gz.headers['content-type'], /^image\/svg\+xml/)
    assert.match(gz.headers.vary, /Accept-Encoding/i)
    assert.equal(gz.headers['cross-origin-resource-policy'], 'cross-origin')
    assert.match(gz.headers['cache-control'], /max-age=604800/)
    assert.deepEqual(zlib.gunzipSync(gz.body), raw)
    assert.ok(gz.body.length < raw.length * 0.5, `壓縮後 ${gz.body.length}，原本 ${raw.length}`)

    // 重新驗證：ETag 一樣回 304
    const again = await get({ 'Accept-Encoding': 'gzip', 'If-None-Match': gz.headers.etag })
    assert.equal(again.status, 304)
    assert.equal(again.body.length, 0)

    const head = await get({ 'Accept-Encoding': 'gzip' }, 'HEAD')
    assert.equal(head.status, 200)
    assert.equal(head.body.length, 0)

    // 不接受 gzip（沒帶、或 gzip;q=0）：express.static 送原檔，同樣有快取與 Vary
    for (const headers of [{ 'Accept-Encoding': 'identity' }, { 'Accept-Encoding': 'gzip;q=0' }]) {
      const plain = await get(headers)
      assert.equal(plain.status, 200)
      assert.equal(plain.headers['content-encoding'], undefined)
      assert.deepEqual(plain.body, raw)
      assert.match(plain.headers['cache-control'], /max-age=604800/)
      assert.match(plain.headers.vary, /Accept-Encoding/i)
    }

    // 不存在的檔、路徑穿越都不會被 gzipStatic 回應
    assert.equal((await fetch(`${base}/lenormand/nope.svg`)).status, 404)
    assert.equal((await fetch(`${base}/lenormand/..%2Fcards%2Fcups-01.jpg`)).status, 404)
  } finally {
    // keep-alive 連線不等它逾時（約 3 秒），直接關掉
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  // server.js 真的有掛這兩條
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8')
  assert.match(serverSource, /app\.use\('\/lenormand', gzipStatic\(LENORMAND_DIR, \{ maxAgeSeconds: 7 \* 24 \* 60 \* 60 \}\)\)/)
  assert.match(serverSource, /app\.use\('\/lenormand', express\.static\(LENORMAND_DIR, \{ maxAge: '7d' \}\)\)/)
})

test('gzipStatic：Accept-Encoding 判斷與啟動時壓好的檔案清單', () => {
  const yes = (v) => acceptsGzip({ headers: { 'accept-encoding': v } })
  assert.equal(yes('gzip'), true)
  assert.equal(yes('br, gzip;q=0.5'), true)
  assert.equal(yes('*'), true)
  assert.equal(yes('gzip;q=0'), false)
  // 明確拒絕 gzip 時，* 不能把它加回來（RFC 9110）；jsonCompression 也共用這個判斷
  assert.equal(yes('gzip;q=0, *'), false)
  assert.equal(yes('br;q=1, *;q=0.1'), true)
  assert.equal(yes('*;q=0'), false)
  assert.equal(yes('GZIP'), true)
  assert.equal(yes('identity'), false)
  assert.equal(acceptsGzip({ headers: {} }), false)
  const middleware = gzipStatic(path.join(PUBLIC, 'lenormand'), { maxAgeSeconds: 60 })
  assert.equal(middleware.files.size, 52)
  const total = [...middleware.files.values()].reduce((sum, f) => sum + f.body.length, 0)
  assert.ok(total < 160 * 1024, `52 張壓縮後合計 ${total} bytes`)
  assert.throws(() => gzipStatic(PUBLIC, {}), /maxAgeSeconds/)
})
