// Stop hook：Claude 要結束回合時，有改動的 repo 必須通過 build／test。
// 沒過 → exit 2，錯誤訊息交回給 Claude 繼續修。
// 連續擋 3 次仍沒過（例如是使用者自己改到一半的檔案）→ 放行，但在畫面上提醒使用者驗證沒過。
import { describeFailures, loadState, readInput, runGate, saveState } from './lib.mjs'

const MAX_BLOCKS = 3
const input = readInput()
const state = loadState()

let failures = []
try {
  failures = runGate(state)
} catch (err) {
  // 關卡本身壞了不能卡住使用者，只提醒
  saveState(state)
  console.log(JSON.stringify({ systemMessage: `驗證關卡執行失敗：${err.message}` }))
  process.exit(0)
}

if (!failures.length) {
  state.blocks = 0
  saveState(state)
  process.exit(0)
}

state.blocks = (input.stop_hook_active ? state.blocks || 0 : 0) + 1
if (state.blocks > MAX_BLOCKS) {
  state.blocks = 0
  saveState(state)
  const names = failures.map((f) => f.name).join('、')
  console.log(
    JSON.stringify({ systemMessage: `⚠ 驗證關卡：${names} 連續 ${MAX_BLOCKS} 次沒過，已放行。改動尚未通過驗證，請不要直接上線。` }),
  )
  process.exit(0)
}
saveState(state)

process.stderr.write(
  `[驗證關卡] 有改動的程式沒有通過驗證，修好再結束（第 ${state.blocks}/${MAX_BLOCKS} 次）。\n` +
    '如果失敗原因不是你這次的改動、或在這裡無法修，要在回報中明確告訴使用者，不能說「完成」。\n\n' +
    describeFailures(failures) +
    '\n',
)
process.exit(2)
