// Claude Code hooks 的保護規則（.claude/hooks/，前後端同一份）：擋讀 .env 與 env.yaml（v29 項目 8）。
// 直接用 node 執行 guard.mjs、從 stdin 餵工具呼叫，檢查有沒有回 deny；不會真的讀任何檔案。
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')
const { spawnSync } = require('child_process')
const { pathToFileURL } = require('url')

const HOOKS = path.join(__dirname, '..', '.claude', 'hooks')

function guard(toolName, toolInput) {
  const result = spawnSync(process.execPath, [path.join(HOOKS, 'guard.mjs')], {
    input: JSON.stringify({ tool_name: toolName, tool_input: toolInput }),
    encoding: 'utf8',
  })
  const out = result.stdout.trim()
  return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'allow'
}

test('hooks：檔名判斷（.env*、env.yaml／env.yml 擋；.env.example 與一般檔名放行）', async () => {
  const { isEnvPath, ENV_IN_COMMAND } = await import(pathToFileURL(path.join(HOOKS, 'lib.mjs')).href)
  for (const file of ['.env', '.env.local', 'D:/x/.env.production', 'env.yaml', 'D:\\repo\\env.yml', 'ENV.YAML']) assert.equal(isEnvPath(file), true, file)
  for (const file of ['.env.example', 'environment.yaml', 'my-env.yaml', 'src/env.js', 'docker-compose.yaml']) assert.equal(isEnvPath(file), false, file)
  for (const cmd of ['cat env.yaml', 'type .\\env.yml', 'grep KEY env.yaml | head', 'gcloud run deploy --env-vars-file=env.yaml', 'cat .env']) {
    assert.equal(ENV_IN_COMMAND.test(cmd), true, cmd)
  }
  for (const cmd of ['cat environment.yaml', 'node scripts/env.yaml.js', 'cat .env.example', 'npm test']) assert.equal(ENV_IN_COMMAND.test(cmd), false, cmd)
})

test('hooks：guard.mjs 擋 Read／Grep／shell 讀 env.yaml，.env.example 照常放行', () => {
  assert.equal(guard('Read', { file_path: 'D:/test_angular/Tbackend/env.yaml' }), 'deny')
  assert.equal(guard('Read', { file_path: 'D:/test_angular/Tbackend/.env' }), 'deny')
  assert.equal(guard('Read', { file_path: 'D:/test_angular/Tbackend/.env.example' }), 'allow')
  assert.equal(guard('Grep', { pattern: 'KEY', glob: 'env.yaml' }), 'deny')
  assert.equal(guard('Grep', { pattern: 'KEY', path: 'D:/test_angular/Tbackend/env.yml' }), 'deny')
  assert.equal(guard('Bash', { command: 'cat env.yaml' }), 'deny')
  assert.equal(guard('PowerShell', { command: 'Get-Content env.yaml' }), 'deny')
  assert.equal(guard('Bash', { command: 'ls src' }), 'allow')
  assert.equal(guard('Read', { file_path: 'D:/test_angular/Tbackend/src/server.js' }), 'allow')
})
