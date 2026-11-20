// 日記內容（Tiptap JSON）的驗證與純文字摘要（v26 計畫 2）。
// 只收編輯器真的會產生的節點與標記（白名單），屬性也只留認得的；其他一律拒絕，不是悄悄刪掉，
// 前端送錯時才看得出來。前端顯示用唯讀編輯器渲染、不用 v-html，這裡再擋一層
const MAX_BYTES = 50 * 1024
const MAX_DEPTH = 20
const SUMMARY_LENGTH = 200

// 節點：哪些屬性可以有、值要怎麼檢查
const NODES = {
  doc: {},
  paragraph: {},
  text: {},
  hardBreak: {},
  heading: { level: (value) => [1, 2, 3].includes(value) },
  bulletList: {},
  orderedList: { start: (value) => Number.isInteger(value) && value >= 1 && value <= 10000, type: (value) => value === null },
  listItem: {},
  taskList: {},
  taskItem: { checked: (value) => typeof value === 'boolean' },
  blockquote: {},
  horizontalRule: {},
}
const MARKS = new Set(['bold', 'italic', 'strike', 'highlight'])
// 結構：哪些節點不能有子節點、子節點只能是什麼（api-reviewer 2026-11-20：原本只看類型不看結構）
const LEAVES = new Set(['text', 'hardBreak', 'horizontalRule'])
const CHILDREN = {
  bulletList: ['listItem'],
  orderedList: ['listItem'],
  taskList: ['taskItem'],
}
// listItem／taskItem 只能出現在對應的清單裡
const PARENTS = {
  listItem: ['bulletList', 'orderedList'],
  taskItem: ['taskList'],
}
// 一律只查自己的屬性：NODES['constructor']、spec['__proto__'] 這類原型鏈名稱不能算在白名單裡
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
// 換成新的一行的區塊（摘要時用換行分開）
const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'taskItem', 'blockquote', 'horizontalRule'])

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// 回傳錯誤訊息（字串）或 null
function checkNode(node, depth, parentType = null) {
  if (depth > MAX_DEPTH) return '日記的層次太深了。'
  if (!isPlainObject(node)) return '日記內容格式不對。'
  if (typeof node.type !== 'string' || !own(NODES, node.type)) return `日記裡有不支援的內容（${String(node.type).slice(0, 30)}）。`
  const spec = NODES[node.type]
  // doc 只能在最上層；清單項目只能在對應的清單裡；清單裡只能放清單項目
  if ((node.type === 'doc') !== (depth === 0)) return '日記內容格式不對。'
  if (own(PARENTS, node.type) && !PARENTS[node.type].includes(parentType)) return '日記內容格式不對。'
  if (parentType && own(CHILDREN, parentType) && !CHILDREN[parentType].includes(node.type)) return '日記內容格式不對。'
  if (LEAVES.has(node.type) && node.content !== undefined) return '日記內容格式不對。'
  for (const key of Object.keys(node)) {
    if (!['type', 'attrs', 'content', 'text', 'marks'].includes(key)) return '日記內容格式不對。'
  }
  if (node.attrs !== undefined) {
    if (!isPlainObject(node.attrs)) return '日記內容格式不對。'
    for (const [key, value] of Object.entries(node.attrs)) {
      if (!own(spec, key) || !spec[key](value)) return '日記內容格式不對。'
    }
  }
  if (node.type === 'text') {
    if (typeof node.text !== 'string' || !node.text) return '日記內容格式不對。'
    if (node.content !== undefined) return '日記內容格式不對。'
  } else if (node.text !== undefined || node.marks !== undefined) {
    return '日記內容格式不對。'
  }
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) return '日記內容格式不對。'
    for (const mark of node.marks) {
      if (!isPlainObject(mark) || !MARKS.has(mark.type) || Object.keys(mark).some((key) => key !== 'type')) {
        return '日記裡有不支援的文字樣式。'
      }
    }
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) return '日記內容格式不對。'
    for (const child of node.content) {
      const error = checkNode(child, depth + 1, node.type)
      if (error) return error
    }
  }
  return null
}

function plainText(node, out = []) {
  if (node.type === 'text') out.push(node.text)
  else if (node.type === 'hardBreak') out.push('\n')
  for (const child of node.content || []) plainText(child, out)
  if (BLOCKS.has(node.type)) out.push('\n')
  return out
}

// 驗證並整理：{ content, text } 或 { error }
function validateJournalContent(content) {
  if (!isPlainObject(content) || content.type !== 'doc') return { error: '日記內容格式不對。' }
  if (Buffer.byteLength(JSON.stringify(content), 'utf8') > MAX_BYTES) return { error: '日記太長了，請分成幾篇寫（每篇 50KB 以內）。' }
  const error = checkNode(content, 0)
  if (error) return { error }
  const text = plainText(content)
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
  return { content, text }
}

// 清單與月曆顯示用的摘要
function summaryOf(text) {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  return oneLine.length > SUMMARY_LENGTH ? `${oneLine.slice(0, SUMMARY_LENGTH)}…` : oneLine
}

module.exports = { validateJournalContent, summaryOf, MAX_BYTES }
