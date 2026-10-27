---
name: verify
description: 驗證後端改動。改完 src/ 或 test/ 的程式後、要回報「做完了」之前使用。跑 node:test 並檢查不該出現的風險（新套件、OpenRouter 呼叫、外洩欄位）。
---

# 驗證後端改動

## 步驟

1. 跑測試：

   ```bash
   npm test
   ```

   全綠才算通過。失敗就貼出失敗的測試名稱與訊息，不要只說「有錯」。

2. 檢查沒有偷加套件：

   ```bash
   git diff --stat package.json package-lock.json
   ```

   有變動就停下來問使用者；本專案不為了測試或功能自行加新套件。

3. 檢查沒有新的計費路徑：

   ```bash
   git diff | grep -n -i "openrouter\|OPENROUTER_API_KEY"
   ```

   有命中就在回報中明確標示，並確認使用者已同意。

4. 若改到路由／權限／Model，用 `api-reviewer` agent 做一次唯讀審查。

## 不要做的事

- 不要為了驗證就啟動伺服器。需要時才用 `dev-server` skill（port 4100）。
- 不要讀出或印出 `.env` 內容；只確認變數「有沒有設定」。
