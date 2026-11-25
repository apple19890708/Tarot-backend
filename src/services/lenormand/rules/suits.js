// L9 撲克花色：花色分布、主導花色、紅黑比例、人頭牌（J、Q、K）與 A。
// playingCard 為 null 的牌（37～52 待補）略過，skipped 記下略過幾張。意思見 src/data/lenormand/playingCards.js。
const RED = ['hearts', 'diamonds']
const FACES = ['J', 'Q', 'K']

function analyzeSuits({ items }) {
  const counts = { hearts: 0, diamonds: 0, clubs: 0, spades: 0 }
  const faces = []
  const aces = []
  let counted = 0
  for (const item of items) {
    const pc = item.card.playingCard
    if (!pc) continue
    counted += 1
    counts[pc.suit] += 1
    const entry = { index: item.index, cardId: item.card.id, rank: pc.rank, suit: pc.suit }
    if (FACES.includes(pc.rank)) faces.push(entry)
    if (pc.rank === 'A') aces.push(entry)
  }
  const max = Math.max(...Object.values(counts))
  const dominant = counted === 0 ? [] : Object.keys(counts).filter((suit) => counts[suit] === max)
  const red = counts.hearts + counts.diamonds
  const black = counts.clubs + counts.spades
  let colorLean = null
  if (counted > 0) colorLean = red > black ? 'red' : black > red ? 'black' : 'even'
  return { counted, skipped: items.length - counted, counts, dominant, colors: { red, black }, colorLean, faces, aces }
}

module.exports = { analyzeSuits, RED }
