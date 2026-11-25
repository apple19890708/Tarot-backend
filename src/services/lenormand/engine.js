// 雷諾曼規則引擎（v27，詳見 doc/v27-lenormand-plan.md 3-5、3-12）：整合各條規則，只產生結構化結果，不產生文字。
// 小牌陣（階段 3）：L1 牌性、L2 成對、L3 特殊組合、L4 視線、L5 九宮格、L9 撲克花色。
// 大藍圖（階段 5）：L6 代表牌與距離、L7 宮位、L8 主題牌、L10 騎士跳、L11 鏡射放在 analysis.tableau（其他牌陣是 null）；
// L1、L3、L4、L9 照樣看全部 36 張，L2 只讀代表牌與主題牌的左右相鄰。
const { analyzeQuestionType } = require('../rules/questionType')
const { analyzeTone } = require('./rules/tone')
const { analyzePairs } = require('./rules/pairs')
const { analyzeCombos } = require('./rules/combos')
const { analyzeGaze } = require('./rules/gaze')
const { analyzeNineBox } = require('./rules/nineBox')
const { analyzeSuits } = require('./rules/suits')
const { analyzeDomain } = require('./rules/domain')
const { analyzeSignificator } = require('./rules/significator')
const { analyzeThemeCard } = require('./rules/themeCard')
const { analyzeHouses } = require('./rules/houses')
const { analyzeKnighting } = require('./rules/knighting')
const { analyzeMirroring } = require('./rules/mirroring')

function analyzeTableau({ items, spread, domain, significator }) {
  // 大藍圖一定要有代表牌；API 已經擋掉，這裡擋的是之後重算舊紀錄、AI 解讀直接呼叫引擎的情況
  if (significator !== 28 && significator !== 29) throw new Error('大藍圖需要代表牌（28 或 29）。')
  const { center, distances, directions, surroundings } = analyzeSignificator({ items, significator })
  const themeCard = analyzeThemeCard({ items, domain, center })
  const origins = [{ from: 'center', origin: center.index }]
  // 關鍵牌和中心是同一格（代表牌沒出現、關鍵牌剛好在第 28／29 宮）時不重複列
  if (themeCard && themeCard.index !== center.index) origins.push({ from: 'theme', origin: themeCard.index })
  return {
    center,
    distances,
    directions,
    surroundings,
    houses: analyzeHouses({ items, center, themeCard }),
    themeCard,
    knighting: analyzeKnighting({ items, origins }),
    mirrors: analyzeMirroring({ items, origins, grid: spread.grid }),
  }
}

/**
 * @param items [{ index, card, position }]，依位置順序
 * @param spread src/data/lenormand/spreads.js 的牌陣
 * @param question 問題文字（已驗證）
 * @param domain 使用者選的問題類型或 null
 * @param significator 28／29 或 null
 */
function analyzeLenormand({ items, spread, question = '', domain = null, significator = null }) {
  const resolved = analyzeDomain({ items, selected: domain, question })
  // L3 先算：被化解的凶牌（鸛鳥朝向蛇）在 L1 當中性
  const combos = analyzeCombos({ items })
  const cleansed = combos.filter((combo) => Number.isInteger(combo.cleanses)).map((combo) => combo.cleanses)
  const tableau = spread.key === 'grand-tableau' ? analyzeTableau({ items, spread, domain: resolved, significator }) : null
  // 大藍圖的 L2 只讀有出現的代表牌與主題牌
  const focus = []
  if (tableau?.center.present) focus.push({ line: 'significator', index: tableau.center.index })
  if (tableau?.themeCard?.present) focus.push({ line: 'theme', index: tableau.themeCard.index })
  return {
    questionType: analyzeQuestionType({ question, domain: resolved.key || 'general' }),
    domain: resolved,
    // 大藍圖的整體牌性只看中心周圍的近距離牌（代表牌沒出現時是中心宮位那一格的周圍）
    tone: analyzeTone({ items, spread, cleansed, scope: tableau ? tableau.distances.near : null }),
    pairs: analyzePairs({ items, spread, focus }),
    combos,
    gaze: analyzeGaze({ items, significator }),
    nineBox: analyzeNineBox({ items, spread, cleansed }),
    suits: analyzeSuits({ items }),
    tableau,
  }
}

module.exports = { analyzeLenormand }
