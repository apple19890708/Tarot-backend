const fs = require('fs')
const path = require('path')

const SUIT_MAP = {
  大阿卡納: { arcanaType: 'major', suit: null },
  權杖: { arcanaType: 'minor', suit: 'wands' },
  聖杯: { arcanaType: 'minor', suit: 'cups' },
  寶劍: { arcanaType: 'minor', suit: 'swords' },
  星幣: { arcanaType: 'minor', suit: 'pentacles' },
  錢幣: { arcanaType: 'minor', suit: 'pentacles' },
}

function collectCardFiles(rootDirectory) {
  const directories = Object.keys(SUIT_MAP)

  return directories.flatMap((directoryName) => {
    const directoryPath = path.join(rootDirectory, directoryName)

    // 同一花色可能有「星幣／錢幣」兩種資料夾名稱，不存在的就跳過
    if (!fs.existsSync(directoryPath)) return []

    const fileNames = fs.readdirSync(directoryPath)

    return fileNames
      .filter((fileName) => fileName.endsWith('.txt'))
      .map((fileName) => path.join(directoryPath, fileName))
  })
}

// 每張牌都有自己的號碼：大牌 0～21（0 是愚者），小牌 1～14（11～14 是宮廷牌）。
// 號碼取自牌檔檔名開頭，解析不到或超出範圍一律報錯，不能給預設值 ——
// 預設成 0 等於把這張牌悄悄當成愚者，數字階段、牌意對照全部跟著錯，而且沒有任何警告。
const NUMBER_RANGE = {
  major: [0, 21],
  minor: [1, 14],
}

function parseCardNumber(fileName, arcanaType, relativePath) {
  const match = fileName.match(/^(\d+)/)
  if (!match) {
    throw new Error(`牌檔檔名開頭沒有號碼：${relativePath}。每張牌都有自己的號碼，請把號碼加在檔名最前面。`)
  }

  const number = Number.parseInt(match[1], 10)
  const [min, max] = NUMBER_RANGE[arcanaType]
  if (number < min || number > max) {
    throw new Error(`牌檔號碼超出範圍：${relativePath} 是 ${number}，${arcanaType === 'major' ? '大牌' : '小牌'}應在 ${min}～${max}。`)
  }
  return number
}

function cleanLine(line) {
  return line.trim().replace(/^[-*•]\s*/, '').replace(/^\d+\)\s*/, '')
}

function splitTitle(titleLine) {
  const match = titleLine.match(/^(.+?)\s+([A-Za-z][A-Za-z0-9 '&-:]+)$/)

  if (!match) {
    return {
      nameZh: titleLine.trim(),
      nameEn: '',
    }
  }

  return {
    nameZh: match[1].trim(),
    nameEn: match[2].trim(),
  }
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function extractSections(lines) {
  const sections = {}
  let currentSection = null

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      continue
    }

    const sectionMatch = line.match(/^【(.+?)】$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
      sections[currentSection] = []
      continue
    }

    if (!currentSection) {
      continue
    }

    sections[currentSection].push(cleanLine(line))
  }

  return sections
}

function parseKeywords(sections) {
  const basicInfo = sections['基本資訊'] || []
  const keywordLine = basicInfo.find((line) => line.startsWith('關鍵詞：'))

  if (!keywordLine) {
    return []
  }

  return keywordLine
    .replace('關鍵詞：', '')
    .split(/[、,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseCardFile(filePath, workspaceRoot) {
  const relativePath = path.relative(workspaceRoot, filePath)
  const folderName = relativePath.split(path.sep)[0]
  const suitConfig = SUIT_MAP[folderName]
  if (!suitConfig) {
    throw new Error(`無法判斷牌組：${relativePath}（資料夾要是 ${Object.keys(SUIT_MAP).join('／')} 其中之一）`)
  }
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  const titleLine = lines[0] || path.basename(filePath, '.txt')
  const sourceLine = lines.find((line) => line.startsWith('來源：')) || ''
  const sections = extractSections(lines.slice(3))
  const { nameZh, nameEn } = splitTitle(titleLine)
  const fileName = path.basename(filePath)
  const number = parseCardNumber(fileName, suitConfig.arcanaType, relativePath)
  const keywords = parseKeywords(sections)
  const summary = (sections['正位牌義'] || [])[0] || ''
  const slugBase = nameEn || `${folderName}-${number}`

  return {
    slug: `${suitConfig.arcanaType}-${number}-${slugify(slugBase)}`,
    nameZh,
    nameEn,
    arcanaType: suitConfig.arcanaType,
    suit: suitConfig.suit,
    number,
    source: sourceLine.replace('來源：', '').trim(),
    filePath: relativePath.replace(/\\/g, '/'),
    keywords,
    summary,
    sections,
  }
}

// 整副牌的檢查：同一牌組不能有重複號碼（例如「星幣」「錢幣」兩個資料夾都放了同一張），
// 總數要是 78 張。匯入前就擋下來，免得資料庫被清空後才發現少牌。
function validateDeck(cards) {
  const seen = new Map()
  cards.forEach((card) => {
    const key = `${card.arcanaType}:${card.suit ?? 'major'}:${card.number}`
    if (seen.has(key)) {
      throw new Error(`號碼重複：${seen.get(key)} 和 ${card.filePath} 都是 ${card.number} 號`)
    }
    seen.set(key, card.filePath)
  })

  if (cards.length !== 78) {
    throw new Error(`牌數不對：讀到 ${cards.length} 張，一副塔羅牌應該是 78 張。`)
  }
}

module.exports = {
  collectCardFiles,
  parseCardFile,
  parseCardNumber,
  validateDeck,
}