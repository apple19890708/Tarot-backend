// 牌陣定義。詳見 doc/v06-tarot-spread-relations-plan.md
//
// weight：規則 11 的位置權重，同一牌陣總和須為 1
// layout：排列圖的網格座標（col / row 由 1 起算），overlay 代表疊在同格的另一張牌上
// relations：位置之間有意義的關係對（索引 0 起算）。未宣告時退回「相鄰兩張」。

const spreads = [
  {
    key: 'timeline',
    name: '時間之流',
    cardCount: 3,
    description: '快速查看過去、現在與未來的推進脈絡。',
    grid: { cols: 3, rows: 1 },
    positions: [
      { key: 'past', label: '過去', prompt: '事件如何走到這一步', weight: 0.2, layout: { col: 1, row: 1 } },
      { key: 'present', label: '現在', prompt: '你當下真正面對的處境', weight: 0.35, layout: { col: 2, row: 1 } },
      { key: 'future', label: '未來', prompt: '如果照目前方向前進，局勢會如何發展', weight: 0.45, layout: { col: 3, row: 1 } },
    ],
    relations: [
      { from: 0, to: 1, kind: 'sequence' },
      { from: 1, to: 2, kind: 'sequence' },
    ],
  },
  {
    key: 'core',
    name: '直指核心',
    cardCount: 4,
    description: '聚焦問題核心、阻礙、對策與可用資源。',
    grid: { cols: 3, rows: 3 },
    positions: [
      { key: 'core', label: '問題核心', prompt: '事情真正的核心在哪裡', weight: 0.3, layout: { col: 2, row: 1 } },
      { key: 'challenge', label: '障礙', prompt: '目前卡住你的阻力是什麼', weight: 0.2, layout: { col: 1, row: 2 } },
      { key: 'advice', label: '對策', prompt: '最應該採取的行動與方向', weight: 0.3, layout: { col: 3, row: 2 } },
      { key: 'resource', label: '資源', prompt: '你手上其實已經擁有的優勢', weight: 0.2, layout: { col: 2, row: 3 } },
    ],
    relations: [
      { from: 0, to: 1, kind: 'crossing' }, // 核心被什麼擋住
      { from: 1, to: 2, kind: 'remedy' }, // 面對障礙的方式
      { from: 2, to: 3, kind: 'sequence' }, // 對策走到資源
      { from: 0, to: 3, kind: 'contrast' }, // 核心與手上資源的落差
    ],
  },
  {
    key: 'guiding-star',
    name: '指引之星',
    cardCount: 7,
    description: '適合做較完整的局勢盤點與未來指引。',
    grid: { cols: 5, rows: 3 },
    positions: [
      { key: 'question', label: '問題', prompt: '現況總覽', weight: 0.1, layout: { col: 1, row: 2 } },
      { key: 'past', label: '過去影響', prompt: '該放下的舊影響', weight: 0.1, layout: { col: 2, row: 2 } },
      { key: 'negative', label: '負面影響', prompt: '需要看清與節制的能量', weight: 0.15, layout: { col: 3, row: 1 } },
      { key: 'present', label: '現在', prompt: '正在發生的事情', weight: 0.2, layout: { col: 3, row: 2 } },
      { key: 'positive', label: '正面影響', prompt: '能支撐你的助力', weight: 0.15, layout: { col: 3, row: 3 } },
      { key: 'future', label: '未來', prompt: '能量發展到高峰時的走向', weight: 0.15, layout: { col: 4, row: 2 } },
      { key: 'outcome', label: '終局', prompt: '這段經驗最後帶來的課題與收穫', weight: 0.15, layout: { col: 5, row: 2 } },
    ],
    relations: [
      { from: 1, to: 3, kind: 'sequence' }, // 過去影響 → 現在
      { from: 3, to: 5, kind: 'sequence' }, // 現在 → 未來
      { from: 2, to: 4, kind: 'contrast' }, // 負面影響 ↔ 正面影響
      { from: 0, to: 6, kind: 'arc' }, // 問題 → 終局
    ],
  },
  {
    key: 'celtic-cross',
    name: '塞爾特十字',
    cardCount: 10,
    description: '最完整的經典牌陣，從現況、阻礙、內外在到最終走向逐層盤點。',
    grid: { cols: 4, rows: 4 },
    positions: [
      // 阻礙傳統上橫跨在現況之上，但疊起來會互相遮住，改成排在現況正下方
      { key: 'present', label: '現況', prompt: '事情目前的核心狀態', weight: 0.15, layout: { col: 2, row: 2 } },
      { key: 'challenge', label: '阻礙', prompt: '橫跨在現況上的力量', weight: 0.12, layout: { col: 2, row: 3 } },
      { key: 'foundation', label: '根基', prompt: '潛意識、你沒說出口的動機', weight: 0.08, layout: { col: 2, row: 4 } },
      { key: 'past', label: '過去', prompt: '剛過去、正在淡出的影響', weight: 0.06, layout: { col: 1, row: 2 } },
      { key: 'conscious', label: '意識', prompt: '你認為自己要的、表面上的目標', weight: 0.09, layout: { col: 2, row: 1 } },
      { key: 'near-future', label: '近未來', prompt: '接下來即將發生的事', weight: 0.1, layout: { col: 3, row: 2 } },
      { key: 'self', label: '自我', prompt: '你在這件事裡的姿態', weight: 0.08, layout: { col: 4, row: 4 } },
      { key: 'environment', label: '環境', prompt: '他人與外在條件', weight: 0.07, layout: { col: 4, row: 3 } },
      { key: 'hopes-fears', label: '希望與恐懼', prompt: '你最期待也最害怕的', weight: 0.08, layout: { col: 4, row: 2 } },
      { key: 'outcome', label: '結果', prompt: '照目前走向會走到的結局', weight: 0.17, layout: { col: 4, row: 1 } },
    ],
    relations: [
      { from: 0, to: 1, kind: 'crossing' }, // 現況 × 阻礙，這個牌陣的核心
      { from: 2, to: 4, kind: 'depth' }, // 根基 × 意識，潛意識與表意識的落差
      { from: 3, to: 5, kind: 'sequence' }, // 過去 × 近未來
      { from: 6, to: 7, kind: 'contrast' }, // 自我 × 環境
      { from: 8, to: 9, kind: 'projection' }, // 希望恐懼 × 結果
      { from: 0, to: 9, kind: 'arc' }, // 現況 × 結果
    ],
  },
]

module.exports = spreads
