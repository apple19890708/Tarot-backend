// 自助刪除帳號（v24 2-3）：刪掉這位會員所有自己的資料，最後才刪帳號本身
// （中途失敗時帳號還在，使用者可以再按一次刪除）。AdminLog 照留，管理頁會顯示「已刪除的帳號」。
// 新增有 user 欄位的 model 時要加進這個清單，不然刪帳號會留下孤兒資料（test/accountSecurity.test.js 會檢查）
const USER_DATA_MODELS = [
  'Reading',
  'MarketWatch',
  'MarketWatchGroup',
  'MarketAlert',
  'MarketProfile',
  'MarketAnalysis',
  'FinanceNewsAnalysis',
  'MarketCall',
  'MarketReminder',
  'MarketSnapshot',
  'PushSubscription',
  'PasswordReset',
  'EmailVerification',
  'MarketAiUsage',
  'DailyCard',
  'JournalEntry',
]

// models：{ 名稱: Model }，測試時換成假的
function createUserDataDeleter(models) {
  return async function deleteUserData(userId) {
    const results = {}
    for (const name of USER_DATA_MODELS) {
      const Model = models[name]
      if (!Model) throw new Error(`刪除帳號缺少資料表：${name}`)
      const result = await Model.deleteMany({ user: userId })
      results[name] = result?.deletedCount ?? 0
    }
    return results
  }
}

// 正式環境用：直接載入 models
function defaultUserDataDeleter() {
  const models = Object.fromEntries(USER_DATA_MODELS.map((name) => [name, require(`../models/${name}`)]))
  return createUserDataDeleter(models)
}

module.exports = { USER_DATA_MODELS, createUserDataDeleter, defaultUserDataDeleter }
