# 後端部署手冊（Google Cloud Run）

建立日期：2026-11-09
狀態：已上線並設定自動部署（2026-11-09）。前端與 market-cron 切換到 Cloud Run 的進度見本週週記。

這份手冊分成三部分：**現況速查**（第一節）、**日常操作**（第二～五節，平常只會用到這些）、**從零建置與踩過的坑**（第六～八節，重建環境或換專案時看）。

---

## 一、現況速查

| 項目 | 值 |
| --- | --- |
| GCP 專案 | `orangetarot`（帳號 apple19890708@gmail.com） |
| 區域 | `us-west1`（美國奧勒岡）。2026-11-09 從 `asia-east1`（台灣）搬過去，原因與代價見第十節 |
| Cloud Run 服務 | `tarot-backend` |
| 網址 | `https://tarot-backend-755135442588.us-west1.run.app` |
| 自動部署 | Cloud Build 觸發條件 `tarot-backend-us-west1`（id `f8ffa608-2349-4678-9c09-49f16464598e`，區域 us-west1，GitHub 連線 `Orange-us`）：GitHub `apple19890708/Tarot-backend` 的 `main` 有新 commit 就在 us-west1 建置、映像存 us-west1 的 `cloud-run-source-deploy`、部署到 us-west1，全程不跨區 |
| 資源上限 | 最多 1 台、沒流量縮到 0、1 vCPU／1GiB、關閉啟動加速（`--no-cpu-boost`，啟動時不會用 2 倍 CPU 計費）、請求上限 900 秒、只在處理請求時計費 |
| 環境變數 | 17 個，存在 Cloud Run 服務上；本機的來源檔是 `env.yaml`（不進版控）。AI 模型相關的見下方「AI 模型設定」 |
| 資料庫 | MongoDB Atlas（白名單 `0.0.0.0/0`，因為 Cloud Run 對外 IP 不固定） |
| 清理規則 | 映像檔保留最近 3 版（每版約 170 MB，3 版約 0.5 GB 免費額度內）、超過 30 天刪除（us-west1 的 `cloud-run-source-deploy`）；手動 `--source` 部署用的 bucket `run-sources-orangetarot-us-west1` |
| 誰會呼叫它 | 前端（GitHub Pages）、GitHub Actions 的 `market-cron`（每 10 分鐘，開盤時段） |

常用網頁：

- Cloud Run 服務：<https://console.cloud.google.com/run/detail/us-west1/tarot-backend?project=orangetarot>
- 記錄（logs）：<https://console.cloud.google.com/run/detail/us-west1/tarot-backend/logs?project=orangetarot>
- 建置紀錄：<https://console.cloud.google.com/cloud-build/builds;region=us-west1?project=orangetarot>
- 觸發條件：<https://console.cloud.google.com/cloud-build/triggers?project=orangetarot>
- 帳單報表：<https://console.cloud.google.com/billing>

---

## 二、日常：更新後端

### 正常流程（自動）

1. 本機改程式，`npm test` 全過。
2. commit 並 push 到 `main`。
3. Cloud Build 自動建置並部署，約 3～5 分鐘。
4. 確認上線（見下方「部署後檢查」）。

前端照舊：push 前端的 `main`，GitHub Pages 自動部署，和後端互不影響。

### 部署後檢查

1. **建置紀錄**最新一筆是綠勾。紅色就點進去看是哪一步失敗（見第五節）。
2. **Cloud Run 服務 → 修訂版本**：最新的修訂版本有綠勾，而且「流量」是 100%。
3. 瀏覽器開 `<網址>/api/health`，看到 `"status":"ok"` 與 `"ready":true`。
4. 改到股市或排程相關時，到 GitHub 後端 repo → **Actions → market-cron → Run workflow** 手動跑一次，要是綠勾。

### 手動部署（自動部署壞掉、或想部署還沒 push 的程式時）

**部署 GitHub 上 `main` 的最新版**（最穩，和自動部署走同一條路）：

```powershell
gcloud builds triggers run f8ffa608-2349-4678-9c09-49f16464598e --region us-west1 --branch main
```

**部署本機目前的檔案**（包含還沒 commit 的改動），在 Tbackend 根目錄：

```powershell
gcloud run deploy tarot-backend --source . --region us-west1
```

既有的環境變數與資源上限都會沿用，不用重打；之後 push 時自動部署會再蓋過去。（2026-11-09 第一次在 us-west1 用 `--source` 時出現過「Container import failed」，見第八節第 6 點；遇到就改用上面的觸發條件，或先 push。）

> 若 PowerShell 找不到 `gcloud`：關掉終端機重開一個；還是不行就用完整路徑 `& "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd"`。

---

## 三、日常：環境變數

### 修改或新增

**網頁（建議，改一個值時）**：Cloud Run 服務 → **編輯並部署新的修訂版本** → **變數與密鑰** 分頁 → 改值 → **部署**。存檔就會重新啟動成新的修訂版本。

**指令（一次改很多時）**：改本機的 `env.yaml`，然後：

```powershell
gcloud run services update tarot-backend --region us-west1 --env-vars-file env.yaml
```

注意：

- `--env-vars-file` 會**整份取代**，檔案裡沒有的變數會被刪掉。只想改一個值時用 `--update-env-vars KEY=value`。
- 改本機 `.env` **不會**同步到 Cloud Run；`.env` 只給本機開發用。
- 後端新增了需要的環境變數（看 `.env.example` 的變化），push 之前先把值加到 Cloud Run，否則新版可能啟動失敗。

### `env.yaml` 的格式

```yaml
CLIENT_URL: "https://apple19890708.github.io,http://localhost:5173"
MONGO_URI: "..."
JWT_SECRET: "..."
```

- YAML 格式（`KEY: "value"`），**不是** `.env` 的 `KEY=value`；每個值都用雙引號。
- **不要放 `PORT`**，Cloud Run 會自己設定，放了會部署失敗。
- `CLIENT_URL` 一定要含 `https://apple19890708.github.io`，否則前端會被 CORS 擋。
- 這個檔有全部密鑰：已列在 `.gitignore`，gcloud 上傳時也會照 `.gitignore` 排除；不要傳給別人、不要貼到對話裡。

---

## 四、日常：出問題時

### 退回上一版（最快的止血方式）

Cloud Run 服務 → **修訂版本** → 勾選上一個正常的版本 → **管理流量** → 該版本設 100% → 儲存。幾秒內生效。

修好程式後再 push，新版部署成功時流量會自動切回最新版。

### 看錯誤記錄

Cloud Run 服務 → **記錄**。可以用上方的嚴重性篩選「錯誤」。常見訊息：

| 記錄裡看到 | 意思 | 怎麼做 |
| --- | --- | --- |
| `JWT_SECRET 未設定，伺服器不啟動` | 環境變數缺了 | 第三節補上 |
| `STARTUP TCP probe failed … on port 8080` | 程式沒在時間內啟動（通常是上一行的原因，或程式一啟動就丟錯） | 往上找第一個錯誤訊息 |
| `MongoServerSelectionError` | 連不到資料庫 | Atlas 的 Network Access 是否還有 `0.0.0.0/0`、`MONGO_URI` 是否正確 |
| `來源不在 CLIENT_URL 允許清單內` | 前端網域沒列在 `CLIENT_URL` | 第三節修改 `CLIENT_URL` |

### 用 gcloud 看記錄

```powershell
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="tarot-backend" AND severity>=WARNING' --project orangetarot --limit 20 --freshness=1h
```

---

## 五、建置失敗排查

建置紀錄點進失敗的那一筆，左邊會列出 4 個步驟，看是哪一步紅色：

| 失敗的步驟 | 常見原因 | 怎麼做 |
| --- | --- | --- |
| 建構作業摘要直接失敗（11 秒左右）、訊息有 `developerconnect … fetchReadToken … denied` | 剛設定好 GitHub 連線，權限還沒生效 | 等幾分鐘，按「重新執行建構作業」 |
| 0: Buildpack | `npm ci` 失敗（`package-lock.json` 和 `package.json` 不一致）、Node 版本不符 | 本機 `npm install` 後把 lock 檔一起 commit；Node 版本看 `package.json` 的 `engines`（目前 `22.x`） |
| 3: Deploy，`Creating Revision … failed` | 新版程式啟動失敗（缺環境變數、啟動就丟錯） | 點 Logs URL 或第四節看記錄；線上舊版仍在服務，不會中斷 |
| 3: Deploy，指令是 `gcloud run services update tarot-backend-git` | 觸發條件指到錯的服務 | 觸發條件的替代變數 `_SERVICE_NAME` 要是 `tarot-backend` |

**部署失敗時，線上的舊版不受影響**：Cloud Run 會等新版啟動成功才切流量。

---

## 六、費用與用量

- 費用靠「鎖住資源」控制，Google 沒有到金額自動停機的開關：
  - 最多 1 台：最壞情況（被一直打、全天都在忙）約 USD 60／月，不會無限增加。
  - 只在處理請求時計費：**不要**在服務設定開「CPU 一律分配」，也不要把「執行個體數量下限」設成大於 0（設成 1 就是整個月 24 小時計費）。
- 每月免費額度（以官網為準）：200 萬次請求、18 萬 vCPU 秒、36 萬 GiB 秒；Cloud Build 也有免費建置時間。排程每月約 1,900 次加上自己使用，預估在額度內。
- 傳出流量：免費的 1 GB／月只給**北美區域**。後端的 JSON 回應用 gzip 壓縮（`src/lib/jsonCompression.js`，約剩 20～30%），牌卡圖片讓瀏覽器快取 7 天，都是為了把流量壓在額度內。
- 11/8（還在台灣時）一天被收了約 USD 0.0145。原本以為是傳出流量，但監控顯示台灣那段只傳出約 12 MB（約 USD 0.0015），大部分是別的項目；要看是哪一項，到帳單報表把「分組依據」改成 SKU。
- Artifact Registry：只留 us-west1 的 `cloud-run-source-deploy`（自動部署建置、存放、部署都在 us-west1），超過 0.5 GB 才收費，已設清理政策。
- 預算通知：帳單 → 預算與快訊，設 USD 1、到 50%／90%／100% 寄信（只通知、不會停機）。收到信就到帳單報表看是哪個服務。
- 不要順手啟用其他服務（Cloud SQL、負載平衡器、固定對外 IP、Cloud Run 的「直接 VPC 輸出」等），那些才會真的收費。
- 每月看一次帳單報表，確認還是 0 元。

---

## 七、從零建置（重建環境或換專案時）

2026-11-09 的實際順序，照做就能重建：

1. **帳號與專案**：<https://console.cloud.google.com> 綁信用卡、建立專案；啟用 **Cloud Run Admin API**、**Cloud Build API**、**Artifact Registry API**。
2. **預算通知**：帳單 → 預算與快訊，USD 1。
3. **gcloud CLI**：安裝 <https://cloud.google.com/sdk/docs/install> 後

   ```powershell
   gcloud auth login
   gcloud config set project <專案ID>
   gcloud config set run/region us-west1
   ```

4. **MongoDB Atlas**：Network Access 加 `0.0.0.0/0`。
5. **`env.yaml`**：照第三節的格式，值從 `.env`（或舊平台的設定）抄過來；`CLIENT_URL` 加 GitHub Pages 網域；不放 `PORT`。確認 `.gitignore` 有 `env.yaml`。
6. **確認上傳內容沒有密鑰**：

   ```powershell
   gcloud meta list-files-for-upload .
   ```

   清單裡不能有 `.env`、`env.yaml`。

7. **第一次部署**：

   ```powershell
   gcloud run deploy tarot-backend --source . --region us-west1 --allow-unauthenticated --max-instances 1 --min-instances 0 --cpu 1 --memory 1Gi --timeout 900 --env-vars-file env.yaml
   ```

   第一次會問要不要建立 Artifact Registry 儲存庫 `cloud-run-source-deploy`，回答 Y。

8. **驗證**：`/api/health`、`/api/spreads`、`/api/cards` 有回 JSON；帶 `x-cron-secret` 的 `POST /api/cron/market` 回 200（curl 要加 `--data ''`，見第八節）。
9. **清理規則**：
   - Artifact Registry → `cloud-run-source-deploy` → 清理政策：「保留最近 3 個版本」＋「刪除超過 30 天的版本」。
   - Cloud Storage → `run-sources-<專案ID>-us-west1` → 生命週期：物件超過 30 天刪除。
10. **自動部署**：Cloud Run → 點**既有的** `tarot-backend` 服務 → **連結存放區**（設定持續部署）→ GitHub 授權 → 選 `Tarot-backend`、分支 `^main$`、建構類型選 **Buildpacks**。
    - **不要**從 Cloud Run 列表頁按「建立服務 → 從存放區持續部署」，那會建出另一個空的服務（見第八節）。
    - 設好後到觸發條件確認替代變數 `_SERVICE_NAME` 是 `tarot-backend`。
11. **切換使用者流量**：
    - GitHub 後端 repo → Settings → Secrets and variables → Actions → **Repository secrets**：`BACKEND_URL` 改成 Cloud Run 網址（結尾不要 `/`），再手動跑一次 market-cron。
    - GitHub 前端 repo → 同一頁的 **Variables** 分頁：新增 `VITE_API_BASE_URL` = Cloud Run 網址，再重跑前端的部署 workflow（`deploy-pages.yml` 會優先用這個變數，蓋過前端 `.env`）。
12. **確認切換成功**：開線上前端，F12 → 網路 → Fetch/XHR，API 請求的網址是 `….run.app`，回應標頭有 `server: Google Frontend`；Cloud Run 的記錄同時出現對應的請求。

---

## 八、踩過的坑（2026-11-09）

1. **`env.yaml` 寫成 `.env` 格式**：gcloud 讀不了。要用 YAML 的 `KEY: "value"`，而且拿掉 `PORT`。
2. **POST 沒有 `Content-Length` 會被回 411**：Google 的前端要求 POST 帶長度（Render 不會）。`market-cron.yml` 的 curl 因此加了 `--data ''`；自己用 curl 測 POST 也要加。瀏覽器的 `fetch` 會自動帶，不受影響。
3. **設定自動部署時多建了一個服務 `tarot-backend-git`**：用「建立服務」的精靈接 GitHub，會新建一個沒有環境變數、沒有上限的空服務，觸發條件也指向它，部署時因為缺 `JWT_SECRET` 啟動失敗。修正：觸發條件的 `_SERVICE_NAME` 改成 `tarot-backend`，再刪掉多出來的服務。
4. **剛連好 GitHub 的第一次建置出現 `fetchReadToken … denied`**：權限是精靈加的，但還沒生效。等幾分鐘重跑就好。
5. **切換後可能被要求重新登入**：Render 與 Cloud Run 的 `JWT_SECRET` 若不同，舊的登入憑證會失效，重新登入即可。
6. **us-west1 第一次部署出現「Container import failed」**：在 us-west1 剛建好儲存庫時，用 `--source` 打包的映像建立修訂版本失敗兩次，日誌沒有更多原因；當下改用 asia-east1 儲存庫的映像先上線。之後刪掉那個儲存庫重建、改用 us-west1 的觸發條件建置部署，一次就成功，判斷是剛建立儲存庫時的暫時性問題。再遇到就等幾分鐘重跑。
7. **改觸發條件的替代變數**：`gcloud builds triggers update github ... --update-substitutions` 會回 `INVALID_ARGUMENT`（這個觸發條件是 Developer Connect 連的）。改法：`gcloud builds triggers describe <id> --region <區域> --format=yaml > trigger.yaml`，改頂層 `substitutions` 底下的值，再 `gcloud builds triggers import --region <區域> --source trigger.yaml`。也可以直接在主控台的觸發條件頁改。

---

## 九、和 Render 的差異

- 沒流量時服務會關掉（冷啟動約幾秒，Render 免費方案是幾十秒）；記憶體快取（例如大盤概況）會清空，下一個請求重新抓。開盤時段有 market-cron 每 10 分鐘呼叫，通常一直醒著。
- CPU 是 1 vCPU（Render 免費方案約 0.1），回測、預測、K 線彙整這類計算明顯較快；同樣的公開 API 實測約快 3～4 倍（0.3～0.4 秒 → 約 0.1 秒）。
- 磁碟是暫時的，重啟就消失；目前程式沒有寫檔，不受影響。
- 冷啟動要先連 MongoDB，第一個請求約多 1～3 秒。

### 停用 Render

切換完成、穩定幾天後：Render 服務 → Settings → **Suspend Web Service**（設定保留、可以 Resume）。再用一兩週沒問題就 **Delete**。Render 留著不刪的話，它仍是一個連著同一個資料庫、帶著所有密鑰的完整後端，而且每次 push 都會跟著部署。

---

## 十、區域：為什麼是 us-west1（2026-11-09）

- **原因**：傳出流量的免費 1 GB／月只給北美區域；放在台灣（asia-east1）從第一個位元組就算錢。三個北美免費區域裡，us-west1（奧勒岡）離台灣最近。
- **代價（台灣實測，各 5 次）**：純網路來回約 36 ms → 200 ms；`/api/health`（查一次資料庫）約 65 ms → 350 ms。多出來的部分代表 MongoDB Atlas 在亞洲，後端每查一次資料庫都要跨太平洋，股市頁、自選清單這類一次查很多筆的頁面最有感。
- **台灣那台**：`tarot-backend`（asia-east1）先保留、不接流量（沒請求就不計費）。決定不換回來後刪除：
  ```powershell
  gcloud run services delete tarot-backend --region asia-east1
  ```
- **換回台灣**：需要台灣區域的 GitHub 連線與觸發條件（台灣原本那一套已停用／刪除，要重建，見第七節第 10 步）；前端 `.env` 的 `VITE_API_BASE_URL`、後端 repo 的 secret `BACKEND_URL` 改回 `https://tarot-backend-755135442588.asia-east1.run.app`。
- 如果之後覺得太慢又不想付流量費：把 Atlas 也搬到美國（例如 AWS `us-west-2`）會把資料庫那段延遲拿掉，但要搬資料，另外評估。

## AI 模型設定（OpenRouter）

都是選填，沒設定就用程式裡的預設值（`src/services/narrationService.js`）。改值用 `gcloud run services update tarot-backend --region us-west1 --update-env-vars KEY=value`，立即生效、不用重新部署。

| 變數 | 用途 | 目前的值／預設 |
|---|---|---|
| `OPENROUTER_MODEL` | 塔羅解讀（含股市諮詢、追問） | 已設 `anthropic/claude-sonnet-5.5`（2026-11-14） |
| `OPENROUTER_REASONING_EFFORT` | 推理深度 `low`／`medium`／`high`，所有 AI 共用 | 已設 `medium`（2026-11-14） |
| `OPENROUTER_MARKET_MODEL` | 個股 AI 分析、財經新聞 AI 分析 | 已設 `anthropic/claude-opus-5.5`（2026-11-14）；沒設時和 `OPENROUTER_MODEL` 相同 |
| `OPENROUTER_FALLBACK_MODEL` | 主模型出錯時 OpenRouter 自動改用的模型 | 未設，預設 `anthropic/claude-opus-5.5` |
