# 隱私權政策 / Privacy Policy

**擴充功能名稱 / Extension:** poe.ninja PoE2 中文化
**最後更新 / Last updated:** 2026-06-05

---

## 繁體中文

本擴充功能**不收集、不儲存、不傳送任何個人資料**。

- **不收集個人資訊**:不蒐集姓名、Email、帳號、IP、瀏覽記錄或任何可識別個人的資料。
- **不追蹤、不分析**:沒有任何分析(analytics)、廣告或追蹤程式碼。
- **本機運作**:翻譯完全在你的瀏覽器本機進行——讀取 poe.ninja 頁面上的文字、把英文替換成
  中文。頁面內容**不會被傳送到任何伺服器**。
- **唯一的對外連線**:背景程式每天向 `raw.githubusercontent.com` 下載本專案公開的
  **JSON 翻譯資料檔**(`dict.json`、`stat-templates.json`、`version.json`)。這只是下載
  公開資料,**不會上傳你的任何資訊**,也不會下載或執行任何遠端程式碼。
- **本機儲存**:下載的翻譯資料透過 `chrome.storage.local` 快取在你的裝置上,純粹為了避免
  每次開頁重複下載。此資料只存在你的瀏覽器,不會外傳;移除擴充即一併清除。

### 權限用途
- `storage`:在本機快取翻譯字典,避免重複下載。
- `alarms`:每天排程一次檢查是否有新版翻譯資料。
- `host: poe.ninja`:在 poe.ninja 的 PoE2 頁面注入翻譯(擴充的核心用途)。
- `host: raw.githubusercontent.com`:下載公開的 JSON 翻譯資料檔。

如有疑問,請至專案的 GitHub Issues 提出。

---

## English

This extension **does not collect, store, or transmit any personal data**.

- **No personal information** is collected (no name, email, account, IP, or browsing history).
- **No tracking or analytics**: there is no analytics, advertising, or tracking code.
- **Runs locally**: translation happens entirely in your browser — it reads text on poe.ninja
  pages and replaces English with Chinese. Page content is **never sent to any server**.
- **Only outbound connection**: the background script downloads the project's public
  **JSON translation data files** from `raw.githubusercontent.com` once per day. This only
  downloads public data; it **uploads nothing** and downloads/executes **no remote code**.
- **Local storage**: downloaded translation data is cached on your device via
  `chrome.storage.local` solely to avoid re-downloading. It stays in your browser and is
  removed when you uninstall the extension.

### Permission justifications
- `storage`: cache the translation dictionary locally to avoid re-downloading.
- `alarms`: schedule a once-daily check for updated translation data.
- `host: poe.ninja`: inject translations on poe.ninja PoE2 pages (the extension's core purpose).
- `host: raw.githubusercontent.com`: download the public JSON translation data files.

For questions, please open an issue on the project's GitHub.
