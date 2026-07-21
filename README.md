# poe.ninja PoE2 中文化

把 [poe.ninja](https://poe.ninja/poe2) 的 **Path of Exile 2** 頁面即時翻成**繁體中文**。
只替換畫面上的英文文字、不動底層資料,不影響網站任何功能。

> A Chrome extension that live-translates poe.ninja's Path of Exile 2 pages into Traditional Chinese.

---

## 功能

- **名稱**:技能、職業、昇華、通貨、底材、天賦、傳奇/遺物/碑牌、任務與地區名。
- **詞綴 / 數據敘述**:`8% increased Skill Effect Duration` → `增加 8% 技能效果持續時間`,
  支援數值範圍 `(252-340)%`、符文 `[[ … ]]`、技能等級佔位符等。
- **介面標籤**:物品類別、角色面板(Life/Mana/Spirit/Armour/Evasion…)、異常狀態
  (Ignited→點燃)、關鍵字(Physical Damage→物理傷害)、昇華職業名。
- **描述與物品lore**:技能說明、輔助寶石功能、通貨說明、傳奇說明 lore。

資料**全部官方/POEDB 同源**(遊戲官方繁中),所以連 GGG 自己的少數誤譯也忠實呈現,
不自己翻譯;官方保留英文的(如部分傳奇名)就保留。

## 安裝

**從 Chrome 線上應用程式商店**(上架後):搜尋「poe.ninja PoE2 中文化」→ 加到 Chrome。

**手動載入(開發/測試)**:
1. 下載/clone 本專案。
2. `chrome://extensions` → 開啟右上角「開發人員模式」。
3. 「載入未封裝項目」→ 選擇本資料夾。
4. 開啟任一 PoE2 頁面(經濟、build、物品),英文會自動變中文。
   F12 Console 會印 `[PoB Translator] 已載入:名稱 … 詞綴模板 …`。

## 運作原理

`translator.js` 走訪頁面文字節點,以三層比對把英文換成中文:

1. **UI / 名稱**:整個文字節點精確比對(零誤判)。
2. **詞綴整行**:把英文行的數字當佔位符,比對官方英文模板 → 套用對應中文模板
   (解決 poe.ninja 把詞綴拆成多個 `<span>` 的問題)。
3. **整句描述**:整節點精確比對。

poe.ninja 是 SPA,內容動態載入 → 用 `MutationObserver` + `requestIdleCallback` 重掃。

## 資料來源與自動更新

- 名稱/描述/UI 由 [`pathofexile-dat`](https://github.com/poe-tool-dev/dat-schema) 匯出官方
  遊戲資料(英文 + 繁體中文逐列比對),詞綴由遊戲 `stat_descriptions`(`.csd`)產生中英模板。
- **動態管線**:要對接哪些表由 `tools/data-export/relevance.mjs`(單一事實來源)決定,
  每張表的欄位由官方 schema **動態推導**,schema/patch 自動跟最新版 →
  遊戲改版新增欄位會自動納入,不寫死清單。
- **GitHub Actions** 每天自動偵測新 patch → 重建翻譯資料 → commit。
- 擴充背景每天比對 `data/version.json`,**只有雲端比內建新**才下載 `dict.json` +
  `stat-templates.json` 快取(避免倒退)。重的匯出都在雲端,使用者端只下載小檔。

## 隱私

**本擴充不收集任何使用者資料**:沒有分析、沒有追蹤、不傳送任何個人資訊。
它只在你的瀏覽器本機把 poe.ninja 頁面上的英文換成中文,並從 GitHub 下載公開的
**JSON 翻譯資料檔**(純資料,非程式碼)。詳見 [`PRIVACY.md`](PRIVACY.md)。

## 開發 / 重建翻譯資料

需要 Node.js 22+。

```bash
cd tools/data-export && npm install
node gen-config.mjs                                   # 動態產生匯出 config(自動下載 schema)
node node_modules/pathofexile-dat/dist/cli/run.js     # 匯出官方資料表(英+繁中)
node build-stats.mjs                                  # 詞綴模板
cd ../.. && node tools/build-dict.mjs                 # POEDB 名稱
cd tools/data-export
node build-names.mjs && node build-descriptions.mjs && node build-ui.mjs
cd ../.. && node tools/build-version.mjs              # 版本檔
# 測試:cd tools/data-export && node test-stats.mjs && node test-screenshots.mjs && node test-modules.mjs
# 稽核未對接的中文欄位:node gen-config.mjs --all && <匯出> && node audit-coverage.mjs
```

## 打包上架

```bash
node tools/pack-extension.mjs        # 產生 dist/poe-ninja-pob-zh-<version>.zip(只含擴充必要檔)
```

把產生的 zip 上傳到 [Chrome 開發人員主控台](https://chrome.google.com/webstore/devconsole)。
商店表單文案見 [`docs/STORE-LISTING.md`](docs/STORE-LISTING.md)。

## 檔案

| 檔案 | 用途 |
|------|------|
| `manifest.json` | 擴充宣告(MV3) |
| `translator.js` | 翻譯引擎(content script) |
| `background.js` | service worker:每日檢查並下載最新翻譯資料 |
| `data/` | 字典(`dict.json`)、詞綴模板(`stat-templates.json`)、UI 標籤、版本檔 |
| `tools/` | 資料管線與測試(不打包進擴充) |
| `.github/workflows/` | 每日自動更新 CI |

## 更新紀錄

### 2.2.0(2026-06-10)

**引擎全面重構 — 更穩、不破壞網站功能**

- 翻譯引擎改為「只改文字、絕不增刪網頁元素」:行內連結、圖示、滑鼠提示(lore 彈窗)全部保留,並根除 React 網站可能白屏的風險。
- **lore 彈窗保留**:詞綴行裡的關鍵字(虛線底線字,如「魔遺」)翻譯後仍可滑鼠移上去看說明。
- 中英切換更完善:網站即時更新的內容切回英文不會顯示舊資料、按鈕支援鍵盤操作。

**翻譯覆蓋大幅增加**

- 新增「參照挖掘」管線:自動從官方資料的內嵌參照萃取對照(+400 詞),
  魔遺(寶鑽之遺/硫磺之遺/水銀之遺…14 種)等清單型新內容自動跟上。
- 新增:導覽列與頁尾、相對時間(5 minutes ago→5 分鐘前)、寶石等級來源
  (20 Levels from Gem→來自寶石 20 等)、數值單位(56 Mana→56 魔力、26 Ward→26 保護)、
  滑鼠提示/搜尋框等屬性文字、表格截斷字串(Unique Accessor…)。
- 官方用詞修正(依 ClientStrings 查證):Martial Weapon→**軍用武器**、Crossbow→**十字弓**。
- 名稱保護:官方尚未翻譯的新傳奇/新物品整行保留英文,不再出現「Legacy of 鑽石」式
  中英混雜;官方繁中一進字典即自動改為正常翻譯。

**自動更新更可靠**

- 加入 `unlimitedStorage` 權限(翻譯資料已 6MB+,避免快取爆配額導致更新靜默失效)。
- 版本雜湊補進文字佔位符模板(此前只更新這類模板時用戶端收不到)。

**回報工具**

- **Alt+點右下切換按鈕**:匯出目前頁面所有未翻譯字串(console + 剪貼簿),
  歡迎貼到 GitHub Issues 回報。

### 2.1.1(2026-06-07)

- 新增右下角中英切換按鈕(記住偏好)。
- 修正珠寶顯示:附魔「配置…」、珠寶範圍(範圍：小/可變的)、巢狀珠寶詞綴、「僅限: 1」。
