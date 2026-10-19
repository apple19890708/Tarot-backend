// 牌陣位置之間的關係型態。詳見 doc/v06-tarot-spread-relations-plan.md
// 辭典的 key 不含 kind，kind 只負責外層的框架句，所以 v5 生成的內容可以全部重用。

const RELATION_KINDS = {
  sequence: {
    label: '順承',
    // frame(a, b) 產生「這兩張牌是什麼關係」的開頭
    frame: (a, b) => `${a}走到${b}`,
  },
  crossing: {
    label: '橫跨',
    frame: (a, b) => `擋在${a}前面的是${b}`,
  },
  contrast: {
    label: '對照',
    frame: (a, b) => `${a}與${b}的落差`,
  },
  depth: {
    label: '表裡',
    frame: (a, b) => `表面是${a}，底下是${b}`,
  },
  remedy: {
    label: '對策',
    frame: (a, b) => `面對${a}，${b}是可用的方式`,
  },
  projection: {
    label: '投射',
    frame: (a, b) => `你期待的是${a}，實際走向是${b}`,
  },
  arc: {
    label: '整體',
    frame: (a, b) => `從${a}到${b}這整條線`,
  },
}

const DEFAULT_KIND = 'sequence'

module.exports = {
  RELATION_KINDS,
  DEFAULT_KIND,
}
