// 產生塔羅 78 張原創 SVG 牌面（v28，詳見 doc/v28-tarot-original-art-plan.md）。
//
//   node scripts/tarot/buildCardArt.js
//
// - 牌框：lib/frame.js（底與牌名和雷諾曼共用）；花色物件與宮廷徽記：lib/art.js；宮廷牌版型：lib/court.js；色票與基本圖形：scripts/lenormand/lib/shapes.js
// - 每張牌的主圖：motifs/<key>.js，匯出 { draw(h) }。要修某一張只改那一個檔，再跑一次這支。
// - 產出：public/cards/<key>.svg（檔名和現有 jpg 一樣，只換副檔名）與預覽頁 scripts/tarot/preview.html
// - 分批畫（決議 D5）：還沒有主圖模組的牌先跳過，預覽頁標示「尚未畫」。
// 不呼叫任何外部服務，也不讀任何圖片。
const fs = require('fs')
const path = require('path')

const { cards } = require('./cards')
const shapes = require('../lenormand/lib/shapes')
const art = require('./lib/art')
const courtLib = require('./lib/court')
const { buildTarotSvg } = require('./lib/frame')

const ROOT = path.join(__dirname, '..', '..')
const OUT_DIR = path.join(ROOT, 'public', 'cards')
const MOTIF_DIR = path.join(__dirname, 'motifs')
const PREVIEW = path.join(__dirname, 'preview.html')
const MAX_BYTES = 30 * 1024

const helpers = { ...shapes, ...art, ...courtLib }
const motifFileOf = (card) => path.join(MOTIF_DIR, `${card.key}.js`)
const hasMotif = (card) => fs.existsSync(motifFileOf(card))
const renderCard = (card) => buildTarotSvg(card, require(motifFileOf(card)).draw(helpers))

function buildAll() {
  const results = []
  const problems = []
  for (const card of cards) {
    if (!hasMotif(card)) {
      results.push({ card, bytes: null })
      continue
    }
    const svg = renderCard(card)
    const bytes = Buffer.byteLength(svg)
    if (bytes > MAX_BYTES) problems.push(`${card.key}：${bytes} bytes，超過 ${MAX_BYTES}`)
    if (/NaN|undefined|Infinity/.test(svg)) problems.push(`${card.key}：有算錯的數字`)
    fs.writeFileSync(path.join(OUT_DIR, `${card.key}.svg`), svg)
    results.push({ card, bytes })
  }
  fs.writeFileSync(PREVIEW, previewHtml(results))
  return { results, problems }
}

function previewHtml(results) {
  const items = results
    .map(({ card, bytes }) =>
      bytes === null
        ? `<figure class="todo"><div>尚未畫</div><figcaption>${card.nameZh}</figcaption></figure>`
        : `<figure><img src="../../public${card.image}" alt="${card.nameZh}" loading="lazy"><figcaption>${card.nameZh}・${(bytes / 1024).toFixed(1)}KB</figcaption></figure>`,
    )
    .join('\n')
  const done = results.filter((r) => r.bytes !== null).length
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>塔羅牌面預覽</title>
<!-- 由 scripts/tarot/buildCardArt.js 產生，直接用瀏覽器打開即可（不需要伺服器） -->
<style>
  body { margin: 0; padding: 16px; background: #ece6d8; font-family: system-ui, sans-serif; color: #5d5763; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { margin: 0 0 16px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px; }
  figure { margin: 0; }
  img, .todo div { width: 100%; aspect-ratio: 7 / 12; display: block; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,.15); }
  .todo div { display: grid; place-items: center; background: #f6f0e1; color: #b3a894; font-size: 13px; }
  figcaption { font-size: 12px; text-align: center; margin-top: 4px; }
</style>
</head>
<body>
<h1>塔羅・原創水彩牌面（${done} / ${results.length} 張）</h1>
<p>牌框、主圖都是手寫 SVG 原創，不使用 Rider-Waite-Smith 的插畫與構圖。</p>
<div class="grid">
${items}
</div>
</body>
</html>
`
}

if (require.main === module) {
  const { results, problems } = buildAll()
  const sizes = results.filter((r) => r.bytes !== null).map((r) => r.bytes)
  console.log(`產生 ${sizes.length} 張（共 ${results.length} 張），大小 ${(Math.min(...sizes) / 1024).toFixed(1)}～${(Math.max(...sizes) / 1024).toFixed(1)} KB`)
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  }
}

module.exports = { buildAll, renderCard, hasMotif, motifFileOf, MAX_BYTES, OUT_DIR }
