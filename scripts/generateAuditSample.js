// 產出普查樣本：四個牌陣 × 五領域 × 各三題 = 60 組，固定亂數種子可重現。
// 用法：node scripts/generateAuditSample.js > doc/普查樣本-60組.txt
require('dotenv').config({ quiet: true })
const m = require('mongoose')
const { buildReadingWithDictionary } = require('../src/services/readingService')
const spreads = Object.values(require('../src/data/spreads'))
const Card = require('../src/models/Card')

const QUESTIONS = {
  work: ['我接下來三個月的工作發展會如何', '該不該接下這個新專案', '和主管的關係要怎麼處理'],
  money: ['今年的財務狀況會怎麼走', '這筆投資該不該進場', '要怎麼改善一直存不到錢的狀況'],
  love: ['這段感情接下來會怎麼走', '該不該主動告白', '我們之間卡住的是什麼'],
  social: ['在新團體裡要怎麼融入', '和朋友鬧僵了該怎麼辦', '我的人際狀態現在如何'],
  study: ['這次考試準備得如何', '該不該轉換研究方向', '要怎麼提升讀書效率'],
}

// 固定亂數種子，結果可重現
let seed = 20261014
const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }

;(async () => {
  await m.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME })
  const all = await Card.find({}).lean()

  for (const spread of spreads) {
    for (const [domain, questions] of Object.entries(QUESTIONS)) {
      for (const question of questions) {
        const picked = []
        while (picked.length < spread.cardCount) {
          const card = all[Math.floor(rand() * all.length)]
          if (!picked.find((c) => c.slug === card.slug)) picked.push(card)
        }
        const orientations = picked.map(() => (rand() > 0.5 ? 'upright' : 'reversed'))
        const r = await buildReadingWithDictionary({
          question, spread, cards: picked, drawOrientation: (i) => orientations[i], domain,
        })
        const a = r.analysis
        console.log('════════ ' + spread.name + ' ｜ ' + domain + ' ｜ ' + question)
        console.log(r.overview)
        console.log('[整體看起來] ' + a.quant.text)
        console.log('[問題對照] ' + (a.question?.text || '無'))
        console.log('[整體在說什麼] ' + a.theme.text)
        console.log('[元素與數字] ' + (a.theme.elementNumberText || '無'))
        console.log('[這件事有多大] ' + a.weights.text)
        console.log('[走到哪個階段] ' + (a.numberStage?.text || '無'))
        if (a.courtSummary) console.log('[宮廷摘要] ' + a.courtSummary)
        a.courts.forEach((c) => console.log('[宮廷] ' + c.text))
        a.positions.forEach((p) => console.log('[位置] ' + p.text))
        a.pairs.forEach((p) => console.log('[牌對' + (p.textSource === 'rule' ? '/規則' : '') + '] ' + r.cards[p.from].card.nameZh + '→' + r.cards[p.to].card.nameZh + ' [' + p.relationLabel + '] ' + p.text))
        a.conflicts.forEach((c) => console.log('[矛盾] ' + c.text))
        a.uncertainties.forEach((c) => console.log('[不明朗] ' + c.text))
        console.log('[GUIDANCE] ' + r.guidance)
        console.log()
      }
    }
  }
  await m.disconnect()
})()
