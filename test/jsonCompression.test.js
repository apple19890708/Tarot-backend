// JSON 回應 gzip：大的壓、小的不壓、不支援 gzip 的不壓、狀態碼保留、AI 串流不受影響
const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const zlib = require('zlib')
const express = require('express')

const { jsonCompression } = require('../src/lib/jsonCompression')
const { startNdjson } = require('../src/lib/ndjsonStream')

async function withServer(app, run) {
  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  try {
    await run(server.address().port)
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
}

// 用 http.get 拿原始位元組（fetch 會自動解壓，看不出有沒有壓縮）
function rawGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, headers }, (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
      })
      .on('error', reject)
  })
}

const big = { items: Array.from({ length: 300 }, (_, i) => ({ code: `23${i}`, name: '台積電', price: 1000 + i })) }

function buildApp() {
  const app = express()
  app.use(jsonCompression())
  app.get('/big', (_req, res) => res.json(big))
  app.get('/small', (_req, res) => res.json({ ok: true }))
  app.get('/missing', (_req, res) => res.status(404).json({ message: '找不到', pad: 'x'.repeat(2000) }))
  app.get('/stream', (_req, res) => {
    startNdjson(res, { heartbeatMs: 1000 })
    res.write('{"type":"text","text":"a"}\n')
    res.end('{"type":"done"}\n')
  })
  return app
}

test('jsonCompression：大的 JSON 用 gzip 送，解壓後內容一樣', async () => {
  await withServer(buildApp(), async (port) => {
    const res = await rawGet(port, '/big', { 'Accept-Encoding': 'gzip, deflate, br' })
    assert.equal(res.headers['content-encoding'], 'gzip')
    assert.match(res.headers['content-type'], /application\/json/)
    assert.match(res.headers.vary, /Accept-Encoding/)
    assert.equal(Number(res.headers['content-length']), res.body.length)
    const plain = Buffer.byteLength(JSON.stringify(big))
    assert.ok(res.body.length < plain / 3, `壓縮後 ${res.body.length} bytes，原本 ${plain}`)
    assert.deepEqual(JSON.parse(zlib.gunzipSync(res.body).toString('utf8')), big)
  })
})

test('jsonCompression：小回應、或瀏覽器不支援 gzip 時照原樣送', async () => {
  await withServer(buildApp(), async (port) => {
    const small = await rawGet(port, '/small', { 'Accept-Encoding': 'gzip' })
    assert.equal(small.headers['content-encoding'], undefined)
    assert.deepEqual(JSON.parse(small.body.toString('utf8')), { ok: true })

    const noGzip = await rawGet(port, '/big')
    assert.equal(noGzip.headers['content-encoding'], undefined)
    assert.deepEqual(JSON.parse(noGzip.body.toString('utf8')), big)
  })
})

test('jsonCompression：錯誤回應的狀態碼保留', async () => {
  await withServer(buildApp(), async (port) => {
    const res = await rawGet(port, '/missing', { 'Accept-Encoding': 'gzip' })
    assert.equal(res.status, 404)
    assert.equal(res.headers['content-encoding'], 'gzip')
    assert.equal(JSON.parse(zlib.gunzipSync(res.body).toString('utf8')).message, '找不到')
  })
})

test('jsonCompression：AI 串流（NDJSON）不壓縮、照原樣逐行送', async () => {
  await withServer(buildApp(), async (port) => {
    const res = await rawGet(port, '/stream', { 'Accept-Encoding': 'gzip' })
    assert.equal(res.headers['content-encoding'], undefined)
    const lines = res.body.toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    assert.deepEqual(lines.at(-1), { type: 'done' })
  })
})
