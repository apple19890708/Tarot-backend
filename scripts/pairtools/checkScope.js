// 情境假設稽核：著力點有沒有替提問者預設身分或人生階段。
//
// 同一個領域裡，提問的人可能在問投資、問加薪、問債務、問家裡的開銷、問要不要接一個案子。
// 「把保險、房貸、退休三件事各排一個時間處理」對問投資的人就是在回答別人的問題。
//
// 判準不是「不准出現具體名詞」——著力點本來就該具體。判準是：
//   這個情境詞如果不是那張牌本身在講的事，就該換成上位的說法。
// 所以每個詞都有一份「哪幾張牌可以用」的白名單：教皇段講前輩、戀人段講伴侶、
// 錢幣三講分潤、錢幣侍者講教材，都是牌義本身，留著比較好讀。
//
//   node scripts/pairtools/checkScope.js money pentacles [來源牌...]
const path = require('path');

const MAJORS = ['愚人', '魔術師', '女祭司', '女皇', '皇帝', '教皇', '戀人', '戰車', '力量', '隱士',
  '命運之輪', '正義', '吊人', '死神', '節制', '惡魔', '塔', '星星', '月亮', '太陽', '審判', '世界'];

// 情境詞 → 允許出現的牌（牌義本來就在講這件事）。空陣列＝哪裡都不該用。
const SCOPED = {
  保險: [], 房貸: [], 退休: [], 信用卡: [], 轉貸: [], 定期定額: [], 淨值表: [],
  學費: ['錢幣侍者', '錢幣八'], 教材: ['錢幣侍者', '錢幣八'], 課程: ['錢幣侍者', '錢幣八'],
  前輩: ['教皇'], 伴侶: ['戀人'], 夫妻: ['戀人'],
  分潤: ['錢幣三'], 報價: ['錢幣三'], 接案: [], 客戶: [], 報價單: [], 作品集: [],
  家人: ['戀人', '錢幣十', '錢幣皇后'],
};

const [domain, suit, ...only] = process.argv.slice(2);
if (!domain || !suit) {
  console.error('用法：node scripts/pairtools/checkScope.js <domain> <suit> [來源牌...]');
  process.exit(1);
}
const { COMBOS } = require(path.join('..', 'pairs', domain, suit + '.js'));

const isMajor = (n) => MAJORS.includes(n);
const rows = COMBOS
  .filter((r) => isMajor(r[0]) !== isMajor(r[1]))
  .filter((r) => !only.length || only.includes(r[0]));

let total = 0;
let flagged = 0;
for (const [from, to, texts] of rows) {
  texts.forEach((text, slot) => {
    total += 1;
    const hits = Object.entries(SCOPED)
      .filter(([word, allowed]) => text.includes(word) && !allowed.includes(from) && !allowed.includes(to))
      .map(([word]) => word);
    if (!hits.length) return;
    flagged += 1;
    console.log(`${from}→${to} ${slot}　【${hits.join('、')}】\n  ${text}`);
  });
}

console.log(`\n${rows.length} 列 / ${total} 句，預設情境 ${flagged} 句`);
if (flagged) {
  console.log('改法：換成任何問錢的人都有的東西——金額、比例、期限、次數、書面、順序、');
  console.log('      停損點、比價、第三方意見、先小後大。動作仍要帶數量、期限或形式其中一項。');
}
