// 重大訊息的重點整理：公司公告多半是「1.欄位:內容」的制式表格，一半以上是「不適用」「無」。
// 這裡把有內容、一般人看得懂的欄位挑出來（規則比對，不用 AI），畫面先顯示重點，原文收起來。
// 讀取時才算（不存進資料庫），規則改了，舊的公告也會跟著更新。
// 規則來自 2026-11-06 觀測站 686 則公告的抽查（財報、資金貸與、公開收購、人事異動、取得資產最多）。

// 編號欄位的開頭：「1.」「12.」「1、」「(1)」；只認行首，避免切到內文的小數點
const ITEM_START = /^(?:\(?\d{1,2}\)|\d{1,2}[.．、])\s*/

// 這些值等於沒有內容
const EMPTY_VALUE = /^(?:不適用|無|否|否或不適用|不適用或否|na|n\/a|none|-|—|－|無此情形|未定|本公司)[。.]?$/i
// 制式句：「依據『…處理準則』規定辦理公告」
const BOILERPLATE_VALUE = /^依(?:據)?[^。]{0,80}規定(?:辦理)?(?:公告)?[。.]?$/

// 一般人用不到、或和別的欄位重複的制式欄位
const SKIP_LABEL =
  /估價|開業證書|監察人|審計委員會|異議|其他核決日期|董事會通過日期|是否為限定價格|特定價格|特殊價格|會計師|律師|證券承銷商|所在地|地址|歸屬於母公司|其他應敘明事項|其他敘明事項|前已就同一件事件|提報董事會或經董事會決議日期|是否為董事會授權/

// 欄位名稱改白話（依序套用）
const LABEL_RENAMES = [
  [/^1月1日累計至本期止/, '今年累計'],
  [/本期淨利/, '淨利'],
  [/基本每股盈餘/, '每股盈餘'],
  [/^財務報告或年度自結財務資訊報導期間起訖日期$/, '報告期間'],
  [/^被收購有價證券之公開發行公司名稱$/, '被收購的公司'],
  [/^公開收購人之公司名稱$/, '收購方'],
  [/^與資金貸與他人公司之關係$/, '和借款公司的關係'],
  [/^本次新增資金貸與之金額$/, '這次新借出'],
  [/^原資金貸與之餘額$/, '原本借出餘額'],
  [/^資金貸與之限額$/, '可借出上限'],
  [/^本次新增資金貸與之原因$/, '借款原因'],
]

// 挑重點的優先順序：一般人最想知道的是金額、獲利、原因與內容；日期、公司名稱、資產負債放後面
const HIGH_LABEL = /每股盈餘|淨利|營業收入|金額|價格|總價|原因|緣由|內容|目的|異動情形|新任者|舊任者|種類|因應措施|收購|新借出/
const LOW_LABEL = /日期|期間|公司名稱|^與.*關係|總資產|總負債|權益|生效|上限|餘額/

const MAX_POINTS = 6
const MAX_VALUE = 120

// 欄位名稱括號裡的單位（「(仟元)」「(元)」）要留下來接在數字後面
const UNIT_IN_LABEL = /[（(]\s*(仟元|千元|元|股|張|%|％)\s*[)）]/

function labelOf(raw) {
  const unitMatch = raw.match(UNIT_IN_LABEL)
  const unit = unitMatch ? (unitMatch[1] === '仟元' ? '千元' : unitMatch[1]) : ''
  // 括號補充（「契約主要內容（含契約總金額…）」「(淨損)」「(請輸入…)」）拿掉，只留主幹
  const cut = raw.search(/[（(]/)
  let label = (cut > 0 ? raw.slice(0, cut) : raw).replace(/[、，,\s]+$/, '').trim()
  for (const [pattern, to] of LABEL_RENAMES) label = label.replace(pattern, to)
  return { label, unit }
}

function valueOf(raw, unit) {
  let text = raw
    .replace(/\s+/g, ' ')
    // 「(下稱「台信電訊」)」「(以下簡稱利晉)」這類代稱說明
    .replace(/[（(]?(?:以下)?(?:下稱|簡稱)[^)）]*[)）]/g, '')
    .trim()
  // 財報用括號表示虧損：(40,959) → -40,959
  text = text.replace(/^[（(]([\d,.]+)[)）]$/, '-$1')
  // 只有數字時才接單位（內容裡已經寫「新台幣…仟元」的不重複接）
  if (unit && /^-?[\d,.]+$/.test(text)) text = `${text} ${unit}`
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text
}

// 把說明全文切成編號欄位：[{ label, value }]；不是編號格式就回傳空陣列
function splitItems(detail) {
  const items = []
  for (const raw of String(detail || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (ITEM_START.test(line)) {
      items.push(line.replace(ITEM_START, ''))
    } else if (items.length) {
      items[items.length - 1] += `\n${line}`
    }
  }
  return items.map((item) => {
    // 欄位名稱和內容用第一個冒號分開；沒有冒號的整段當內容
    const at = item.search(/[:：]/)
    if (at < 0) return { label: '', value: item }
    return { label: item.slice(0, at).replace(/\n/g, '').trim(), value: item.slice(at + 1).trim() }
  })
}

const priorityOf = (label) => (HIGH_LABEL.test(label) ? 2 : LOW_LABEL.test(label) ? 0 : 1)

// 回傳 [{ label, value }]，最多 MAX_POINTS 點、維持公告原本的順序；挑不出東西時是空陣列（畫面就只顯示原文）
function digestMaterialNews(detail) {
  const candidates = []
  splitItems(detail).forEach(({ label: rawLabel, value: rawValue }, index) => {
    const flat = rawValue.replace(/\s+/g, ' ').trim()
    if (!flat || EMPTY_VALUE.test(flat) || BOILERPLATE_VALUE.test(flat)) return
    if (rawLabel && SKIP_LABEL.test(rawLabel)) return
    const { label, unit } = labelOf(rawLabel)
    candidates.push({ index, priority: priorityOf(label), label, value: valueOf(flat, unit) })
  })
  return candidates
    .sort((a, b) => b.priority - a.priority || a.index - b.index)
    .slice(0, MAX_POINTS)
    .sort((a, b) => a.index - b.index)
    .map(({ label, value }) => ({ label, value }))
}

// 原文的欄位表（畫面的「看公告原文」用）：欄位名稱保留原文，內容整理空白；沒有內容的另外列，畫面合併成一行
function materialFields(detail) {
  const fields = []
  const empty = []
  for (const { label, value } of splitItems(detail)) {
    const flat = value.replace(/[ \t　]+/g, ' ').replace(/\n+/g, '\n').trim()
    if (!flat || EMPTY_VALUE.test(flat.replace(/\s+/g, ' '))) {
      if (label) empty.push(label)
    } else {
      fields.push({ label, value: flat })
    }
  }
  return { fields, empty }
}

module.exports = { digestMaterialNews, materialFields, splitItems }
