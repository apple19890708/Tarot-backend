// 產生雷諾曼 52 張原創 SVG 牌面（v27 階段 2，詳見 doc/v27-lenormand-plan.md 3-3）。
//
//   node scripts/lenormand/buildCardArt.js
//
// - 共用牌框：lib/frame.js；共用圖形與色票：lib/shapes.js
// - 每張牌的主圖：motifs/NN-slug.js，匯出 { facing, draw(h) }。要修某一張只改那一個檔，再跑一次這支。
// - 產出：public/lenormand/NN-slug.svg（檔名和 src/data/lenormand/cards.js 的 image 一致）與預覽頁 scripts/lenormand/preview.html
// - 主圖宣告的 facing 必須和 cards.js 的 facing 一致，不一致就失敗（規則 L4 靠它判斷視線）。
// 不呼叫任何外部服務，也不讀任何圖片。
const fs = require('fs')
const path = require('path')

const { cards } = require('../../src/data/lenormand/cards')
const shapes = require('./lib/shapes')
const { buildCardSvg } = require('./lib/frame')

const ROOT = path.join(__dirname, '..', '..')
const OUT_DIR = path.join(ROOT, 'public', 'lenormand')
const MOTIF_DIR = path.join(__dirname, 'motifs')
const PREVIEW = path.join(__dirname, 'preview.html')
const MAX_BYTES = 30 * 1024

function motifFileOf(card) {
  return path.join(MOTIF_DIR, `${path.basename(card.image, '.svg')}.js`)
}

function buildAll() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const results = []
  const problems = []
  for (const card of cards) {
    const motif = require(motifFileOf(card))
    if ((motif.facing ?? null) !== card.facing) {
      problems.push(`#${card.id} ${card.slug}：主圖朝向 ${motif.facing ?? null}，cards.js 是 ${card.facing}`)
    }
    const svg = buildCardSvg(card, motif.draw(shapes))
    const bytes = Buffer.byteLength(svg)
    if (bytes > MAX_BYTES) problems.push(`#${card.id} ${card.slug}：${bytes} bytes，超過 ${MAX_BYTES}`)
    fs.writeFileSync(path.join(ROOT, 'public', card.image), svg)
    results.push({ card, bytes })
  }
  fs.writeFileSync(PREVIEW, previewHtml(results))
  return { results, problems }
}

function previewHtml(results) {
  const items = results
    .map(
      ({ card, bytes }) =>
        `<figure><img src="../../public${card.image}" alt="${card.id} ${card.nameZh}" loading="lazy"><figcaption>${card.id} ${card.nameZh}${card.facing ? `・朝${card.facing === 'left' ? '左' : '右'}` : ''}・${(bytes / 1024).toFixed(1)}KB</figcaption></figure>`,
    )
    .join('\n')
  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>雷諾曼牌面預覽</title>
<!-- 由 scripts/lenormand/buildCardArt.js 產生，直接用瀏覽器打開即可（不需要伺服器） -->
<style>
  body { margin: 0; padding: 16px; background: #ece6d8; font-family: system-ui, sans-serif; color: #5d5763; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { margin: 0 0 16px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px; }
  figure { margin: 0; }
  img { width: 100%; aspect-ratio: 7 / 12; display: block; border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,.15); }
  figcaption { font-size: 12px; text-align: center; margin-top: 4px; }
</style>
</head>
<body>
<h1>靜謐花園雷諾曼・原創牌面（52 張）</h1>
<p>牌框、主圖都是手寫 SVG 原創，不使用原版插畫。</p>
<div class="grid">
${items}
</div>
</body>
</html>
`
}

if (require.main === module) {
  const { results, problems } = buildAll()
  const sizes = results.map((r) => r.bytes)
  console.log(`產生 ${results.length} 張，大小 ${(Math.min(...sizes) / 1024).toFixed(1)}～${(Math.max(...sizes) / 1024).toFixed(1)} KB`)
  if (problems.length) {
    console.error(problems.join('\n'))
    process.exitCode = 1
  }
}

module.exports = { buildAll, motifFileOf, MAX_BYTES, OUT_DIR }
