// 塔羅原版牌面的縮圖（v29 項目 5，詳見 doc/v29-optimization-plan.md）。
// 原版 78 張 JPEG 每張約 200KB、共約 16MB，結果頁只顯示約 50px 寬；產生 240px 寬的 WebP 放在
// public/cards/thumb/<同檔名>.webp，前端把 /cards/xxx.jpg 換成 /cards/thumb/xxx.webp（404 就退回原圖）。
// 水彩的 SVG 本來就小、縮放不失真，不處理。
//
// sharp 是 devDependency：只有這支腳本用，正式環境（Cloud Run buildpacks 只裝 dependencies）不會裝。
// 用法：
//   node scripts/buildCardThumbs.js          產生（覆蓋）全部縮圖
//   node scripts/buildCardThumbs.js --check  只檢查有沒有缺，不寫檔（缺的話結束碼 1）
const fs = require('fs')
const path = require('path')

const CARDS_DIR = path.join(__dirname, '..', 'public', 'cards')
const THUMB_DIR = path.join(CARDS_DIR, 'thumb')
const WIDTH = 240
// 品質：抽 4 張比 55／70／80／90（平均 20／24／30／45KB），放大 3 倍時 55 有色塊、80 和 90 看不出差別，取 75
const QUALITY = 75

const thumbName = (jpg) => jpg.replace(/\.jpe?g$/i, '.webp')

function listJpegs() {
  return fs
    .readdirSync(CARDS_DIR)
    .filter((name) => /\.jpe?g$/i.test(name))
    .sort()
}

async function build() {
  const sharp = require('sharp')
  fs.mkdirSync(THUMB_DIR, { recursive: true })
  let before = 0
  let after = 0
  const names = listJpegs()
  for (const name of names) {
    const source = path.join(CARDS_DIR, name)
    const target = path.join(THUMB_DIR, thumbName(name))
    // 保持比例，只限制寬度；原圖比 240 窄就不放大
    await sharp(source).resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: QUALITY, effort: 6 }).toFile(target)
    before += fs.statSync(source).size
    after += fs.statSync(target).size
  }
  const kb = (bytes) => `${(bytes / 1024).toFixed(0)}KB`
  console.log(`縮圖 ${names.length} 張：原圖 ${kb(before)} → 縮圖 ${kb(after)}，平均每張 ${kb(after / names.length)}`)
}

function check() {
  const missing = listJpegs().filter((name) => !fs.existsSync(path.join(THUMB_DIR, thumbName(name))))
  if (missing.length) {
    console.error(`缺 ${missing.length} 張縮圖：${missing.join('、')}`)
    process.exitCode = 1
    return
  }
  console.log('縮圖齊全')
}

if (require.main === module) {
  if (process.argv.includes('--check')) check()
  else
    build().catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}

module.exports = { thumbName, WIDTH, QUALITY }
