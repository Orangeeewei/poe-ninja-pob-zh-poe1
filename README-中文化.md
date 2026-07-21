# poe.ninja 中文化(PoE2)

把 poe.ninja 的 PoE2 頁面英文,即時換成繁體中文。只替換畫面文字、不動底層資料,
不影響網站任何功能。

## 翻譯內容

| 類型 | 來源 | 數量 |
|------|------|------|
| 名稱(技能/職業/傳奇/換界石/天賦/底材/通貨/任務…) | POEDB + 官方遊戲資料匯出(pathofexile-dat) | ~10300 |
| 描述/說明(技能簡述/異常狀態/關鍵字/通貨/風味文字…) | 官方遊戲資料匯出 | ~20700 |
| 介面標籤(物品類別/職業/角色面板 Life/Mana…/昇華…) | 官方資料(uiAuto)+ 手工(ui-labels) | ~2700 |
| **詞綴/數據敘述**(`8% increased…` 等) | 官方 stat_descriptions(中英模板) | ~28000 |

詞綴採「模板比對」:把英文行的數字當佔位符,比對官方英文模板 → 套用對應中文模板。
資料與 POEDB 同源(都是遊戲官方繁中),所以連 GGG 自己的少數誤譯也會忠實呈現。

### 動態資料管線(不寫死、自動跟上新版)
要匯出哪些遊戲表由 `tools/data-export/relevance.mjs`(單一事實來源)決定:列出「與 poe2db
同源、poe.ninja 會顯示」的表並標註路由(描述/介面/名稱)。每張表要抓哪些欄位由 **schema
動態推導**(`gen-config.mjs` 自動下載官方 schema、過濾掉當前版本不存在的表),所以**遊戲新增
欄位會自動納入**。安全性:描述/介面走「整節點精確比對」零誤判,可大方全收;名稱因走子字串
比對較保守。`audit-coverage.mjs` 會列出「官方有繁中卻還沒對接」的欄位供人工判斷是否加入。

## 安裝 / 載入(Chrome / Edge)

1. `chrome://extensions` → 開「開發人員模式」
2. 「載入未封裝項目」→ 選這個資料夾(已裝舊版就按「重新載入 ↻」)
3. 開 PoE2 角色/配置/經濟頁,英文會變中文。
   F12 Console 會印 `[PoB Translator] 已載入:名稱 … 詞綴模板 …`

## 自動更新

- GitHub Actions 每天(台灣 02:00)自動:偵測 PoE2 patch 版本 → 匯出官方資料 →
  重建名稱字典 + 詞綴模板 + 版本檔 → 有變動才 commit。
- 擴充套件背景每天檢查 `version.json`,**只有當雲端 build 比內建新**才下載 `dict.json` +
  `stat-templates.json` 快取(避免倒退)。重的匯出都在雲端,使用者端只下載小檔。

## 手動重建資料(本機)

```bash
cd tools/data-export && npm install
node gen-config.mjs                   # 動態產生 config.json(自動偵測 patch、下載 schema)
node node_modules/pathofexile-dat/dist/cli/run.js   # 匯出官方資料表(英+繁中)
node build-stats.mjs                  # 詞綴模板
cd ../.. && node tools/build-dict.mjs # POEDB 名稱爬蟲
cd tools/data-export
node build-names.mjs                  # 名稱
node build-descriptions.mjs           # 描述/說明
node build-ui.mjs                     # 介面標籤(uiAuto)
cd ../.. && node tools/build-version.mjs   # 版本檔
```

## 檔案

- `translator.js` — 翻譯引擎(名稱精確比對 + 詞綴模板比對 + MutationObserver 處理 SPA)。
- `background.js` — service worker:每日檢查並下載最新翻譯資料(唯一職責)。
- `data/dict.json` — 名稱字典(英→中)。
- `data/stat-templates.json` — 詞綴中英模板。
- `data/ui-labels.json` — 介面標籤(手工)。
- `data/version.json` — 版本/build 資訊。
- `tools/build-dict.mjs` — POEDB 名稱爬蟲。
- `tools/data-export/relevance.mjs` — **單一事實來源**:要對接哪些表/欄/路由。
- `tools/data-export/gen-config.mjs` — 動態產生匯出 config(下載 schema、過濾幽靈表)。
- `tools/data-export/audit-coverage.mjs` — 稽核:列出官方有繁中卻未對接的欄位。
- `tools/data-export/` — 官方遊戲資料匯出(pathofexile-dat)與解析/建表腳本。
- `tools/build-version.mjs` — 版本檔產生。
- `.github/workflows/update-dict.yml` — 每日自動更新。
