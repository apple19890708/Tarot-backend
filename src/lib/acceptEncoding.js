// 瀏覽器接不接受 gzip（jsonCompression 與 gzipStatic 共用）。
// 照 RFC 9110 12.5.3：有明確列出 gzip 就看它的 q 值（gzip;q=0 是明確拒絕）；沒列出才看 *。
function qualityOf(params) {
  const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
  if (!q) return 1
  const value = Number(q.slice(2))
  return Number.isFinite(value) ? value : 0
}

function acceptsGzip(req) {
  const header = req.headers['accept-encoding']
  if (typeof header !== 'string' || !header.trim()) return false
  let gzip = null
  let star = null
  for (const part of header.split(',')) {
    const [rawName, ...params] = part.trim().toLowerCase().split(';')
    const name = rawName.trim()
    if (name === 'gzip' || name === 'x-gzip') gzip = Math.max(gzip ?? 0, qualityOf(params))
    else if (name === '*') star = qualityOf(params)
  }
  if (gzip !== null) return gzip > 0
  return star !== null && star > 0
}

module.exports = { acceptsGzip }
