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
    key: 'action-outcome',
    name: '行動與結果',
    cardCount: 4,
    description: '看清楚現在的做法會帶來什麼結果，以及牌建議怎麼調整。',
    // 上排是「現況 → 行動 → 結果」這條線，建議放在行動正下方，方便對照
    grid: { cols: 3, rows: 2 },
    positions: [
      { key: 'present', label: '現況', prompt: '你目前所處的狀況', weight: 0.25, layout: { col: 1, row: 1 } },
      { key: 'action', label: '行動', prompt: '你正在做或打算採取的做法', weight: 0.25, layout: { col: 2, row: 1 } },
      { key: 'outcome', label: '結果', prompt: '照這個做法下去會得到的結果', weight: 0.3, layout: { col: 3, row: 1 } },
      { key: 'advice', label: '建議', prompt: '牌給你的調整方向', weight: 0.2, layout: { col: 2, row: 2 } },
    ],
    relations: [
      { from: 0, to: 1, kind: 'sequence' }, // 現況 → 行動
      { from: 1, to: 2, kind: 'sequence' }, // 行動 → 結果
      { from: 1, to: 3, kind: 'contrast' }, // 你打算做的 vs. 牌建議的，這個牌陣的重點
      { from: 0, to: 3, kind: 'remedy' }, // 面對現況，建議是可用的方式
    ],
  },
  {
    key: 'investment-decision',
    name: '投資決策',
    cardCount: 5,
    description: '不猜漲跌，而是盤點你這次進場的動機、忽略的風險與機會，看清自己的決策狀態。',
    // 排成十字：上方動機、左右是風險與機會、中間是建議、下方是結果。
    // 位置 key 沿用既有判定：動機讀「想要與害怕」、風險讀「隱藏影響」、機會讀「助力」
    grid: { cols: 3, rows: 3 },
    positions: [
      { key: 'hopes-fears', label: '動機', prompt: '你想進場的真正原因：是看好、貪心，還是怕錯過', weight: 0.2, layout: { col: 2, row: 1 } },
      { key: 'hidden', label: '忽略的風險', prompt: '這筆投資裡你還沒正視的風險', weight: 0.2, layout: { col: 1, row: 2 } },
      { key: 'positive', label: '可能的機會', prompt: '這件事裡真正站得住腳的機會', weight: 0.15, layout: { col: 3, row: 2 } },
      { key: 'advice', label: '建議的態度', prompt: '面對這筆投資最適合的心態與做法', weight: 0.2, layout: { col: 2, row: 2 } },
      { key: 'outcome', label: '結果', prompt: '照你目前的想法做下去，你會走到什麼處境', weight: 0.25, layout: { col: 2, row: 3 } },
    ],
    relations: [
      { from: 1, to: 2, kind: 'contrast' }, // 風險 ↔ 機會，這個牌陣的重點
      { from: 1, to: 3, kind: 'remedy' }, // 面對風險，建議是可用的方式
      { from: 0, to: 4, kind: 'arc' }, // 動機 → 結果
      { from: 3, to: 4, kind: 'sequence' }, // 照建議調整後走到結果
    ],
  },
  {
    key: 'two-choice',
    name: '二擇一',
    cardCount: 5,
    description: '在兩個選項之間猶豫時，對照各自的近況與後續發展。',
    // 排成 V 字：求問者在最下方，左邊一路往上是甲、右邊是乙
    grid: { cols: 5, rows: 3 },
    positions: [
      { key: 'querent', label: '求問者', prompt: '你目前的狀況與問題的現況', weight: 0.2, layout: { col: 3, row: 3 } },
      { key: 'option-a-now', label: '甲的現況', prompt: '選擇甲的現況或近未來', weight: 0.15, layout: { col: 2, row: 2 } },
      { key: 'option-b-now', label: '乙的現況', prompt: '選擇乙的現況或近未來', weight: 0.15, layout: { col: 4, row: 2 } },
      { key: 'option-a-future', label: '甲的未來', prompt: '選擇甲以後的未來發展', weight: 0.25, layout: { col: 1, row: 1 } },
      { key: 'option-b-future', label: '乙的未來', prompt: '選擇乙以後的未來發展', weight: 0.25, layout: { col: 5, row: 1 } },
    ],
    relations: [
      { from: 1, to: 3, kind: 'sequence' }, // 甲的現況 → 甲的未來
      { from: 2, to: 4, kind: 'sequence' }, // 乙的現況 → 乙的未來
      { from: 1, to: 2, kind: 'contrast' }, // 甲、乙的現況對照
      { from: 3, to: 4, kind: 'contrast' }, // 甲、乙的未來對照
    ],
  },
  {
    // 2026-11-14 使用者要求新增。位置 key 沿用規則認得的：present／challenge／past／future／advice，
    // 時間走向（根源 → 核心 → 發展）與建議位置的判定才會套用
    key: 'cross',
    name: '十字牌陣',
    cardCount: 5,
    description: '看清楚現況的核心、卡住的地方、背後的成因、接下來的走向，以及可以怎麼做。',
    // 十字：核心在中央，阻礙在左、發展在右，根源在下、建議在上
    grid: { cols: 3, rows: 3 },
    positions: [
      { key: 'present', label: '核心', prompt: '問題當下的中心狀態、你目前面臨的主要處境或核心情緒', weight: 0.25, layout: { col: 2, row: 2 } },
      { key: 'challenge', label: '阻礙', prompt: '目前遇到的障礙、內在盲點或需要克服的難題', weight: 0.15, layout: { col: 1, row: 2 } },
      { key: 'past', label: '根源', prompt: '影響現狀的深層因素、事件的背景或過去的成因', weight: 0.15, layout: { col: 2, row: 3 } },
      { key: 'future', label: '發展', prompt: '維持現狀、順著目前方向推演下去，未來可能出現的變化', weight: 0.3, layout: { col: 3, row: 2 } },
      { key: 'advice', label: '建議', prompt: '可以考慮採取的實際行動、心態調整或突破口', weight: 0.15, layout: { col: 2, row: 1 } },
    ],
    relations: [
      { from: 0, to: 1, kind: 'crossing' }, // 核心被什麼擋住
      { from: 2, to: 0, kind: 'sequence' }, // 根源走到核心
      { from: 0, to: 3, kind: 'sequence' }, // 核心走到發展
      { from: 1, to: 4, kind: 'remedy' }, // 面對阻礙，建議是可用的方式
    ],
  },
  {
    // 2026-11-14 使用者要求新增。兩人關係：雙方嘴上（心裡）怎麼看對方、實際怎麼想，加上建議與結果。
    // 位置 key 只有 advice／outcome 是規則認得的，其他四格由 AI 依位置含意解讀
    key: 'relationship',
    name: '關係牌陣',
    cardCount: 6,
    description: '對照你和對方各自對這段關係的感覺與真正的想法，看兩人會走向哪裡。',
    // 中間一排從左到右：你的實際想法、你對對方、對方對你、對方的實際想法；建議在上、結果在下，都在正中央
    grid: { cols: 5, rows: 3 },
    positions: [
      { key: 'querent-thought', label: '你的實際想法', prompt: '你心裡對這段關係真正的想法與打算', weight: 0.15, layout: { col: 1, row: 2 } },
      { key: 'querent-feeling', label: '你對對方的看法', prompt: '你對對方的看法與感情', weight: 0.15, layout: { col: 2, row: 2 } },
      { key: 'partner-feeling', label: '對方對你的看法', prompt: '對方對你的看法與感情', weight: 0.15, layout: { col: 4, row: 2 } },
      { key: 'partner-thought', label: '對方的實際想法', prompt: '對方心裡對這段關係真正的想法與打算', weight: 0.15, layout: { col: 5, row: 2 } },
      { key: 'advice', label: '建議', prompt: '這段關係裡你最適合的態度與做法', weight: 0.15, layout: { col: 3, row: 1 } },
      { key: 'outcome', label: '結果', prompt: '照目前的狀態走下去，這段關係會走到哪裡', weight: 0.25, layout: { col: 3, row: 3 } },
    ],
    relations: [
      { from: 1, to: 0, kind: 'depth' }, // 你：表面的感情，底下的真正想法
      { from: 2, to: 3, kind: 'depth' }, // 對方：表面的感情，底下的真正想法
      { from: 1, to: 2, kind: 'contrast' }, // 兩人對彼此的感情對照
      { from: 0, to: 3, kind: 'contrast' }, // 兩人真正想法的落差，這個牌陣的重點
      { from: 4, to: 5, kind: 'remedy' }, // 照建議做，結果是否改變
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
    key: 'horseshoe',
    name: '馬蹄鐵',
    cardCount: 7,
    description: '經典的七張牌陣，從過去、隱藏影響到阻礙與外在環境，最後給出建議與結果。',
    // 排成 U 字：左邊由上往下是過去、現在，底部是隱藏影響、阻礙、環境，右邊由下往上是建議、結果
    grid: { cols: 5, rows: 3 },
    positions: [
      { key: 'past', label: '過去', prompt: '事情是怎麼走到這一步的', weight: 0.1, layout: { col: 1, row: 1 } },
      { key: 'present', label: '現在', prompt: '你當下面對的處境', weight: 0.15, layout: { col: 1, row: 2 } },
      { key: 'hidden', label: '隱藏影響', prompt: '你還沒注意到、在檯面下運作的因素', weight: 0.15, layout: { col: 2, row: 3 } },
      { key: 'challenge', label: '阻礙', prompt: '目前擋在前面的事', weight: 0.15, layout: { col: 3, row: 3 } },
      { key: 'environment', label: '外在環境', prompt: '身邊的人與外在條件', weight: 0.1, layout: { col: 4, row: 3 } },
      { key: 'advice', label: '建議', prompt: '最適合採取的態度與做法', weight: 0.15, layout: { col: 5, row: 2 } },
      { key: 'outcome', label: '結果', prompt: '照目前走向會走到的結果', weight: 0.2, layout: { col: 5, row: 1 } },
    ],
    relations: [
      { from: 0, to: 1, kind: 'sequence' }, // 過去 → 現在
      { from: 1, to: 2, kind: 'depth' }, // 表面是現在，底下是隱藏影響
      { from: 1, to: 3, kind: 'crossing' }, // 擋在現在前面的阻礙
      { from: 3, to: 5, kind: 'remedy' }, // 面對阻礙，建議是可用的方式
      { from: 1, to: 6, kind: 'arc' }, // 現在 → 結果
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
