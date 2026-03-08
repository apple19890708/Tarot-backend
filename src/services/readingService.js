function orientationLabel(orientation) {
  return orientation === 'upright' ? '正位' : '逆位'
}

function getSection(card, orientation) {
  const key = orientation === 'upright' ? '正位牌義' : '逆位牌義'
  const lines = card.sections?.[key]

  return Array.isArray(lines) ? lines.filter(Boolean) : []
}

function buildInterpretation(card, orientation, position) {
  const sectionLines = getSection(card, orientation)
  const opening = sectionLines[0] || card.summary || '這張牌提醒你回到問題本身，重新看見局勢。'
  const followUp = sectionLines[1] || position.prompt

  return `${position.label}出現${card.nameZh}${orientationLabel(orientation)}，${opening} ${followUp}`
}

function buildReading({ question, spread, cards }) {
  const entries = spread.positions.map((position, index) => {
    const card = cards[index]
    const orientation = Math.random() > 0.5 ? 'upright' : 'reversed'
    const sectionLines = getSection(card, orientation)

    return {
      position,
      orientation,
      interpretation: buildInterpretation(card, orientation, position),
      highlights: sectionLines.slice(0, 3),
      card: {
        id: card._id,
        nameZh: card.nameZh,
        nameEn: card.nameEn,
        suit: card.suit,
        arcanaType: card.arcanaType,
        number: card.number,
        keywords: card.keywords,
        source: card.source,
      },
    }
  })

  const overview = entries
    .map((entry) => `${entry.position.label}：${entry.card.nameZh}${orientationLabel(entry.orientation)}`)
    .join('、')

  const guidance = entries
    .map((entry) => `${entry.position.label}重點是${entry.interpretation}`)
    .join(' ')

  return {
    question,
    spread: {
      key: spread.key,
      name: spread.name,
      description: spread.description,
      cardCount: spread.cardCount,
    },
    overview,
    guidance,
    cards: entries,
  }
}

module.exports = {
  buildReading,
}