// 財經新聞的主題標籤（v17 規格 G）。標題＋摘要命中關鍵字就貼上這個主題，只用來篩選與統計，
// 不判斷利多利空（因果推論交給使用者手動要求的 AI 影響分析）。
//
// zh：中文關鍵字，用「包含」比對
// en：英文關鍵字，比對整個字（AI 不會命中 said）；有大寫字母的（縮寫、專有名詞）要大小寫相同，全小寫的不分大小寫
// zh 裡的英文縮寫（AI、CPI）也用整個字比對
// groups：新聞重點彈窗的「可能影響族群」（台股、美股），只是依主題對照的參考，不代表新聞寫到這些族群
const NEWS_THEMES = [
  {
    key: 'ai',
    label: 'AI／資料中心',
    groups: { tw: ['AI 伺服器代工', '散熱', '電源', 'ASIC／矽智財', 'CoWoS 先進封裝', 'PCB／銅箔基板'], us: ['GPU／AI 晶片', '雲端服務商', '資料中心電力與設備'] },
    zh: ['AI', '人工智慧', '資料中心', '數據中心', '輝達', '伺服器', '算力', '大模型', 'ASIC', 'GPU', 'CoWoS', '散熱', '液冷'],
    en: ['AI', 'artificial intelligence', 'data center', 'data centers', 'Nvidia', 'GPU', 'GPUs', 'hyperscaler', 'hyperscalers', 'OpenAI', 'capex', 'AI chips', 'server', 'servers'],
  },
  {
    key: 'semi',
    label: '半導體',
    groups: { tw: ['晶圓代工', 'IC 設計', '封測', '記憶體', '半導體設備'], us: ['晶片設計', '晶圓代工 ADR', '半導體設備', '記憶體'] },
    zh: ['半導體', '晶圓', '晶片', '台積電', '封測', '先進封裝', '製程', 'IC設計', '記憶體', 'DRAM', 'HBM'],
    en: ['semiconductor', 'semiconductors', 'chip', 'chips', 'chipmaker', 'chipmakers', 'TSMC', 'foundry', 'ASML', 'Micron', 'Broadcom', 'AMD', 'Intel', 'memory'],
  },
  {
    key: 'rates',
    label: '利率與聯準會',
    groups: { tw: ['金融股', '高股息 ETF', '營建'], us: ['銀行', '成長型科技股', '不動產 REITs'] },
    zh: ['聯準會', 'Fed', '降息', '升息', '利率', '公債殖利率', '鮑爾', '央行', '貨幣政策'],
    en: ['Fed', 'Federal Reserve', 'FOMC', 'rate cut', 'rate cuts', 'rate hike', 'interest rate', 'interest rates', 'Powell', 'Treasury yields', 'bond yields', 'central bank'],
  },
  {
    key: 'policy',
    label: '選舉與政策',
    groups: { tw: [], us: [] },
    zh: ['選舉', '期中選舉', '國會', '參議院', '眾議院', '白宮', '川普', '民主黨', '共和黨', '法案', '監管', '禁令', '政府停擺'],
    en: ['election', 'elections', 'midterm', 'midterms', 'Congress', 'Senate', 'White House', 'Trump', 'Democrats', 'Republicans', 'regulation', 'regulators', 'moratorium', 'shutdown', 'antitrust'],
  },
  {
    key: 'trade',
    label: '關稅與貿易',
    groups: { tw: ['出口導向電子', '傳產出口（紡織、工具機）', '航運'], us: ['進口零售', '製造業'] },
    zh: ['關稅', '降稅', '減稅', '貿易戰', '貿易協議', '貿易談判', '出口管制', '制裁', '進口', '232條款', '301條款'],
    en: ['tariff', 'tariffs', 'trade war', 'export controls', 'export control', 'sanctions', 'trade deal', 'trade talks', 'Section 232', 'Section 301'],
  },
  {
    key: 'macro',
    label: '經濟數據',
    groups: { tw: ['景氣循環股', '金融股'], us: ['景氣循環股', '消費類股'] },
    zh: ['通膨', 'CPI', 'PCE', '非農', '就業', '失業率', 'GDP', 'PMI', '零售銷售', '景氣', '經濟成長', '外銷訂單'],
    en: ['inflation', 'CPI', 'PCE', 'jobs report', 'payrolls', 'unemployment', 'GDP', 'PMI', 'retail sales', 'recession', 'economy', 'consumer sentiment'],
  },
  {
    key: 'energy',
    label: '能源與原物料',
    groups: { tw: ['塑化', '航空', '航運', '綠能'], us: ['石油天然氣', '航空', '核能與電力'] },
    zh: ['油價', '原油', 'OPEC', '天然氣', '黃金', '金價', '銅價', '原物料', '電價', '核能'],
    en: ['oil', 'crude', 'OPEC', 'natural gas', 'gold', 'copper', 'commodities', 'energy', 'nuclear', 'power grid', 'electricity'],
  },
  {
    key: 'fx',
    label: '匯率',
    groups: { tw: ['出口電子', '壽險', '進口內需'], us: ['跨國企業', '原物料'] },
    // 「新台幣」「美元」常只是金額單位（營收新聞），不列；要講到匯價本身才算
    zh: ['匯率', '匯市', '美元指數', '升值', '貶值', '日圓', '日元', '人民幣', '強勢美元', '弱勢美元'],
    en: ['dollar index', 'strong dollar', 'weak dollar', 'yen', 'yuan', 'currency', 'currencies', 'forex', 'exchange rate'],
  },
  {
    key: 'geo',
    label: '地緣政治',
    groups: { tw: ['國防軍工', '航運', '能源'], us: ['國防', '能源'] },
    zh: ['地緣', '戰爭', '衝突', '台海', '中東', '以色列', '伊朗', '烏克蘭', '俄羅斯', '北韓', '中美'],
    en: ['geopolitical', 'Ukraine', 'Russia', 'Israel', 'Iran', 'Middle East', 'Taiwan Strait', 'North Korea', 'conflict', 'missile'],
  },
  {
    key: 'ev',
    label: '電動車',
    groups: { tw: ['電動車零組件', '電池材料', '車用半導體'], us: ['電動車', '電池'] },
    zh: ['電動車', '特斯拉', '電池', '充電樁', '自駕'],
    en: ['EV', 'EVs', 'electric vehicle', 'electric vehicles', 'Tesla', 'battery', 'batteries', 'autonomous', 'robotaxi'],
  },
  {
    key: 'finance',
    label: '金融股',
    groups: { tw: ['金控', '銀行', '壽險', '證券'], us: ['銀行', '保險', '券商'] },
    zh: ['金控', '銀行', '壽險', '保險', '證券股', '金融股'],
    en: ['bank', 'banks', 'banking', 'lender', 'lenders', 'insurer', 'insurers', 'JPMorgan', 'Goldman Sachs', 'credit'],
  },
  {
    key: 'crypto',
    label: '加密貨幣',
    groups: { tw: ['區塊鏈概念股', '礦機晶片'], us: ['加密貨幣交易所', '比特幣礦商'] },
    zh: ['比特幣', '加密貨幣', '虛擬貨幣', '以太幣', '穩定幣', '區塊鏈', '幣安', '交易所被駭'],
    en: ['bitcoin', 'crypto', 'cryptocurrency', 'ether', 'ethereum', 'stablecoin', 'stablecoins', 'blockchain'],
  },
  {
    key: 'earnings',
    label: '財報與營收',
    groups: { tw: [], us: [] },
    zh: ['財報', '營收', 'EPS', '獲利', '法說會', '財測', '毛利率', '盈餘'],
    en: ['earnings', 'revenue', 'guidance', 'profit', 'quarterly results', 'forecast', 'EPS'],
  },
]

module.exports = { NEWS_THEMES }
