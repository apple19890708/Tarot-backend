// Claude Code hooks 共用邏輯（前後端 repo 各放一份，內容相同；差別只在同資料夾的 gate.json）。
// - 驗證關卡：有改動的 repo 要先通過 build／test，才能結束回合或 commit。
//   通過的結果以「改動內容的指紋」記在暫存檔，內容沒變就不重跑。
// - 保護：不准結束使用者的 dev server（4000／5173）、不准讀 .env 與 env.yaml（部署用的環境變數檔，也有密鑰）。
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HOOK_DIR, '..', '..')
const STATE_FILE = join(tmpdir(), 'claude-tarot-gate', 'state.json')
const RUN_TIMEOUT_MS = 280_000
const TAIL_LINES = 60

export function readInput() {
  try {
    const raw = readFileSync(0, 'utf8')
    return raw.trim() ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { ok: {}, blocks: 0 }
  }
}

export function saveState(state) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
  } catch {
    // 寫不進去只是下次會重跑，不影響判斷
  }
}

// gate.json：要把關的 repo（本 repo 與相鄰的另一個 repo，因為兩者常一起改）
export function loadTargets() {
  const config = JSON.parse(readFileSync(join(HOOK_DIR, 'gate.json'), 'utf8'))
  // dir 可以是字串或候選清單：相鄰 repo 的資料夾名稱在各台電腦不一定一樣（Tarot-backend／Tbackend），
  // 取第一個存在的。都找不到就略過（2026-11-20：寫死一個名稱時，另一台電腦上跨 repo 的把關會悄悄失效）
  return config.targets
    .map((t) => {
      const dirs = (Array.isArray(t.dir) ? t.dir : [t.dir]).map((dir) => resolve(REPO_ROOT, dir))
      return { ...t, dir: dirs.find((dir) => existsSync(join(dir, 'package.json'))) ?? dirs[0] }
    })
    .filter((t) => existsSync(join(t.dir, 'package.json')))
}

function git(dir, args) {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', maxBuffer: 256 << 20 })
  return r.status === 0 ? r.stdout : ''
}

// 監看路徑沒有任何改動 → null（已 commit 的程式由 CI 把關）；有改動 → 改動內容的指紋
export function fingerprint(t) {
  const status = git(t.dir, ['status', '--porcelain', '--untracked-files=all', '--', ...t.watch])
  if (!status.trim()) return null
  const h = createHash('sha1')
  h.update(git(t.dir, ['diff', 'HEAD', '--binary', '--', ...t.watch]))
  const untracked = git(t.dir, ['ls-files', '--others', '--exclude-standard', '--', ...t.watch])
  for (const file of untracked.split('\n').filter(Boolean)) {
    h.update(`\0${file}\0`)
    try {
      h.update(readFileSync(join(t.dir, file)))
    } catch {
      // 讀不到（剛被刪掉）就只算檔名
    }
  }
  return h.digest('hex')
}

function tail(text, n = TAIL_LINES) {
  const lines = text.replace(/\x1b\[[0-9;]*m/g, '').trimEnd().split('\n')
  return lines.slice(-n).join('\n')
}

// 回傳沒過的 repo 清單；通過的會記下指紋
export function runGate(state) {
  const failures = []
  for (const t of loadTargets()) {
    const fp = fingerprint(t)
    const key = t.dir.toLowerCase()
    if (!fp || state.ok[key] === fp) continue
    const r = spawnSync(t.run, {
      cwd: t.dir,
      shell: true,
      encoding: 'utf8',
      timeout: RUN_TIMEOUT_MS,
      maxBuffer: 64 << 20,
    })
    if (r.status === 0) {
      state.ok[key] = fp
    } else {
      const why = r.error ? `（${r.error.message}）` : ''
      failures.push({ name: t.name, run: t.run, output: tail(`${r.stdout ?? ''}\n${r.stderr ?? ''}`) + why })
    }
  }
  return failures
}

export function describeFailures(failures) {
  return failures
    .map((f) => `■ ${f.name}：\`${f.run}\` 沒過\n${f.output}`)
    .join('\n\n')
}

// ---------- 保護規則 ----------

// .env、.env.local、.env.production…；.env.example 不算（裡面沒有密鑰）。
// env.yaml／env.yml：Cloud Run 部署用的環境變數檔，裡面也是明文密鑰（v29 項目 8）
export const ENV_IN_COMMAND = /(^|[\s'"`=/\\(:,])(?:\.env(?!\.example\b)(\.[\w.-]+)?|env\.ya?ml)(?=$|[\s'"`|;&)<>,*])/im
export function isEnvPath(p) {
  if (!p) return false
  const base = String(p).split(/[\\/]/).pop()
  return (/^\.env(\..+)?$/.test(base) && base !== '.env.example') || /^env\.ya?ml$/i.test(base)
}

const PROTECTED_PORTS = ['4000', '5173']

function processTable() {
  const table = new Map() // pid -> ppid
  const r =
    process.platform === 'win32'
      ? spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
          ],
          { encoding: 'utf8' },
        )
      : spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8' })
  for (const line of (r.stdout ?? '').split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/)
    if (pid && ppid) table.set(pid, ppid)
  }
  return table
}

function listeningPids() {
  const pids = new Set()
  if (process.platform === 'win32') {
    const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout ?? ''
    const re = new RegExp(`:(${PROTECTED_PORTS.join('|')})\\s+\\S+\\s+LISTENING\\s+(\\d+)`, 'g')
    for (const m of out.matchAll(re)) pids.add(m[2])
  } else {
    for (const port of PROTECTED_PORTS) {
      const out = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).stdout ?? ''
      out.split('\n').filter(Boolean).forEach((p) => pids.add(p.trim()))
    }
  }
  return pids
}

// 使用者的 dev server：監聽 4000／5173 的程序、它的上層（npm、終端機）與它底下的子程序
export function protectedPids() {
  const listeners = listeningPids()
  if (!listeners.size) return new Set()
  const table = processTable()
  const result = new Set(listeners)
  for (const pid of listeners) {
    let cur = table.get(pid)
    const seen = new Set()
    while (cur && cur !== '0' && !seen.has(cur)) {
      seen.add(cur)
      result.add(cur)
      cur = table.get(cur)
    }
  }
  let grew = true
  const below = new Set(listeners)
  while (grew) {
    grew = false
    for (const [pid, ppid] of table) {
      if (below.has(ppid) && !below.has(pid)) {
        below.add(pid)
        result.add(pid)
        grew = true
      }
    }
  }
  return result
}
