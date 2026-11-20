---
name: dev-server
description: 非開不可時，安全地啟動並關閉後端測試伺服器。使用者自己在 4000 跑 dev server，Claude 一律用 4100。要手動打 API、驗證端對端流程時使用。
---

# 啟動後端測試伺服器（port 4100）

**前提**：先確認 `npm test` 真的驗證不了這件事。能不開就不開。

## 1. 確認 port 狀況

```bash
netstat -ano | grep -E ":(4000|4100|5173|5180) "
```

4000／5173 是**使用者的**伺服器，絕對不要碰、不要 kill。4100 若被佔用，先查清楚是誰的，不確定就問。

## 2. 啟動（不加 --watch，避免改檔重啟中斷請求）

```bash
PORT=4100 CLIENT_URL=http://localhost:5180 node src/server.js
```

背景執行，並記下 PID。`CLIENT_URL` 要含前端測試伺服器的 5180：瀏覽器送 POST 會帶 Origin，不在允許清單就被 CORS 擋掉（GET 不會，所以只看畫面時不會發現；2026-11-20 每日一牌彈窗抽牌時踩到）。要註冊測試帳號時另外帶 `GMAIL_REFRESH_TOKEN=`（空值），寄信功能視為未設定、不會寄出驗證信；測完用 `DELETE /api/auth/me` 刪掉測試帳號。需要前端畫面時，前端用 5180 指向 4100（見 `../Tfontend/.claude/skills/dev-server`）。

## 3. 收尾（必做）

```bash
taskkill /PID <pid> /T /F
netstat -ano | grep ":4100 "
```

Windows 上只停止背景工作不會結束子程序，一定要加 `/T`。最後用 `netstat` 確認 4100 已釋放，才算結束。

## 禁止

- 不要結束不是自己啟動的程序。
- 不要呼叫 `/api/readings/narrate`（每次約 US$0.04），除非當下取得使用者明確同意。
