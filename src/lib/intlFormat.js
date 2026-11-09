// 共用的 Intl.DateTimeFormat：同樣的 locale＋選項只建一次。
//
// 為什麼：每 new 一個 Intl.DateTimeFormat 會配置約 27KB 的原生記憶體（ICU），要等 GC 才釋放；
// 後端的 V8 heap 很小、GC 很少跑，這些原生記憶體就一直堆著。以前 K 線每一根都 new 一個（dateIn），
// 大盤概況十幾個指數各一年份、加上自選清單每一檔，一次就是好幾千個，記憶體瞬間衝過 512MB，
// Cloud Run 把主機砍掉（2026-11-09）。實測 5000 次：每次新建 +133MB／385ms，重用 +0MB／6ms。
//
// 規則：後端不要直接 new Intl.DateTimeFormat，一律用這裡的 dateTimeFormat()
const formatters = new Map()

function dateTimeFormat(locale, options) {
  const key = `${locale}|${JSON.stringify(options)}`
  let formatter = formatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options)
    formatters.set(key, formatter)
  }
  return formatter
}

module.exports = { dateTimeFormat }
