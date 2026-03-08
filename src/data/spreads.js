const spreads = [
  {
    key: 'timeline',
    name: '時間之流',
    cardCount: 3,
    description: '快速查看過去、現在與未來的推進脈絡。',
    positions: [
      { key: 'past', label: '過去', prompt: '事件如何走到這一步' },
      { key: 'present', label: '現在', prompt: '你當下真正面對的處境' },
      { key: 'future', label: '未來', prompt: '如果照目前方向前進，局勢會如何發展' },
    ],
  },
  {
    key: 'core',
    name: '直指核心',
    cardCount: 4,
    description: '聚焦問題核心、阻礙、對策與可用資源。',
    positions: [
      { key: 'core', label: '問題核心', prompt: '事情真正的核心在哪裡' },
      { key: 'challenge', label: '障礙', prompt: '目前卡住你的阻力是什麼' },
      { key: 'advice', label: '對策', prompt: '最應該採取的行動與方向' },
      { key: 'resource', label: '資源', prompt: '你手上其實已經擁有的優勢' },
    ],
  },
  {
    key: 'guiding-star',
    name: '指引之星',
    cardCount: 7,
    description: '適合做較完整的局勢盤點與未來指引。',
    positions: [
      { key: 'question', label: '問題', prompt: '現況總覽' },
      { key: 'past', label: '過去影響', prompt: '該放下的舊影響' },
      { key: 'negative', label: '負面影響', prompt: '需要看清與節制的能量' },
      { key: 'present', label: '現在', prompt: '正在發生的事情' },
      { key: 'positive', label: '正面影響', prompt: '能支撐你的助力' },
      { key: 'future', label: '未來', prompt: '能量發展到高峰時的走向' },
      { key: 'outcome', label: '終局', prompt: '這段經驗最後帶來的課題與收穫' },
    ],
  },
]

module.exports = spreads