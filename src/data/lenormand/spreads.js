// 雷諾曼牌陣定義（v27，詳見 doc/v27-lenormand-plan.md 3-4）。
//
// 資料形狀沿用塔羅的 src/data/spreads.js，前端 SpreadLayout 不用改就能畫：
//   key、name、cardCount、description、grid、positions[].layout（col／row 由 1 起算）、relations（索引 0 起算）
// 和塔羅不同的地方：
//   - 沒有位置權重，weight 省略。
//   - positions 的順序一律是「由左到右、由上到下」，也就是使用者攤牌、輸入實體牌的順序。
//   - relations 的 kind 用雷諾曼自己的：
//       modifier：from 是被形容的牌（主詞），to 是形容它的牌
//       sequence：時間上的先後（from 在前）
//   - 大藍圖的每個位置帶 house（宮位編號，和傳統牌號相同）與 houseTheme。
//   - requiresSignificator：要不要選代表牌（紳士 28／淑女 29），只有大藍圖必填。
//   - drawModes：可用的抽牌方式。auto 自動、fan 扇形挑牌、input 輸入實體牌；大藍圖 36 張不提供扇形（3-9）。
const { houses } = require('./houses')
const { deepFreeze } = require('../../lib/deepFreeze')

const ALL_MODES = ['auto', 'fan', 'input']

// 九宮格：列是主題（由上到下），欄是時間（由左到右）
const NINE_BOX_ROWS = [
  { key: 'mind', label: '思想／未掌握／希望的事', prompt: '你心裡想的、還沒掌握到、或希望發生的事' },
  { key: 'reality', label: '現實／問題的狀況', prompt: '實際發生的狀況與問題本身' },
  { key: 'heart', label: '內心感受／已掌握的事', prompt: '你內心真正的感受，以及已經掌握在手上的事' },
]
const NINE_BOX_COLS = [
  { key: 'past', label: '過去' },
  { key: 'present', label: '現在' },
  { key: 'future', label: '未來' },
]

function nineBoxPositions() {
  const positions = []
  NINE_BOX_ROWS.forEach((row, r) => {
    NINE_BOX_COLS.forEach((col, c) => {
      positions.push({
        key: `${row.key}-${col.key}`,
        label: `${col.label} × ${row.label}`,
        prompt: `${col.label}：${row.prompt}`,
        layout: { col: c + 1, row: r + 1 },
      })
    })
  })
  return positions
}

// 每一列由左到右是過去 → 現在 → 未來
function nineBoxRelations() {
  const relations = []
  for (let r = 0; r < NINE_BOX_ROWS.length; r += 1) {
    const base = r * NINE_BOX_COLS.length
    relations.push({ from: base, to: base + 1, kind: 'sequence' }, { from: base + 1, to: base + 2, kind: 'sequence' })
  }
  return relations
}

// 大藍圖 9×4（D3）：第 n 個位置就是第 n 宮
const GRAND_COLS = 9
const GRAND_ROWS = 4

function grandTableauPositions() {
  return houses.map(({ house, theme }, index) => ({
    key: `house-${house}`,
    label: `${house} ${theme}`,
    prompt: `第 ${house} 宮：${theme}`,
    house,
    houseTheme: theme,
    layout: { col: (index % GRAND_COLS) + 1, row: Math.floor(index / GRAND_COLS) + 1 },
  }))
}

const spreads = deepFreeze([
  {
    key: 'theme-3',
    name: '三張主題牌',
    cardCount: 3,
    description: '中間是主題牌，左右兩張是形容主題的牌，把三張讀成一句話。',
    grid: { cols: 3, rows: 1 },
    requiresSignificator: false,
    drawModes: ALL_MODES,
    positions: [
      { key: 'left', label: '左側形容', prompt: '從一個面向形容主題', layout: { col: 1, row: 1 } },
      { key: 'theme', label: '主題牌', prompt: '這件事的核心主題', layout: { col: 2, row: 1 } },
      { key: 'right', label: '右側形容', prompt: '從另一個面向形容主題', layout: { col: 3, row: 1 } },
    ],
    relations: [
      { from: 1, to: 0, kind: 'modifier' },
      { from: 1, to: 2, kind: 'modifier' },
    ],
  },
  {
    key: 'theme-5',
    name: '五張主題牌',
    cardCount: 5,
    description: '主題牌在中間，左右各兩張，外側的牌再形容內側的牌，把主題描述得更細。',
    grid: { cols: 5, rows: 1 },
    requiresSignificator: false,
    drawModes: ALL_MODES,
    positions: [
      { key: 'outer-left', label: '左外側', prompt: '補充說明左側那張牌', layout: { col: 1, row: 1 } },
      { key: 'left', label: '左側形容', prompt: '從一個面向形容主題', layout: { col: 2, row: 1 } },
      { key: 'theme', label: '主題牌', prompt: '這件事的核心主題', layout: { col: 3, row: 1 } },
      { key: 'right', label: '右側形容', prompt: '從另一個面向形容主題', layout: { col: 4, row: 1 } },
      { key: 'outer-right', label: '右外側', prompt: '補充說明右側那張牌', layout: { col: 5, row: 1 } },
    ],
    relations: [
      { from: 2, to: 1, kind: 'modifier' },
      { from: 2, to: 3, kind: 'modifier' },
      { from: 1, to: 0, kind: 'modifier' },
      { from: 3, to: 4, kind: 'modifier' },
    ],
  },
  {
    key: 'timeline-3',
    name: '過去現在未來',
    cardCount: 3,
    description: '由左到右是過去、現在、未來，看事情怎麼走到這裡、接下來往哪裡去。',
    grid: { cols: 3, rows: 1 },
    requiresSignificator: false,
    drawModes: ALL_MODES,
    positions: [
      { key: 'past', label: '過去', prompt: '事情怎麼走到這一步', layout: { col: 1, row: 1 } },
      { key: 'present', label: '現在', prompt: '目前的狀況', layout: { col: 2, row: 1 } },
      { key: 'future', label: '未來', prompt: '照目前的方向會怎麼發展', layout: { col: 3, row: 1 } },
    ],
    relations: [
      { from: 0, to: 1, kind: 'sequence' },
      { from: 1, to: 2, kind: 'sequence' },
    ],
  },
  {
    key: 'nine-box',
    name: '九宮格',
    cardCount: 9,
    description: '橫軸由左到右是過去、現在、未來；縱軸由上到下是思想、現實、內心。中間那張是現在的核心。',
    grid: { cols: 3, rows: 3 },
    requiresSignificator: false,
    drawModes: ALL_MODES,
    positions: nineBoxPositions(),
    relations: nineBoxRelations(),
  },
  {
    key: 'grand-tableau',
    name: '三十六宮位大藍圖',
    cardCount: 36,
    description: '從 52 張選 36 張排成 9×4，每一格對應一個宮位，以代表牌為中心解讀全局。',
    grid: { cols: GRAND_COLS, rows: GRAND_ROWS },
    requiresSignificator: true,
    drawModes: ['auto', 'input'],
    positions: grandTableauPositions(),
    relations: [],
  },
])

const spreadByKey = new Map(spreads.map((spread) => [spread.key, spread]))

module.exports = { spreads, spreadByKey, NINE_BOX_ROWS, NINE_BOX_COLS, GRAND_COLS, GRAND_ROWS }
