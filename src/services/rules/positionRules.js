// 規則 8：依牌陣位置判斷。以位置 key 決定套用哪些規則，沒有對應位置的牌陣自然略過。
// 只處理「單一位置」與「三張型」判定；兩張牌之間的關係由關係對系統負責。
const { getCardVector } = require('../../data/cardDimensions')
const { QUANT } = require('../../data/ruleConfig')

// 這個位置的牌是助力還是阻力。極性與正逆位是兩個軸，要四格都分開：
// **不能只看正逆位** —— 錢幣五正位在「環境」位是「被排除在外」，不是「環境友善」。
// **也不能只看極性** —— 聖杯五逆位是「不再惦記失去的」，比正位鬆，不該一律當阻力。
//   'help'    牌義正向、力道也使得出來
//   'latent'  牌義正向但逆位，力道還沒出來
//   'block'   牌義負向且正位，阻力全開
//   'easing'  牌義負向但逆位，那股負面沒全開，相對鬆一口氣
function toneAt(item) {
  const vector = getCardVector(item.card, item.profile)
  const reversed = item.orientation === 'reversed'

  // 極性不明或接近中性的牌，只能靠正逆位判斷
  if (!vector.polarityKnown || Math.abs(vector.polarity) < 0.2) {
    return reversed ? 'latent' : 'help'
  }
  if (vector.polarity < 0) {
    if (reversed) return 'easing'
    // −0.25 這種輕微負面（例如寶劍二的猶豫）不該和寶劍十（−0.9）用同一種說法
    return vector.polarity > -0.5 ? 'blockMild' : 'block'
  }
  return reversed ? 'latent' : 'help'
}

function orientationTrend(past, present, future) {
  const orientations = [past, present, future].map((item) => item.orientation)

  let value = 'mixed'
  if (orientations.every((orientation) => orientation === 'upright')) {
    value = 'smooth'
  } else if (orientations.every((orientation) => orientation === 'reversed')) {
    value = 'stuck'
  } else if (present.orientation === 'reversed' && future.orientation === 'upright') {
    value = 'unblock'
  } else if (present.orientation === 'upright' && future.orientation === 'reversed') {
    value = 'blockAhead'
  }

  return { type: 'orientationTrend', value, evidence: [past.index, present.index, future.index] }
}

function analyzePositions({ positionKeys, items }) {
  if (!Array.isArray(positionKeys) || positionKeys.length !== items.length) {
    return []
  }

  const at = {}
  positionKeys.forEach((key, index) => {
    at[key] = items[index]
  })

  const findings = []

  if (at.past && at.present && at.future) {
    findings.push(orientationTrend(at.past, at.present, at.future))
  }

  // 有「問題／終局」時以它們為起點與結果，否則用「過去／未來」
  // 注意：障礙×對策、負面×正面、問題×終局這類「配對型」判定已移交給關係對系統
  // （見 doc/v06-tarot-spread-relations-plan.md 第四節），這裡只留單一位置與三張型判定，
  // 否則同一組牌會在「牌跟牌之間的關係」與「各個位置看出什麼」各講一次。

  // 每個位置都要有正位與逆位兩套判定。原本只在逆位時說話，
  // 於是全正位的直指核心與塞爾特十字整區消失（實測 34.4% / 16%，v10 Q9）。
  // 每個位置都要有判定，不能只在逆位時說話（原本全正位的牌陣整區消失，v10 Q9）。
  // 但要看的是牌的極性，不是正逆位 —— 否則會寫出「錢幣五正位：環境站在你這邊」。
  const BY_TONE = {
    resource: {
      help: 'resourceReady', latent: 'resourceBlocked',
      block: 'resourceAdverse', blockMild: 'resourceAdverseMild', easing: 'resourceRecovering',
    },
    positive: {
      help: 'supportActive', latent: 'supportBlocked',
      block: 'supportHollow', blockMild: 'supportHollowMild', easing: 'supportBlocked',
    },
    negative: {
      help: 'negativeMild', latent: 'negativeMild',
      block: 'negativeActive', blockMild: 'negativeActive', easing: 'negativeEasing',
    },
    'hopes-fears': {
      help: 'hopesFearsClear', latent: 'hopesFearsTangled',
      block: 'hopesFearsHeavy', blockMild: 'hopesFearsTangled', easing: 'hopesFearsTangled',
    },
    environment: {
      help: 'environmentSupportive', latent: 'environmentUnclear',
      block: 'environmentAdverse', blockMild: 'environmentUnclear', easing: 'environmentRecovering',
    },
  }

  Object.entries(BY_TONE).forEach(([key, byTone]) => {
    const item = at[key]
    if (item) {
      findings.push({ type: byTone[toneAt(item)], evidence: [item.index] })
    }
  })

  if (at.core) {
    findings.push({
      type: at.core.profile.kind === 'major' ? 'coreMajor' : 'coreMinor',
      evidence: [at.core.index],
    })
  }

  if (at.foundation) {
    findings.push({
      type: at.foundation.profile.kind === 'major' ? 'foundationMajor' : 'foundationMinor',
      evidence: [at.foundation.index],
    })
  }

  return findings.filter(Boolean)
}

module.exports = {
  analyzePositions,
}
