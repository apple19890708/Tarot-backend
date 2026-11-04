const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')

const { parseCardFile, parseCardNumber, validateDeck } = require('../src/utils/tarotParser')

// 在暫存資料夾建一個牌檔，模擬 <workspace>/<牌組資料夾>/<檔名>.txt
function writeCard(folder, fileName) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-parser-'))
  fs.mkdirSync(path.join(root, folder))
  const filePath = path.join(root, folder, fileName)
  fs.writeFileSync(filePath, '愚者 The Fool\n來源：test\n\n【正位牌義】\n新的開始\n', 'utf8')
  return { root, filePath }
}

test('牌號取自檔名開頭，0 號是愚者', () => {
  const { root, filePath } = writeCard('大阿卡納', '00_愚者.txt')
  assert.equal(parseCardFile(filePath, root).number, 0)
})

test('檔名沒有號碼時要報錯，不能預設成 0（會被當成愚者）', () => {
  const { root, filePath } = writeCard('大阿卡納', '愚者.txt')
  assert.throws(() => parseCardFile(filePath, root), /檔名開頭沒有號碼/)
})

test('號碼超出範圍要報錯：大牌 0～21、小牌 1～14', () => {
  assert.throws(() => parseCardNumber('22_x.txt', 'major', 'x'), /超出範圍/)
  assert.throws(() => parseCardNumber('0_x.txt', 'minor', 'x'), /超出範圍/)
  assert.throws(() => parseCardNumber('15_x.txt', 'minor', 'x'), /超出範圍/)
  assert.equal(parseCardNumber('21_世界.txt', 'major', 'x'), 21)
  assert.equal(parseCardNumber('14_國王.txt', 'minor', 'x'), 14)
})

test('整副牌：同一牌組號碼重複、或總數不是 78 張都要擋下', () => {
  const card = (arcanaType, suit, number) => ({ arcanaType, suit, number, filePath: `${suit ?? 'major'}/${number}` })
  const deck = [
    ...Array.from({ length: 22 }, (_, n) => card('major', null, n)),
    ...['wands', 'cups', 'swords', 'pentacles'].flatMap((suit) =>
      Array.from({ length: 14 }, (_, n) => card('minor', suit, n + 1)),
    ),
  ]
  assert.doesNotThrow(() => validateDeck(deck))
  assert.throws(() => validateDeck([...deck, card('minor', 'cups', 3)]), /號碼重複/)
  assert.throws(() => validateDeck(deck.slice(1)), /牌數不對/)
})
