# Chrome Web Store 上架文案 / 清單

把以下內容貼進 [Chrome 開發人員主控台](https://chrome.google.com/webstore/devconsole) 的對應欄位。

---

## 基本資訊

| 欄位 | 內容 |
|------|------|
| **名稱 Name** | poe.ninja PoE2 中文化 |
| **類別 Category** | 工具(Tools)或 娛樂(Entertainment) |
| **語言 Language** | 中文(繁體)/ Chinese (Traditional) |

## 摘要 Summary(上限 132 字)

```
把 poe.ninja 的 Path of Exile 2 頁面即時翻成繁體中文:名稱、詞綴、介面、描述。資料官方/POEDB 同源,每日自動更新,不收集任何個資。
```

## 詳細說明 Description

```
把 poe.ninja 的 Path of Exile 2(流亡黯道2)頁面即時翻成繁體中文,只替換畫面文字、
不影響網站任何功能。

【翻譯內容】
• 名稱:技能、職業、昇華、通貨、底材、天賦、傳奇/遺物/碑牌、任務與地區
• 詞綴/數據敘述:如「8% increased Skill Effect Duration」→「增加 8% 技能效果持續時間」,
  支援數值範圍、符文、技能等級等格式
• 介面標籤:物品類別、角色面板(生命/魔力/精魂/護甲/閃避)、異常狀態、關鍵字、昇華職業名
• 描述與風味文字:技能說明、輔助寶石功能、通貨說明、傳奇 lore

【資料來源】
所有翻譯都與遊戲官方繁體中文、POEDB(poe2db.tw)同源,不是機器翻譯。官方保留英文的
就保留,連官方少數誤譯也忠實呈現,不自己亂翻。

【自動更新】
每天由 GitHub Actions 自動偵測新版本、重建翻譯資料;擴充只在有更新時下載小型 JSON 資料檔。
遊戲改版新增的內容會自動跟上。

【隱私】
不收集任何個人資料、沒有追蹤或分析。翻譯完全在你的瀏覽器本機進行,頁面內容不會外傳。
唯一的對外連線是每天下載一次公開的翻譯資料(純資料,非程式碼)。

開放原始碼:https://github.com/Orangeeewei/poe-ninja-pob-zh
```

---

## 隱私權實務 Privacy practices(審查必填)

**單一用途 Single purpose**
```
把 poe.ninja 的 Path of Exile 2 頁面顯示的英文,即時翻譯成繁體中文。
Translate the English text on poe.ninja's Path of Exile 2 pages into Traditional Chinese.
```

**權限理由 Permission justifications**

| 權限 | 理由(可直接貼) |
|------|------|
| `storage` | 在本機快取已下載的翻譯字典,避免每次開頁重複下載。Cache the downloaded translation dictionary locally to avoid re-downloading on every page load. |
| `alarms` | 每天排程一次,檢查 GitHub 上是否有更新的翻譯資料。Schedule a once-per-day check for updated translation data on GitHub. |
| `主機權限 host: poe.ninja` | 擴充的核心用途:在 poe.ninja 的 PoE2 頁面注入翻譯。Core purpose: inject translations into poe.ninja PoE2 pages. |
| `主機權限 host: raw.githubusercontent.com` | 下載本專案公開的 JSON 翻譯資料檔(純資料,非遠端程式碼)。Download the project's public JSON translation data files (data only, not remote code). |

**遠端程式碼 Remote code**:選「否,我沒有使用遠端程式碼 / No, I am not using remote code」。
擴充只下載 JSON **資料**(`dict.json` / `stat-templates.json`),不下載或執行任何程式碼。

**資料用途 Data usage**:全部不勾。本擴充**不收集、不傳送**任何使用者資料。
隱私權政策網址填:`https://github.com/Orangeeewei/poe-ninja-pob-zh/blob/main/PRIVACY.md`

---

## 圖片素材(需自備截圖)

| 素材 | 規格 | 狀態 |
|------|------|------|
| 商店圖示 Store icon | 128×128 PNG | ✅ 已有 `icons/icon128.png` |
| 螢幕截圖 Screenshot | 1280×800 或 640×400 PNG/JPG,至少 1 張(最多 5) | ⬜ 需自備 |
| 小型宣傳磚 Small promo tile(選填) | 440×280 | ⬜ 選填 |

**建議截圖**(開 poe.ninja PoE2 頁面,擴充已開啟後截圖):
1. 經濟總覽頁(物品類別/通貨已中文化)
2. 某個 build 頁(技能名、詞綴、角色面板統計已中文化)
3. 某個物品/寶石詳情(詞綴、描述、輔助寶石功能已中文化)

> 截圖建議用 1280×800。可在 Chrome 視窗開 poe.ninja → F12 切換裝置工具列設 1280×800 → 截圖。

---

## 上架前檢查清單

- [ ] `node tools/pack-extension.mjs` 產生 zip
- [ ] 在 `chrome://extensions` 用「載入未封裝項目」載入 `dist/` 解壓內容,實測翻譯正常
- [ ] 準備 1–5 張 1280×800 截圖
- [ ] 開發人員主控台:上傳 zip → 填上方文案 → 填隱私權實務 → 提交審查
- [ ] (首次)需付 Google 開發者一次性註冊費 5 USD
