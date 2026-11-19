// PreToolUse hook：在工具執行前擋下 CLAUDE.md 禁止的動作。
// 1. 讀 .env（Read、Grep、或 shell 指令裡出現 .env 檔）
// 2. 結束使用者的 dev server（4000／5173 的程序、其上層與子程序；或依名稱一次結束 node）
// 3. git commit 時，有改動的 repo 沒通過 build／test
// 關卡本身出錯時一律放行（不能因為 hook 壞掉而卡住工作）。
import {
  ENV_IN_COMMAND,
  describeFailures,
  isEnvPath,
  loadState,
  protectedPids,
  readInput,
  runGate,
  saveState,
} from './lib.mjs'

function deny(reason) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }),
  )
  process.exit(0)
}

const ENV_REASON = 'CLAUDE.md 規定不得讀出或印出 .env* 的內容。需要知道設定時請問使用者，或看 .env.example。'
const KILL_WORD = /\b(taskkill|Stop-Process|spps|kill|pkill|killall|kill-port|fuser)\b/i
const KILL_BY_NAME = /\/IM\b|-Name\b|-ProcessName\b|\bpkill\b|\bkillall\b/i
const PORT_TOOL = /\b(kill-port|fuser)\b[^\n]*\b(4000|5173)\b/i
// 只取「真的要結束」的 PID：taskkill /PID n、Stop-Process -Id n[,m]、Stop-Process n、kill [-9] n m
// （只是查詢某個 PID 的指令不算，避免誤擋）
function killTargets(cmd) {
  const pids = []
  const grab = (re, group = 1) => {
    for (const m of cmd.matchAll(re)) pids.push(...(m[group].match(/\d+/g) ?? []))
  }
  grab(/\/PID\s+(\d+)/gi)
  grab(/\b(?:Stop-Process|spps)\b[^|;\n]*?-Id\s+([\d,\s]+)/gi)
  grab(/\b(?:Stop-Process|spps)\s+([\d,\s]+)/gi)
  grab(/\bkill\b(?:\s+-\w+)*((?:\s+\d+)+)/gi)
  return pids
}

const GIT_COMMIT =/\bgit\b(?:\s+-[Cc]\s+(?:"[^"]*"|'[^']*'|\S+))*\s+commit\b/

try {
  const input = readInput()
  const tool = input.tool_name
  const ti = input.tool_input ?? {}

  if (tool === 'Read' && isEnvPath(ti.file_path)) deny(ENV_REASON)
  if (tool === 'Grep' && (isEnvPath(ti.path) || /(^|[\\/{,])\.env\b(?!\.example)/.test(ti.glob ?? ''))) deny(ENV_REASON)

  if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = String(ti.command ?? '')

    if (ENV_IN_COMMAND.test(cmd)) deny(ENV_REASON)

    if (KILL_WORD.test(cmd)) {
      if (KILL_BY_NAME.test(cmd))
        deny('不能依程序名稱結束（會連同使用者在 4000／5173 的 dev server 一起結束）。請用自己啟動時記下的 PID：taskkill /PID <pid> /T /F。')
      if (PORT_TOOL.test(cmd)) deny('4000／5173 是使用者自己的 dev server，不能結束。Claude 測試用的是 4100／5180。')
      const guarded = protectedPids()
      const hit = [...new Set(killTargets(cmd))].filter((n) => guarded.has(n))
      if (hit.length)
        deny(`PID ${hit.join('、')} 屬於使用者在 4000／5173 的 dev server（或其上層、子程序），不能結束。只能結束自己啟動的程序。`)
    }

    if (GIT_COMMIT.test(cmd)) {
      const state = loadState()
      const failures = runGate(state)
      saveState(state)
      if (failures.length) deny(`commit 前的驗證沒過，先修好再 commit：\n\n${describeFailures(failures)}`)
    }
  }
} catch {
  // 放行
}
process.exit(0)
