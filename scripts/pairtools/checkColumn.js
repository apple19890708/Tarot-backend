// 兩個方向的重複稽核（大×小）。既有的 auditMixedVoice 只看「同一張來源牌內部」有沒有
// 重複的開頭，抓不到下面這兩種整片套模子的寫法：
//
//   直欄：開頭錨在 to，於是同一張錢幣在 22 個大牌段裡的第一個子句一模一樣 22 次。
//   橫列：第二個子句放 from 的狀態，於是同一個大牌段裡 14 列的第二子句一模一樣 14 次
//         （「可是局勢看不清楚」「成果也很亮眼」）。
//
//   node scripts/pairtools/checkColumn.js money pentacles [--max 6]
//
// 判準（預設）：
//   - 直欄：同一個第一子句在同一欄出現超過 max 次
//   - 橫列：同一個第二子句在同一段出現超過 max 次
//   - 全檔：第二子句的起頭、機制句的收尾，任一種佔比超過兩成
const path = require('path');

const MAJORS = ['愚人', '魔術師', '女祭司', '女皇', '皇帝', '教皇', '戀人', '戰車', '力量', '隱士',
  '命運之輪', '正義', '吊人', '死神', '節制', '惡魔', '塔', '星星', '月亮', '太陽', '審判', '世界'];

const [domain, suit, ...rest] = process.argv.slice(2);
if (!domain || !suit) {
  console.error('用法：node scripts/pairtools/checkColumn.js <domain> <suit> [--max N]');
  process.exit(1);
}
const maxIdx = rest.indexOf('--max');
const MAX_SAME_HEAD = maxIdx >= 0 ? Number(rest[maxIdx + 1]) : 6;

const { COMBOS } = require(path.join('..', 'pairs', domain, suit + '.js'));

const isMajor = (name) => MAJORS.includes(name);
// 只看大×小：一邊是大牌、一邊是小牌
const mixed = COMBOS.filter((r) => isMajor(r[0]) !== isMajor(r[1]));

// 依「被指到的那張牌」分欄、依「來源牌」分段
const columns = new Map();
const sections = new Map();
for (const [from, to, texts] of mixed) {
  if (!columns.has(to)) columns.set(to, []);
  if (!sections.has(from)) sections.set(from, []);
  texts.forEach((text, slot) => {
    columns.get(to).push({ from, slot, text });
    sections.get(from).push({ to, slot, text });
  });
}

const head = (t) => t.split('，')[0];
const clause2 = (t) => (t.split('。')[0].split('，')[1] || '');
const second = (t) => (t.split('，')[1] || '').slice(0, 3);
const mechTail = (t) => {
  const clauses = t.split('。')[0].split('，');
  return (clauses[clauses.length - 1] || '').slice(-5);
};

let problems = 0;
const sortedCols = [...columns.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant'));

console.log(`\n=== ${domain}／${suit} 重複稽核（大×小 ${mixed.length} 列、${mixed.length * 4} 句）===`);
console.log(`判準：同一欄的第一子句、同一段的第二子句，各最多重複 ${MAX_SAME_HEAD} 次\n`);

function scan(title, groups, pick, label) {
  console.log(`--- ${title} ---`);
  let bad = 0;
  for (const [key, items] of groups) {
    const counts = {};
    for (const it of items) counts[pick(it.text)] = (counts[pick(it.text)] || 0) + 1;
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const over = entries.filter(([, n]) => n > MAX_SAME_HEAD);
    console.log(`${over.length ? '✗' : '✓'} ${key}　${label} ${entries.length} 種 / ${items.length} 句` +
      (over.length ? `　超標：${over.map(([h, n]) => `${h}×${n}`).join('、')}` : ''));
    bad += over.length;
  }
  console.log('');
  return bad;
}

problems += scan('直欄：同一張被指到的牌，第一子句', sortedCols, head, '開頭');
problems += scan('橫列：同一個來源牌的段，第二子句',
  [...sections.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-Hant')), clause2, '第二子句');

function ratio(label, fn) {
  const counts = {};
  for (const [, items] of columns) for (const it of items) {
    const k = fn(it.text) || '（無）';
    counts[k] = (counts[k] || 0) + 1;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const worst = top[0] ? top[0][1] / total : 0;
  console.log(`\n${label}：${Object.keys(counts).length} 種，最常見 ` +
    top.map(([k, n]) => `${k}×${n}`).join('、'));
  if (worst > 0.2) {
    console.log(`  ✗ 最常見的那一種佔 ${(worst * 100).toFixed(0)}%，超過兩成`);
    return 1;
  }
  return 0;
}

problems += ratio('第二子句的起頭', second);
problems += ratio('機制句的收尾', mechTail);

console.log(`\n合計 ${problems} 項超標。`);
