// 大規模普查：四個牌陣 × 五領域 × 各 100 題 = 2000 組，統計判讀缺陷的出現率。
//
// 用法：
//   node scripts/auditLarge.js            跑完並印統計
//   node scripts/auditLarge.js --samples  同時印出每類缺陷的實例
//
// 固定亂數種子，結果可重現。自選牌陣（無位置）不在普查範圍。
require('dotenv').config({ quiet: true })

const mongoose = require('mongoose')
const { buildReadingWithDictionary } = require('../src/services/readingService')
const spreads = Object.values(require('../src/data/spreads'))
const Card = require('../src/models/Card')
const { buildQuestions } = require('./auditQuestions')
const { getCardVector } = require('../src/data/cardDimensions')
const { getCardProfile } = require('../src/data/cardAttributes')

let seed = 20261014
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}

// 每一條檢查都對應 v10 的一個編號。hit 回傳 true 代表這組牌踩到了這個缺陷。
//
// 注意：檢查要量「使用者看得到的缺陷」，不是量「結構上的前提」。
// 第一版有幾條量錯了 —— 例如 Q2 只檢查同一段文字裡有沒有兩個詞，
// 但修法是把它們拆成兩句，文字還在，檢查就永遠不會降。改成逐句檢查才對。
const CHECKS = [
  {
    id: 'Q1',
    name: '三個「最重要的牌」互不相同',
    // 三個指標指向不同張是正常的（它們量不同的東西），
    // 缺陷在於文字沒講清楚哪一張才是主牌。
    hit: ({ a }) => {
      const focus = a.theme.focusIndex
      const lead = a.quant?.contributions?.[0]?.index
      if (lead === undefined || lead === focus) return false
      return !/這和份量最重的那張是兩回事/.test(a.quant.text)
    },
  },
  {
    id: 'Q2',
    name: '宮廷牌同一句自相矛盾',
    // 同一「句」裡才算矛盾。拆成兩句並加轉折詞之後就不該再計入。
    hit: ({ a }) =>
      a.courts.some((c) =>
        c.text
          .split('。')
          .some(
            (sentence) =>
              /份量最重的階級|最輕的階級，份量有限|份量僅次於國王|衝勁強，份量不輕/.test(sentence) &&
              /只是輔助的角色|也有一定的份量|說話最大聲/.test(sentence),
          ),
      ),
  },
  {
    id: 'Q3',
    name: '牌對標籤與文字對不上',
    // 底層的 relation 仍由元素決定（那是對的），缺陷在於**標籤用了價值判斷的詞**，
    // 擺在講牌義的句子旁邊就變成打臉。所以檢查標籤本身，不是檢查 relation。
    hit: ({ a }) => a.pairs.some((p) => /增強|削弱/.test(p.relationLabel || '')),
  },
  {
    id: 'Q4a',
    name: '十張牌陣判成「生活小事」',
    // 判定維持不變（使用者選「加註」），所以缺陷是「判了卻沒說明落差」
    hit: ({ a, spread }) =>
      spread.cardCount >= 10 && a.weights.intensity === 'daily' && !/沒把你選的牌陣算進去/.test(a.weights.text),
  },
  {
    id: 'Q4b',
    name: '三張牌陣判成「人生級的轉折」',
    hit: ({ a, spread }) =>
      spread.cardCount <= 3 && a.weights.intensity === 'major' && !/只抽了三張/.test(a.weights.text),
  },
  {
    id: 'Q5',
    name: '有高強度小牌卻判成「日常可控」',
    // 單張高強度牌不構成「主導」—— 一張寶劍十夾在十張牌裡，
    // 說「議題偏向日常」是站得住的。要重量級牌佔到三成才算誤判。
    hit: ({ a, cards }) => {
      if (a.theme.dominance !== 'personal') return false
      const heavy = cards.filter((card) => {
        if (card.arcanaType === 'major') return true
        const vector = getCardVector(card, getCardProfile(card))
        return vector.polarityKnown && Math.abs(vector.polarity) >= 0.8
      }).length
      return heavy / cards.length >= 0.3
    },
  },
  {
    id: 'Q6',
    name: '說「收尾」但階段終點是 1～3',
    hit: ({ a, r }) => {
      const stage = a.numberStage
      if (!stage || stage.sequence.length < 2) return false
      const last = stage.sequence[stage.sequence.length - 1].number
      return last <= 3 && /收尾/.test(r.guidance + stage.text)
    },
  },
  {
    id: 'Q7',
    name: '數字被強調卻沒和階段序列連起來',
    hit: ({ a }) =>
      a.theme.emphasizedNumbers.length > 0 &&
      Boolean(a.numberStage) &&
      !/出現 \d+ 張|重複強調/.test(a.numberStage.text),
  },
  {
    id: 'Q8',
    name: '結語把「缺少的牌組」講兩次',
    hit: ({ r }) => (r.guidance.match(/這次沒出現/g) || []).length >= 2,
  },
  {
    id: 'Q9',
    name: '「各個位置看出什麼」整區消失',
    hit: ({ a }) => a.positions.length === 0,
  },
  {
    id: 'Q10',
    name: '跨位置關係沒交代距離',
    hit: ({ a }) =>
      a.conflicts.some(
        (c) =>
          c.type === 'enhanceWithBlocked' &&
          Math.abs(c.to - c.from) >= 3 &&
          !/這兩格隔得遠/.test(c.text),
      ),
  },
]

async function main() {
  const showSamples = process.argv.includes('--samples')
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'tarot-divination' })
  const all = await Card.find({}).lean()

  const counts = Object.fromEntries(CHECKS.map((c) => [c.id, 0]))
  const samples = Object.fromEntries(CHECKS.map((c) => [c.id, []]))
  const bySpread = {}
  let total = 0

  for (const spread of spreads) {
    bySpread[spread.name] = Object.fromEntries(CHECKS.map((c) => [c.id, 0]))

    for (const domain of ['work', 'money', 'love', 'social', 'study']) {
      const questions = buildQuestions(domain)

      for (const question of questions) {
        const picked = []
        while (picked.length < spread.cardCount) {
          const card = all[Math.floor(rand() * all.length)]
          if (!picked.find((c) => c.slug === card.slug)) picked.push(card)
        }
        const orientations = picked.map(() => (rand() > 0.5 ? 'upright' : 'reversed'))

        const r = await buildReadingWithDictionary({
          question,
          spread,
          cards: picked,
          drawOrientation: (i) => orientations[i],
          domain,
        })
        const a = r.analysis

        total += 1
        for (const check of CHECKS) {
          if (check.hit({ a, r, spread, cards: picked })) {
            counts[check.id] += 1
            bySpread[spread.name][check.id] += 1
            if (samples[check.id].length < 2) {
              samples[check.id].push(`${spread.name}｜${domain}｜${question}`)
            }
          }
        }
      }
    }
    console.log(`　${spread.name} 完成`)
  }

  console.log(`\n普查 ${total} 組\n`)
  console.log('編號   出現率            問題')
  console.log('─'.repeat(74))
  for (const check of CHECKS) {
    const n = counts[check.id]
    const pct = ((n / total) * 100).toFixed(1)
    const bar = '█'.repeat(Math.round((n / total) * 20)).padEnd(20, '░')
    console.log(`${check.id.padEnd(6)} ${bar} ${String(n).padStart(4)} / ${total}（${pct}%）  ${check.name}`)
  }

  console.log('\n依牌陣（每格 500 組）')
  console.log('　'.padEnd(13) + CHECKS.map((c) => c.id.padStart(5)).join(''))
  for (const [name, row] of Object.entries(bySpread)) {
    console.log(name.padEnd(12) + CHECKS.map((c) => String(row[c.id]).padStart(5)).join(''))
  }

  if (showSamples) {
    console.log('\n實例')
    for (const check of CHECKS) {
      if (samples[check.id].length > 0) {
        console.log(`  ${check.id} ${check.name}`)
        samples[check.id].forEach((s) => console.log(`     ${s}`))
      }
    }
  }

  await mongoose.disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
