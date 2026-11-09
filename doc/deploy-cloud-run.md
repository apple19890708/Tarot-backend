# 後端部署到 Google Cloud Run

建立日期：2026-11-09
狀態：2026-11-09 第一次部署完成（專案 `orangetarot`、服務 `tarot-backend`、網址 `https://tarot-backend-755135442588.asia-east1.run.app`）；清理規則已設定；前端與排程尚未切換，線上仍走 Render

## 一、為什麼要換、會不會花錢

- Render 免費方案閒置約 15 分鐘就休眠，下一個請求要等幾十秒。Cloud Run 也會在沒流量時關掉，但冷啟動只要幾秒。
- 後端不必改程式：已經用 `npm start` 啟動、讀 `process.env.PORT`；`/api/cron/market` 會等提醒、新聞、快照都跑完才回應；沒有在請求之外背景執行的計時器（NDJSON 心跳只在請求進行中）。
- 費用靠「把資源鎖住」控制，Google 沒有到金額自動停機的開關：
  - `--max-instances 1`：最多一台。最壞情況（被一直打、全天都在忙）約 USD 60／月，不會無限增加。
  - 計費方式維持預設的「只在處理請求時計費」，**不要**開「CPU 一直配置」，也不要設 `--min-instances` 大於 0。
  - 免費額度（每月，以官網為準）：200 萬次請求、18 萬 vCPU 秒、36 萬 GiB 秒。排程每月約 1,900 次，加上自己使用，預估在額度內。
- 不要順手啟用其他服務（Cloud SQL、負載平衡器、固定對外 IP 等），那些才會真的收費。

## 二、事前準備（只做一次）

### 1. 帳號與專案

1. 到 <https://console.cloud.google.com> 用 Google 帳號登入，綁信用卡。新帳號有 USD 300、90 天的試用額度，試用期間不會自動扣款；90 天後要手動升級成付費帳戶服務才會繼續跑，升級後只要在免費額度內就不收費。
2. 建立專案（例如 `tarot-backend`），記下**專案 ID**。
3. 在「API 和服務」啟用：**Cloud Run Admin API**、**Cloud Build API**、**Artifact Registry API**。

### 2. 預算通知

「帳單 → 預算與快訊」建立預算：金額 USD 1，50%、90%、100% 時寄信。只會通知，不會停機。

### 3. 安裝 gcloud CLI

1. 下載 Windows 安裝程式：<https://cloud.google.com/sdk/docs/install>
2. 開新的 PowerShell：

   ```powershell
   gcloud auth login
   gcloud config set project <專案ID>
   gcloud config set run/region asia-east1
   ```

   `asia-east1` 是彰化機房，離台灣最近。

### 4. MongoDB Atlas 的連線白名單

Cloud Run 的對外 IP 不固定（固定 IP 要另外付費）。到 Atlas 的 **Network Access** 加入 `0.0.0.0/0`，靠帳號密碼保護；`MONGO_URI` 的密碼要夠長、不要和別處共用。

### 5. 準備環境變數檔 `env.yaml`

在 Tbackend 根目錄建立 `env.yaml`，**先把它加進 `.gitignore`**（`gcloud --source` 也照 `.gitignore` 排除檔案，所以 `.env`、`env.yaml` 都不會被上傳進映像檔）。

```yaml
CLIENT_URL: "https://apple19890708.github.io,http://localhost:5173"
MONGO_URI: "..."
MONGO_DB_NAME: "..."
OPENROUTER_API_KEY: "..."
JWT_SECRET: "..."
VAPID_PUBLIC_KEY: "..."
VAPID_PRIVATE_KEY: "..."
VAPID_SUBJECT: "..."
CRON_SECRET: "..."
GOOGLE_CLIENT_ID: "..."
GOOGLE_CLIENT_SECRET: "..."
GMAIL_REFRESH_TOKEN: "..."
GMAIL_SENDER: "..."
APP_URL: "https://apple19890708.github.io/Tarot-fontEnd/"
```

- 值照抄 Render 上的設定（或本機 `.env`），每個值都用雙引號包起來。
- **不要放 `PORT`**：Cloud Run 會自己設定，放了會部署失敗。
- `JWT_SECRET` 沿用 Render 的值，使用者的登入才不會全部失效。
- `CLIENT_URL` 要含 GitHub Pages 的網域，否則前端會被 CORS 擋掉。

### 6.（建議）固定 Node 版本

`package.json` 目前沒有 `engines`，Google 的建置會用最新的 LTS。想和本機一致可以加上 `"engines": { "node": "22.x" }`。

## 三、第一次部署

在 Tbackend 根目錄執行（PowerShell 一行）：

```powershell
gcloud run deploy tarot-backend --source . --region asia-east1 --allow-unauthenticated --max-instances 1 --min-instances 0 --cpu 1 --memory 512Mi --timeout 900 --env-vars-file env.yaml
```

- 第一次會問要不要建立 Artifact Registry 儲存庫（`cloud-run-source-deploy`），回答 Y。
- 完成後會印出網址，例如 `https://tarot-backend-xxxxx.asia-east1.run.app`，HTTPS 已內建。
- `--timeout 900`：單一請求最長 15 分鐘，AI 串流夠用。
- 之後再部署只要同一行指令；環境變數會沿用，只改程式時可以拿掉 `--env-vars-file`。

### 驗證

1. 瀏覽器開 `<新網址>/api/health` 與 `<新網址>/api/cards` 都有回 JSON。
2. Cloud Run 主控台 → 服務 → **記錄** 沒有啟動錯誤（例如 Mongo 連不上）。
3. 先不要切換前端，用 GitHub Actions 的 `market-cron` → Run workflow 前，暫時把 `BACKEND_URL` 換成新網址測一次，確認回應正常。

## 四、切換過去

1. **排程**：GitHub 後端 repo → Settings → Secrets and variables → Actions → Repository secrets，把 `BACKEND_URL` 改成新網址（不要結尾的 `/`）。
2. **前端**：前端 repo → Settings → Secrets and variables → Actions → **Variables** 新增 `VITE_API_BASE_URL` = 新網址。`deploy-pages.yml` 會優先用這個變數；也可以直接改前端 `.env` 再 push。改完重新跑一次前端部署。
3. 不需要改的：`CLIENT_URL`、`APP_URL`（都是前端網址）、Google 登入的設定（驗證的是前端網域）。
4. **Render 先保留**：新網址穩定跑幾天後再停掉 Render 服務。要退回只要把上面兩個網址改回來。

## 五、避免累積儲存費用（設定一次就好）

每次部署都會留下一版映像檔與一份上傳的原始碼。後端很小（`node_modules` 約 18MB），要部署幾十次才會碰到 0.5GB 免費額度，超過也只有每 GB 每月約 USD 0.1，但設好就不用再管：

1. **映像檔**：Artifact Registry → 儲存庫 `cloud-run-source-deploy` → 編輯 → **清理政策**：新增「保留最近 5 個版本」，再新增「刪除超過 30 天的版本」（保留規則優先）。
2. **原始碼**：Cloud Storage → 名稱以 `run-sources-` 開頭的 bucket → **生命週期** → 新增規則「物件存在超過 30 天就刪除」。

## 六、之後的日常

- **部署**：可以每次手動跑第三節的指令；或在 Cloud Run 服務頁面按「連結存放區」（Continuous deployment），連到 GitHub 的後端 repo、分支 `main`，之後 push 就自動部署，跟 Render 一樣。
- **退版**：Cloud Run 服務 → 修訂版本 → 把流量切回前一版。
- **改環境變數**：Cloud Run 服務 → 編輯並部署新的修訂版本 → 變數與密鑰；或改 `env.yaml` 後重跑部署指令。
- **看用量**：帳單 → 報表，篩選 Cloud Run。每月看一次，確認還在免費額度內。

## 七、已知差異

- **POST 一定要帶 `Content-Length`**：Google 的前端會用 411 拒絕沒有長度的 POST（Render 不會）。`market-cron.yml` 的 curl 因此加了 `--data ''`；之後自己用 curl 測 POST 也要加。瀏覽器的 `fetch` 會自動帶，不受影響。
- 沒流量時服務會關掉，記憶體快取（例如大盤概況）會清空，下一個請求重新抓，第一次會稍慢。
- 磁碟是暫時的，重啟就消失；目前程式沒有寫檔，不受影響。
- 冷啟動要先連 MongoDB，第一個請求約多 1～3 秒。
