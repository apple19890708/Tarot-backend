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

// ---- 2026-11-14：備援模型、提示詞快取、塔羅與股市分開的模型 ----
const { buildRequestBody, MODEL, FALLBACK_MODEL } = require('../src/services/narrationService')

test('送給 OpenRouter 的內容：主模型在前、備援在後；系統提示加快取標記；其他訊息不動', () => {
  const body = buildRequestBody({
    messages: [
      { role: 'system', content: '系統提示' },
      { role: 'user', content: '問題' },
    ],
  })
  assert.equal(body.model, MODEL)
  assert.deepEqual(body.models, MODEL === FALLBACK_MODEL ? undefined : [MODEL, FALLBACK_MODEL])
  assert.deepEqual(body.messages[0], {
    role: 'system',
    content: [{ type: 'text', text: '系統提示', cache_control: { type: 'ephemeral' } }],
  })
  assert.deepEqual(body.messages[1], { role: 'user', content: '問題' })
  assert.equal(body.reasoning.exclude, true)
  assert.equal(body.stream, true)
})

test('指定模型時用指定的；和備援同一個就不帶備援清單', () => {
  assert.equal(buildRequestBody({ messages: [], model: 'x/other' }).model, 'x/other')
  assert.deepEqual(buildRequestBody({ messages: [], model: 'x/other' }).models, ['x/other', FALLBACK_MODEL])
  assert.equal(buildRequestBody({ messages: [], model: FALLBACK_MODEL }).models, undefined)
})

test('streamChat 把指定的模型送出去（個股與財經新聞分析用自己的模型）', async () => {
  const realFetch = global.fetch
  let sent = null
  global.fetch = async (_url, { body }) => {
    sent = JSON.parse(body)
    return new Response('data: {"model":"x/market","choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { status: 200 })
  }
  try {
    const result = await streamChat({ messages: [], model: 'x/market', signal: new AbortController().signal, onStart: () => {}, onDelta: () => {} })
    assert.equal(sent.model, 'x/market')
    assert.equal(result.model, 'x/market')
  } finally {
    global.fetch = realFetch
  }
})
