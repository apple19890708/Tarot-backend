// 身分中介層。findUserById 以參數注入，測試時不必連資料庫。
const { verifyToken, readBearerToken } = require('../lib/jwt')

// token 裡的版本號要和帳號目前的 tokenVersion 一樣才算數：重設密碼、「登出所有裝置」會把帳號的版本號加 1，
// 之前發出去的 token 全部立刻失效（JWT 本身 7 天才過期，不比對的話被盜的 token 改了密碼也還能用）。
// 舊 token 沒有 ver、舊帳號沒有 tokenVersion，都當成 0，所以上線這個檢查不會把現有的人登出
const versionOf = (value) => (Number.isInteger(value) ? value : 0)

function createAuthMiddleware({ findUserById, secret } = {}) {
  // 解析 token 並回資料庫確認：帳號還在、版本號一致。任何一項不符回 null（當成沒登入）
  async function resolveUser(req) {
    const payload = verifyToken(readBearerToken(req.headers.authorization), { secret })
    if (!payload) return null
    const user = await findUserById(payload.sub)
    if (!user || versionOf(payload.ver) !== versionOf(user.tokenVersion)) return null
    return { userId: payload.sub, user }
  }

  // 有 token 就解析並掛上 req.auth，沒有、無效或已被登出也放行（當成訪客）；
  // 查資料庫失敗也當訪客，抽牌這類不需要登入的功能不要因此壞掉
  async function optionalAuth(req, _res, next) {
    try {
      const found = await resolveUser(req)
      req.auth = found ? { userId: found.userId, role: found.user.role } : null
      if (found) req.user = found.user
    } catch {
      req.auth = null
    }
    next()
  }

  async function requireAuth(req, res, next) {
    try {
      const found = await resolveUser(req)
      if (!found) {
        res.status(401).json({ message: '請先登入。' })
        return
      }
      req.auth = { userId: found.userId, role: found.user.role }
      req.user = found.user
      next()
    } catch (error) {
      next(error)
    }
  }

  // token 裡的 role 是簽發當下的狀態，使用者被降權或被收回權限時不會更新，
  // 所以凡是看權限的都用資料庫的帳號判斷（resolveUser 已經查過）。
  function createUserGuard(isAllowed, deniedMessage) {
    return async function guard(req, res, next) {
      try {
        const found = await resolveUser(req)
        if (!found) {
          res.status(401).json({ message: '請先登入。' })
          return
        }
        if (!isAllowed(found.user)) {
          res.status(403).json({ message: deniedMessage })
          return
        }
        req.auth = { userId: found.userId, role: found.user.role }
        req.user = found.user
        next()
      } catch (error) {
        next(error)
      }
    }
  }

  const requireAdmin = createUserGuard((user) => user.role === 'admin', '沒有權限。')

  // AI 解析：admin 一律可以，member 要被管理者開通
  const canUseAi = (user) =>
    typeof user.canUseAi === 'function' ? user.canUseAi() : user.role === 'admin' || Boolean(user.aiAccess)
  const requireAiAccess = createUserGuard(canUseAi, 'AI 解讀需要管理者開通，請聯絡管理者。')

  // 金融股市（股市諮詢、股市追蹤）：admin 一律可以，member 要被管理者開通，和 AI 權限分開
  const canUseStock = (user) =>
    typeof user.canUseStock === 'function' ? user.canUseStock() : user.role === 'admin' || Boolean(user.stockAccess)
  const requireStockAccess = createUserGuard(canUseStock, '金融股市功能需要管理者開通，請聯絡管理者。')

  // 不擋請求、只回答「這個請求的使用者有沒有某個權限」。給 optionalAuth 的端點判斷個別欄位用（例如股市諮詢）
  function createChecker(isAllowed) {
    return async function check(req) {
      const found = await resolveUser(req)
      return Boolean(found && isAllowed(found.user))
    }
  }
  const hasAiAccess = createChecker(canUseAi)
  const hasStockAccess = createChecker(canUseStock)

  return { optionalAuth, requireAuth, requireAdmin, requireAiAccess, hasAiAccess, requireStockAccess, hasStockAccess }
}

module.exports = { createAuthMiddleware, versionOf }
