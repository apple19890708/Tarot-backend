const fs = require('fs')
const path = require('path')

const SUIT_MAP = {
  大阿卡納: { arcanaType: 'major', suit: null },
  權杖: { arcanaType: 'minor', suit: 'wands' },
  聖杯: { arcanaType: 'minor', suit: 'cups' },
  寶劍: { arcanaType: 'minor', suit: 'swords' },
  星幣: { arcanaType: 'minor', suit: 'pentacles' },
}

function collectCardFiles(rootDirectory) {
  const directories = Object.keys(SUIT_MAP)

  return directories.flatMap((directoryName) => {
    const directoryPath = path.join(rootDirectory, directoryName)
    const fileNames = fs.readdirSync(directoryPath)

    return fileNames
      .filter((fileName) => fileName.endsWith('.txt'))
      .map((fileName) => path.join(directoryPath, fileName))
  })
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
  const content = fs.readFileSync(filePath, 'utf8')
  const lines = content.split(/\r?\n/)
  const titleLine = lines[0] || path.basename(filePath, '.txt')
  const sourceLine = lines.find((line) => line.startsWith('來源：')) || ''
  const sections = extractSections(lines.slice(3))
  const { nameZh, nameEn } = splitTitle(titleLine)
  const fileName = path.basename(filePath)
  const numberMatch = fileName.match(/^(\d+)/)
  const number = numberMatch ? Number.parseInt(numberMatch[1], 10) : 0
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

module.exports = {
  collectCardFiles,
  parseCardFile,
}