// AI 串流的防呆：心跳、AI 卡住時主動中止（不呼叫真的 OpenRouter，fetch 用假的）
const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')

const { startNdjson } = require('../src/lib/ndjsonStream')
const { streamChat } = require('../src/services/narrationService')

async function withServer(app, run) {
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('startNdjson：途中定期送 ping，回應結束後就停', async () => {
  const app = express()
  app.get('/s', (req, res) => {
    startNdjson(res, { heartbeatMs: 20 })
    setTimeout(() => {
      res.write('{"type":"done"}\n')
      res.end()
    }, 90)
  })
  await withServer(app, async (base) => {
    const response = await fetch(`${base}/s`)
    assert.equal(response.headers.get('content-type'), 'application/x-ndjson; charset=utf-8')
    const lines = (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line))
    assert.ok(lines.filter((e) => e.type === 'ping').length >= 2, '等 AI 的期間有心跳')
    assert.deepEqual(lines.at(-1), { type: 'done' })
  })
})

test('streamChat：AI 開始後沒再送資料，超過閒置時間就丟出錯誤（不是被當成使用者停止）', async () => {
  const realFetch = global.fetch
  // 假的 OpenRouter：送一段文字後就卡住，不關閉連線
  global.fetch = async (_url, { signal }) => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"開頭"}}]}\n\n'))
        signal.addEventListener('abort', () => controller.error(signal.reason))
      },
    })
    return new Response(body, { status: 200 })
  }
  try {
    const deltas = []
    const user = new AbortController()
    await assert.rejects(
      streamChat({ messages: [], signal: user.signal, onStart: () => {}, onDelta: (d) => deltas.push(d), idleTimeoutMs: 60 }),
      /沒有回應/,
    )
    assert.deepEqual(deltas, ['開頭'])
    assert.equal(user.signal.aborted, false)
  } finally {
    global.fetch = realFetch
  }
})

test('streamChat：使用者停止時照樣是中止，不是卡住', async () => {
  const realFetch = global.fetch
  global.fetch = async (_url, { signal }) =>
    new Response(
      new ReadableStream({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason))
        },
      }),
      { status: 200 },
    )
  try {
    const user = new AbortController()
    setTimeout(() => user.abort(), 20)
    await assert.rejects(
      streamChat({ messages: [], signal: user.signal, onStart: () => {}, onDelta: () => {}, idleTimeoutMs: 5000 }),
      (error) => !/沒有回應/.test(String(error?.message)),
    )
  } finally {
    global.fetch = realFetch
  }
})
