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
// 每個領域一份表，因為「替提問者預設身分」在各領域長成不同的樣子：
//   money：預設有房貸、有保險、在接案
//   love ：預設已經在一起、已婚、同住、有小孩（問的人可能在問一個還沒開始的人）
//   work ：預設是上班族、有主管、有團隊（問的人可能在創業、接案、找工作、考試）
const SCOPED_BY_DOMAIN = {
  money: {
    保險: [], 房貸: [], 退休: [], 信用卡: [], 轉貸: [], 定期定額: [], 淨值表: [],
    學費: ['錢幣侍者', '錢幣八'], 教材: ['錢幣侍者', '錢幣八'], 課程: ['錢幣侍者', '錢幣八'],
    前輩: ['教皇'], 伴侶: ['戀人'], 夫妻: ['戀人'],
    分潤: ['錢幣三'], 報價: ['錢幣三'], 接案: [], 客戶: [], 報價單: [], 作品集: [],
    家人: ['戀人', '錢幣十', '錢幣皇后'],
  },
  love: {
    // 預設「已經在一起」或走到某個階段
    結婚: [], 婚禮: [], 聘金: [], 見家長: [], 婆家: [], 公婆: [], 嫁: [], 娶: [],
    同居: [], 搬進來: [], 搬去住: [], 分房: [],
    小孩: [], 孩子: [], 懷孕: [], 生育: [],
    男友: [], 女友: [], 老公: [], 老婆: [], 太太: [], 丈夫: [], 妻子: [],
    紀念日: [], 情人節: [], 約會: [], 牽手: [], 接吻: [], 遠距離: [],
    // 這幾個是牌義本身才留
    前任: ['死神', '審判', '聖杯六'], 復合: ['審判', '死神', '命運之輪'],
    第三者: ['惡魔', '月亮'], 外遇: ['惡魔', '月亮'], 劈腿: ['惡魔', '月亮'],
    分手: ['死神', '塔', '寶劍三'], 曖昧: ['月亮'], 告白: ['聖杯王牌', '戀人'],
  },
  work: {
    // 預設是「有主管、有同事的上班族」
    主管: ['皇帝', '教皇'], 老闆: ['皇帝'], 上司: ['皇帝', '教皇'],
    面試: [], 履歷: [], 離職: ['死神'], 轉職: ['死神', '命運之輪'], 升遷: [], 考績: [],
    加薪: [], 年終: [], 打卡: [], 加班: [], 請假: [], 部門: [], 團隊: [], 同事: [],
    下屬: ['皇帝', '權杖國王'], 客戶: ['權杖三', '錢幣三'], 考試: ['寶劍八'], 證照: [],
    創業: ['權杖王牌', '魔術師'], 合約: [], 專案: [],
  },
};

const [domain, suit, ...only] = process.argv.slice(2);
if (!domain || !suit) {
  console.error('用法：node scripts/pairtools/checkScope.js <domain> <suit> [來源牌...]');
  process.exit(1);
}
const SCOPED = SCOPED_BY_DOMAIN[domain];
if (!SCOPED) {
  console.error(`沒有 ${domain} 的情境詞表。可用：${Object.keys(SCOPED_BY_DOMAIN).join('、')}`);
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
  const HINT = {
    money: '金額、比例、期限、次數、書面、順序、停損點、比價、第三方意見、先小後大',
    love: '一句話、一個問題、一次見面、訊息的次數、要等多久、一個界線、一個條件、寫下來',
    work: '一件事、一個期限、一次對話、書面、順序、範圍、一個人、先小規模再放大',
  };
  console.log(`改法：換成任何問${domain === 'money' ? '錢' : domain === 'love' ? '感情' : '工作'}的人都有的東西——${HINT[domain]}。`);
  console.log('      動作仍要帶數量、期限或形式其中一項，否則就退回「先停」「慢慢來」那種萬用詞。');
}
