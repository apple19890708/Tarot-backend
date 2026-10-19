// 身分中介層。findUserById 以參數注入，測試時不必連資料庫。
const { verifyToken, readBearerToken } = require('../lib/jwt')

function createAuthMiddleware({ findUserById, secret } = {}) {
  // 有 token 就解析並掛上 req.auth，沒有或無效也放行
  function optionalAuth(req, _res, next) {
    const token = readBearerToken(req.headers.authorization)
    const payload = verifyToken(token, { secret })
    req.auth = payload ? { userId: payload.sub, role: payload.role } : null
    next()
  }

  function requireAuth(req, res, next) {
    const token = readBearerToken(req.headers.authorization)
    const payload = verifyToken(token, { secret })
    if (!payload) {
      res.status(401).json({ message: '請先登入。' })
      return
    }
    req.auth = { userId: payload.sub, role: payload.role }
    next()
  }

  // token 裡的 role 是簽發當下的狀態，使用者被降權或被收回權限時不會更新，
  // 所以凡是看權限的都回資料庫確認一次。
  function createUserGuard(isAllowed, deniedMessage) {
    return async function guard(req, res, next) {
      const token = readBearerToken(req.headers.authorization)
      const payload = verifyToken(token, { secret })
      if (!payload) {
        res.status(401).json({ message: '請先登入。' })
        return
      }

      try {
        const user = await findUserById(payload.sub)
        if (!user || !isAllowed(user)) {
          res.status(403).json({ message: deniedMessage })
          return
        }
        req.auth = { userId: payload.sub, role: user.role }
        req.user = user
        next()
      } catch (error) {
        next(error)
      }
    }
  }

  const requireAdmin = createUserGuard((user) => user.role === 'admin', '沒有權限。')

  // AI 解析：admin 一律可以，member 要被管理者開通
  const requireAiAccess = createUserGuard(
    (user) => (typeof user.canUseAi === 'function' ? user.canUseAi() : user.role === 'admin' || Boolean(user.aiAccess)),
    'AI 解讀需要管理者開通，請聯絡管理者。',
  )

  return { optionalAuth, requireAuth, requireAdmin, requireAiAccess }
}

module.exports = { createAuthMiddleware }
