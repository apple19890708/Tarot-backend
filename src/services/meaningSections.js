// 牌義文字的小標題。資料有兩種格式：
//   格式一：小標題自成一行，內容在後續行
//   格式二：小標題：內容（同一行，全形或半形冒號）
const SECTION_HEADINGS = [
  '核心訊息',
  '心理層面',
  '現實狀況',
  '行動建議',
  '核心警示',
  '可能的負面表現',
  '調整建議',
]

const HEADING_SET = new Set(SECTION_HEADINGS)

// 把牌義行解析成 [{ heading, lines }]，沒有小標題的內容歸在 heading 為空的那組
function parseMeaningGroups(rawLines) {
  const groups = []
  let current = null

  const openGroup = (heading) => {
    current = { heading, lines: [] }
    groups.push(current)
    return current
  }

  for (const raw of Array.isArray(rawLines) ? rawLines : []) {
    const text = String(raw ?? '').trim()
    if (!text) {
      continue
    }

    if (HEADING_SET.has(text)) {
      openGroup(text)
      continue
    }

    const inline = text.match(/^([^：:]{2,10})[：:]\s*(.*)$/)
    if (inline && HEADING_SET.has(inline[1])) {
      const group = openGroup(inline[1])
      if (inline[2]) {
        group.lines.push(inline[2])
      }
      continue
    }

    if (!current) {
      openGroup('')
    }
    current.lines.push(text)
  }

  return groups.filter((group) => group.lines.length > 0)
}

// 取「核心訊息」（或第一組）的第一句，作為這張牌的開場
function getCoreMessage(groups) {
  const core = groups.find((group) => group.heading === '核心訊息' || group.heading === '核心警示')
  return (core || groups[0])?.lines[0] || ''
}

module.exports = {
  SECTION_HEADINGS,
  parseMeaningGroups,
  getCoreMessage,
}
