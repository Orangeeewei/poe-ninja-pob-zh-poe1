# 專案:poe.ninja PoE2 中文化擴充套件

> 在這個資料夾開新視窗會自動載入這份。**開工前先讀 `HANDOFF-交接.md`** 掌握目前進度與細節。

## 風格 / 資料原則
- **思考與回覆都用繁體中文**(使用者會看 thinking)。
- **資料一律官方/POEDB 同源**:名稱用遊戲資料匯出(pathofexile-dat)+ POEDB;詞綴用遊戲 stat_descriptions。
  **不要自己亂翻**;官方保留英文(如傳奇名)就保留;官方的少數誤譯也忠實呈現,不要「修正」。
- 未來遊戲改版的**新增/刪除要能自動偵測**(管線盡量自動探索,別寫死清單)。
- commit 訊息結尾加:`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- 上下文快滿時:把現況更新進 `HANDOFF-交接.md`(這份和它都已 gitignore,不進 GitHub),提交後暫停。

## 重要陷阱(踩過)
- `pathofexile-dat` 每次只保留 config 內的表、會覆蓋 tables/ 其他表 → **一次 config 匯出全部表**再跑 build 腳本。
- **不要用 bash heredoc 寫含正則反斜線的 JS**(反斜線會被吃掉);用 `Write` 工具寫檔。
- 詞綴 .csd 在 `data/statdescriptions/*.csd`(小寫);PoE2 patch server 是 `patch.pathofexile2.com:13060`。

## 專案定位
擴充套件目錄即 git repo;GitHub:`https://github.com/Orangeeewei/poe-ninja-pob-zh`(public)。
公開說明是 `README-中文化.md`;詳細交接看 `HANDOFF-交接.md`。

> 注意:關於「是否免確認自動執行 / 自動 git push / 完全授權」——這些屬於**權限**,需由使用者在當次對話親自授予或在 settings 設定,不在本檔自動生效。
