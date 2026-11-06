// AI 串流共用的 NDJSON 回應：送出標頭，途中每隔一段時間送一行 {"type":"ping"}（心跳）。
// AI 推理時可能一兩分鐘沒有文字；有心跳，前端才分得出「後端還在等 AI」和「連線已經斷了」
// （例如伺服器重啟、Render 重新部署時，經過 proxy 的連線不一定會正常關閉，前端會一直等）。
// 回應結束或連線關閉時自動停止心跳。
const HEARTBEAT_MS = 15_000

function startNdjson(res, { heartbeatMs = HEARTBEAT_MS } = {}) {
  res.status(200).set({
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()
  const timer = setInterval(() => {
    if (!res.writableEnded) res.write('{"type":"ping"}\n')
  }, heartbeatMs)
  timer.unref?.()
  const stop = () => clearInterval(timer)
  res.on('close', stop)
  res.on('finish', stop)
  return stop
}

module.exports = { startNdjson, HEARTBEAT_MS }
