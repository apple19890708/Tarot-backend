const ELEMENT_RELATIONS = {
  'air|fire': 'friendly',
  'earth|water': 'friendly',
  'fire|water': 'opposed',
  'air|earth': 'opposed',
  'earth|fire': 'neutral',
  'air|water': 'neutral',
}

function getElementRelation(a, b) {
  if (!a || !b) {
    return null
  }

  if (a === b) {
    return 'same'
  }

  return ELEMENT_RELATIONS[[a, b].sort().join('|')]
}

module.exports = {
  getElementRelation,
}
