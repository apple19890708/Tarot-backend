// 問題類型 → 主題牌（3-5 L8）。使用者有選就用選的；沒選就看問題關鍵詞（命中最多的類型，同分照 DOMAIN_ORDER）。
// 小牌陣只標出主題牌有沒有出現、在哪一張；大藍圖（階段 5）再讀它的宮位與距離。
const { LENORMAND_DOMAINS, DOMAIN_ORDER, DOMAIN_EXCLUDE_WORDS } = require('../../../data/lenormand/ruleConfig')

function resolveDomain({ selected = null, question = '' }) {
  let key = null
  let source = 'none'
  if (selected) {
    key = selected
    source = 'selected'
  } else {
    // 先拿掉含有關鍵字、但意思不同的詞（「可愛」不是感情）
    const text = DOMAIN_EXCLUDE_WORDS.reduce((source, word) => source.split(word).join(' '), String(question || ''))
    let best = 0
    for (const candidate of DOMAIN_ORDER) {
      const hits = LENORMAND_DOMAINS[candidate].keywords.filter((keyword) => text.includes(keyword)).length
      if (hits > best) {
        best = hits
        key = candidate
      }
    }
    if (key) source = 'keywords'
  }
  const domain = key ? LENORMAND_DOMAINS[key] : null
  return { key, label: domain ? domain.label : null, source, themeCardId: domain ? domain.themeCardId : null }
}

function analyzeDomain({ items, selected, question }) {
  const domain = resolveDomain({ selected, question })
  const themeItem = domain.themeCardId ? items.find((item) => item.card.id === domain.themeCardId) : null
  return { ...domain, themeIndex: themeItem ? themeItem.index : null }
}

module.exports = { analyzeDomain, resolveDomain }
