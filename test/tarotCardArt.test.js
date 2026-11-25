// 塔羅原創牌面（v28）：檔名和現有 jpg 一一對應、SVG 合法、大小在上限內、檔案和來源一致
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')

const { cards } = require('../scripts/tarot/cards')
const { resolveImageSource } = require('../scripts/cardImageSources')
const { renderCard, hasMotif, MAX_BYTES } = require('../scripts/tarot/buildCardArt')
const { idOf } = require('../scripts/tarot/lib/frame')
const http = require('http')
const zlib = require('zlib')
const express = require('express')
const { securityHeaders } = require('../src/lib/securityHeaders')
const { gzipStatic } = require('../src/lib/gzipStatic')

const CARDS_DIR = path.join(__dirname, '..', 'public', 'cards')
const svgOf = (card) => path.join(CARDS_DIR, `${card.key}.svg`)

// 開、關標籤要成對（和 lenormandArt.test.js 同一個簡單檢查，不為了測試加 XML 套件）
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

test('清單：78 張（大牌 22＋四花色各 14），檔名和 public/cards 的 jpg 一一對應、只差副檔名', () => {
  assert.equal(cards.length, 78)
  assert.equal(cards.filter((c) => c.arcanaType === 'major').length, 22)
  for (const suit of ['wands', 'cups', 'swords', 'pentacles']) assert.equal(cards.filter((c) => c.suit === suit).length, 14)
  assert.equal(new Set(cards.map((c) => c.key)).size, 78)
  assert.equal(new Set(cards.map((c) => idOf(c))).size, 78)
  for (const card of cards) {
    const jpg = resolveImageSource(card).localFile
    assert.equal(jpg, `${card.key}.jpg`, card.key)
    assert.ok(fs.existsSync(path.join(CARDS_DIR, jpg)), `舊圖 ${jpg} 要保留`)
    assert.equal(card.image, `/cards/${card.key}.svg`)
  }
})

test('78 張都已經畫好；public/cards 沒有多餘的 SVG', () => {
  for (const card of cards) {
    assert.ok(hasMotif(card), `${card.key} 還沒畫`)
    assert.ok(fs.existsSync(svgOf(card)), `${card.key} 沒有產生 SVG`)
  }
  const svgs = fs.readdirSync(CARDS_DIR).filter((name) => name.endsWith('.svg'))
  const known = new Set(cards.map((c) => `${c.key}.svg`))
  assert.deepEqual(svgs.filter((name) => !known.has(name)), [])
  assert.equal(svgs.length, 78)
})

test('牌面：合法的 SVG（7:12、標籤成對、沒有腳本或外部資源），每張不超過 30KB，檔案和來源一致', () => {
  for (const card of cards.filter(hasMotif)) {
    const svg = fs.readFileSync(svgOf(card), 'utf8')
    const label = card.key
    assert.ok(Buffer.byteLength(svg) <= MAX_BYTES, `${label} 太大：${Buffer.byteLength(svg)}`)
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 350 600"/, label)
    assert.ok(svg.endsWith('</svg>'), label)
    assert.equal(unbalancedTags(svg), null, label)
    assert.doesNotMatch(svg, /<script|<image|<foreignObject|\bon[a-z]+=|href=|@import|url\((?!#)/i, `${label} 有腳本或外部資源`)
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${label} 有算錯的數字`)
    const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])
    assert.ok(ids.length > 0 && ids.every((id) => id.startsWith(idOf(card))), `${label} id 沒有前綴`)
    assert.ok(svg.includes(`>${card.nameZh}</text>`), `${label} 沒有中文名`)
    assert.equal(svg, renderCard(card), `${label} 的 SVG 過期了（改了主圖或牌框要重跑 node scripts/tarot/buildCardArt.js）`)
  }
})

test('牌框：大牌上方是羅馬數字（愚人是 0），數字牌是 ACE～X，宮廷牌不寫數字', () => {
  const text = (key) => fs.readFileSync(path.join(CARDS_DIR, `${key}.svg`), 'utf8')
  const top = (svg) => (svg.match(/<text x="175" y="51"[^>]*>([^<]+)<\/text>/) || [])[1]
  assert.equal(top(text('major-00-fool')), '0')
  assert.equal(top(text('major-04-emperor')), 'IV')
  assert.equal(top(text('major-21-world')), 'XXI')
  for (const card of cards.filter((c) => c.arcanaType === 'minor' && hasMotif(c))) {
    const label = top(text(card.key))
    if (card.number === 1) assert.equal(label, 'ACE', card.key)
    else if (card.number <= 10) assert.match(label, /^[IVX]+$/, card.key)
    else assert.equal(label, undefined, card.key)
  }
})

test('靜態路由 /cards：SVG 送 gzip、jpg 照舊送原檔，兩者都快取 7 天、可跨網域載入；server.js 有掛', async () => {
  const app = express()
  app.use(securityHeaders())
  app.use('/cards', gzipStatic(CARDS_DIR, { maxAgeSeconds: 7 * 24 * 60 * 60 }))
  app.use('/cards', express.static(CARDS_DIR, { maxAge: '7d' }))
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  const get = (file, headers) =>
    new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${server.address().port}/cards/${file}`, { headers }, (res) => {
          const chunks = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
        })
        .on('error', reject)
    })
  try {
    const svg = await get('major-00-fool.svg', { 'Accept-Encoding': 'gzip' })
    assert.equal(svg.status, 200)
    assert.equal(svg.headers['content-encoding'], 'gzip')
    assert.match(svg.headers['content-type'], /^image\/svg\+xml/)
    assert.match(svg.headers['cache-control'], /max-age=604800/)
    assert.equal(svg.headers['cross-origin-resource-policy'], 'cross-origin')
    assert.deepEqual(zlib.gunzipSync(svg.body), fs.readFileSync(path.join(CARDS_DIR, 'major-00-fool.svg')))

    const jpg = await get('major-00-fool.jpg', { 'Accept-Encoding': 'gzip' })
    assert.equal(jpg.status, 200)
    assert.equal(jpg.headers['content-encoding'], undefined)
    assert.match(jpg.headers['content-type'], /^image\/jpeg/)
    assert.match(jpg.headers['cache-control'], /max-age=604800/)
    assert.equal(jpg.body.length, fs.statSync(path.join(CARDS_DIR, 'major-00-fool.jpg')).size)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
  const middleware = gzipStatic(CARDS_DIR, { maxAgeSeconds: 60 })
  assert.equal(middleware.files.size, 78, '只壓 SVG，jpg 不進記憶體')
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8')
  assert.match(serverSource, /app\.use\('\/cards', gzipStatic\(CARDS_DIR, \{ maxAgeSeconds: 7 \* 24 \* 60 \* 60 \}\)\)/)
  assert.match(serverSource, /app\.use\('\/cards', express\.static\(CARDS_DIR, \{ maxAge: '7d' \}\)\)/)
})
