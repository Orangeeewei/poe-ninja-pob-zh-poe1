# PoE1 改造記錄(從 poe-ninja-pob-zh PoE2 fork 而來)

> 這份是 `poe-ninja-pob-zh` 的 **PoE1 版工作複本**(獨立資料夾,不影響原 PoE2 上架 repo)。
> 依 `Downloads/poe-ai-engine-plan.md` Phase 1 施作。**2026-07-21 完成、實測 patch 3.28.0.16。**

## 產出(data/)
| 檔 | 內容 |
|----|------|
| `dict.json` | names 10625 / descriptions 17181 / uiAuto 1634(純 PoE1,build 前已重置空骨架) |
| `stat-templates.json` | 21621 buckets / 21809 詞綴模板(來自 PoE1 metadata/statdescriptions/*.txt) |
| `version.json` | build 版本檔 |

## 改了哪些檔(相對原 PoE2 版的 diff)

### 1. `tools/data-export/get-patch.mjs`
- patch server:`patch.pathofexile2.com:13060` → **`patch.pathofexile.com:12995`**(實測回 3.28.0.16)。

### 2. `tools/data-export/gen-config.mjs`
- `FALLBACK_PATCH`:`4.5.1.1.2` → **`3.28.0.16`**。
- `--all` 稽核模式:`validFor & 2` → **`validFor & 1`**(1=PoE1)。
- **★ 關鍵新修(計畫沒提到的坑)**:schema 有 249 組「同名表」(每款遊戲一個變體,欄位不同)。
  原本 `new Map(schema.tables.map(...))` 保留「最後一個」,PoE2 靠陣列順序碰巧拿對;PoE1 會誤拿
  PoE2 變體(多出 `GrantedEffect` 等欄)→ 匯出時 pathofexile-dat 比對真實 .dat 爆
  「doesn't have a column named …」。**改成依 `GAME_BIT(=1) & validFor` 挑正確變體。**
  → 要做 PoE2 版把 `GAME_BIT` 設 2 即可。

### 3. `tools/data-export/build-stats.mjs`
- `PATCH` fallback → `3.28.0.16`,且優先讀 `process.env.PATCH`。
- **★ 詞綴描述來源(計畫沒提到的坑)**:PoE1 不是 `data/statdescriptions/*.csd`,而是
  **`metadata/statdescriptions/*.txt`**(UTF-16LE,格式與 .csd 相容,開頭 `include` 指令會被
  parseCsd 自動跳過)。改了 `STAT_DIR` + 新增 `STAT_EXT='.txt'`。

### 4. `tools/build-dict.mjs`(Phase 1 完成)
- 站台:`poe2db.tw` → **`poedb.tw`**。
- `CATEGORIES`:換成 PoE1 分類 slug(已對 poedb.tw 實測校正:Skill_Gems/Support_Gems/
  Unique_item/各 One|Two_Hand 武器/Rune_Daggers/Warstaves/藥劑/Jewels/Abyss_Jewels…;
  移除 PoE2 專有的 Spirit_Gems/Foci/Waystones/Runes/Spears/Crossbows 等)。
- 跑完:poedb +1066,合併後 names 10681(支援寶石/技能/傳奇名齊)。

### 5. `tools/fetch-repoe.mjs` + `gamedata/`(Phase 2:完整數值)
- 新增腳本,從 **RePoE PoE1**(`https://repoe-fork.github.io/`,非 /poe2)下載:
  `mods(39292)/base_items(5059)/gems(1435)/essences(106)/fossils(445)/`
  `crafting_bench_options(774)/stat_translations(11076)/mod_types(14240)` → `gamedata/*.json`。
- 供 MCP 的 `get_base/get_gem/search_mods/reverse_craft` 使用(中文化靠本 repo 的 dict/stat-templates)。

### 6. 自動更新 —— 改走 GitHub(不用本機)
- **決策(使用者):每日更新要用 GitHub Action 自動跑,不要在本機跑。** 本機 Windows 排程已建立後又
  **刪除**(`PoE1-MCP-Update` 已 Unregister)。
- `update-poe1.mjs`(repo 根)保留:可手動本機刷新,也是 GitHub workflow 的邏輯參考(patch 偵測 →
  新版才重建匯出 → 刷 poedb + RePoE → 重算版本)。用 Node 非 PS(避 PS5.1 CJK 編碼坑)。
- **待辦(之後上 GitHub 補)**:
  1. 把 `poe-ninja-pob-zh-poe1` 推成一個 GitHub repo(目前是無 .git 的複本)。
  2. 加 `.github/workflows/`:get-patch(PoE1)→ gen-config → 匯出 → build-* → build-dict(poedb)→
     build-stats → build-version → **fetch-repoe** → commit data/ + gamedata/。cron 每日。
  3. (要給 MCP 讀最新)可再發 GitHub Pages,或本機定時 `git pull`。

### 7. `tools/fetch-pob-uniques.mjs` + `gamedata/uniques.json`(傳奇 get_unique,plan §4/§14)
- 新增腳本。RePoE 的 uniques 不完整(名稱在 `Words`、詞綴不成表)→ 改抓 PoB
  `PathOfBuildingCommunity/PathOfBuilding` 的 `src/Data/Uniques/*.lua`(**純資料檔,不跑 PoB runtime**;
  用 GitHub raw 抓 master,永遠最新;本機那份 PoeCharm2 PoB 是改版,故不用它),
  解析成 `gamedata/uniques.json`(**1287 款**)。
- **格式**:每款傳奇 = 一個 `[[ ... ]]` 長字串。行序:名稱 / 底材(多底材皆 `{variant:N}` 前綴) /
  meta(`Variant:`/`League:`/`Source:`/`Requires`/`Implicits: N`) / implicit×N 行 / explicit。
  詞綴行可有 `{variant:1,2}{tags:..}{crafted}` 等前置標籤、數值範圍寫 `(min-max)`。
- **variant 三態**(取哪些詞綴的關鍵):
  - `current`:有名為 `Current` 的變體 → 只取該版(歷史 `Pre x.x.x` 丟棄)。多數裝備屬此。
  - `last`:無 Current,但變體名都是版本號式(`/\d/` 或 `^pre `)→ 依時序取最後一個。
  - `all`:無 Current,變體名是**描述性標籤**(神殿/光環/元素/史實人物名…)→ 判定「掉落隨機其一」,
    **保留全部變體詞綴**並去重、標 `pickOne`(共 30 款:塵燥之吼 13 神殿、Doryani's Delusion 三元素、
    Timeless Jewel 四人物、Beacon of Madness 三底材…)。**踩點:塵燥之吼**原本被 `last` 誤判只留最後一個
    (共鳴神殿),漏掉其他 12 種 → 才加這一態。
- **中文化不在此做**:uniques.json 只存英文原文,交給 poe-mcp `lib-uniques.mjs` 查詢時用 dict.names(名稱)
  + stat-templates(詞綴 `repoeTextToZhFilled`)轉繁中(與 mods.json 一樣「資料存英、查時翻」)。
- **★ 跳過的檔(踩過的坑)**:
  - 無 `[[` 的**表格式檔**(`graft.lua`/`Special/BoundByDestiny.lua`/`Special/WatchersEye.lua`):
    用 `["key"]={...}` 結構,非長字串,略過(無 `[[` 自動偵測)。
  - `Special/Generated.lua`:自動生成的**選變體/挑詞**傳奇(Precursor's Emblem、Sublime Vision、
    Vorana's March、Bound by Destiny、Impossible Escape、Watcher's Eye 詞池…),`[[` 區塊非 `]],[[` 串接、
    會解析破碎(item 被拆成兩半)→ 依檔名略過。這些暫時查不到,要收需另寫專屬解析。
  - 安全網:底材看起來像詞綴(空/含數字或%/太長/含冒號)的解析碎片一律丟棄。
- 驗收:`get_unique('Obliteration')` → 抹滅(Omen Wand/靈兆法杖),implicit 增加法傷 + explicit「獲得物理
  傷害的混沌傷害」+「你擊殺的敵人有 20% 機率爆炸…混沌傷害」,中文正確;`get_unique('獵首')` 中文名→英文解析 OK。

## 8. §12 自我擴充(2026-07-21 完成)—— 大改版自動接住新內容

**設計**:新「資料」原本就會自動流入(re-fetch);這輪把新「結構」也自動化,但**不粗暴全掃全收**
(全表盲收會把 dict.json 撐到十幾 MB、收進 NPC 對話/任務/MTX)。三道閘門:自動偵測 → 相關性
過濾 → 標記 unvalidated。

| 元件 | 做什麼 |
|------|--------|
| `tools/data-export/detect-new.mjs` | 掃 `--all` 全表匯出,找「有官方繁中、未對接」欄位:句子型→desc、短標籤型→ui 自動收(exact-node 比對零誤判);名稱型只報告不自動收(子字串比對有誤判風險)。寫 `auto-relevance.json`(status:unvalidated)。 |
| `relevance.mjs` | `DENY_TABLE_RE`(NPC/對話/任務/MTX/音效…,實測擋下 **83,005 句**)+ 防爆上限(單次 20 欄/15,000 句;累積 60 條目)。`entriesFor()/allTableNames()` 自動合併 auto 條目 → gen-config/build-* 全自動跟上。 |
| `build-descriptions/build-ui` | auto 條目寫進**獨立區塊** `descriptionsAuto`/`uiUnvalidated`(不混入已驗證資料;擴充端不讀,零影響)。 |
| `tools/fetch-repoe.mjs` | 改為解析 `poe1.html` 索引頁**自動發現新資料檔**;DENY(audio/visuals/_by_ 樞紐/minimal)+ 30MB 上限;**排除 uniques.min.json(會覆寫自家 PoB 版 uniques.json!)**;新檔記 `gamedata/auto-manifest.json`。索引掛掉自動退回 CORE 清單。 |
| poe-mcp `lib-gamedata` | 動態掃 gamedata/*.json:新資料集**自動可查**(lazy 載入);`query_gamedata` 的 dataset 由 z.enum 改 z.string(enum 原本把新資料集擋在 schema 層)。auto 資料集查詢結果帶「⚠️ 新結構/未驗證」指示。 |
| poe-mcp `lib-data`/server | `search_poe` 命中 descriptionsAuto 時標「〔新結構/未驗證〕」。 |
| `update-poe1.mjs` | 改版日:gen-config --all → 匯出 → **detect-new** → build-* → gen-config 復原;每日另加 fetch-pob-uniques。 |
| `tools/build-dict.mjs` | (a) 0 對照 slug 警告(poedb 改名提示);(b) 用 base_items 做**覆蓋率稽核**(哪類底材缺中文→該加哪個 slug;實測只剩 Relic 缺 7/14);(c) dict 合併改「展開保留全部區塊」,新區塊不會被每日刷新洗掉。 |

**首輪實測(3.28.0.16,591 表全掃)**:自動收 20 欄/13 條目(NecropolisPacks 怪群、傭兵技能、
掘獄地形、背叛獎勵、ReminderText、ClientStrings2、ArchnemesisMods…)→ descriptionsAuto **+5,894 句**;
dict.json 3.07MB → 4.01MB(全在獨立區塊);RePoE 自動發現 14 個新資料集(cluster_jewel_notables/
gem_tags/item_classes/buffs/world_areas…)→ gamedata 45.5MB → 54.7MB。防爆上限外仍有 144 欄候選
(每輪最多收 20,或人工轉正)。

## 9. 對抗式驗證 + 修復(2026-07-21,詳見 poe-mcp 報告)
- calc_build:pobb.in/tmNIKeb5f8HB 與 PoB GUI 快取值**逐位元一致**;5 種永恆珠寶全過;
  `.zip.part*` 分割解壓逐位元驗證;HeadlessWrapper 加 io.open 唯讀護欄(修 PoB 目錄被寫 .bin)。
- fetch-pob-uniques 解析器:修 **meta 洩漏 91 款/222 行**(Talisman Tier/Elder Item 打斷 meta 掃描
  → Variant:/Source:/Implicits: 混進詞綴、variant 機制失效);修 **Voices 誤判**(「Adds 7 Small
  Passive Skills」含數字被當版本號 → pickOne 30→32 款);新增 corrupted 旗標(52 款)。
- 詞綴中文化 miss 率:傳奇 4.8%→**1.8%**、mods 抽樣 19.8%→**0.4%**(根因:hybrid 多行詞綴整串
  查不到 → repoeTextToZh 逐行翻)。
- resolvePobCode 修誤抓 XML 內嵌 URL;read_build gem 名/ItemSet 標題 HTML entity 解碼;
  reverse_craft 無數字詞綴不再靜默丟(Cannot be Frozen 類)。

## 尚未做(可選,見 plan)
- **GitHub 自動更新**:見上「待辦」。要一併更新傳奇再加一步 `node tools/fetch-pob-uniques.mjs`。**未做。**
- **傳奇 `get_unique`**:✅ **已完成**(見上 §7)。剩 `Special/Generated.lua`/表格式檔的特殊傳奇未收。
- **Phase 3**:headless PoB 真實 DPS。使用者**已有 PoB**:
  `C:\Users\User\Desktop\PoeCharm2-20251103\Path of Building Community`(不用另裝)。**待做。**

## 怎麼跑一次完整重建(PoE1)
```powershell
cd tools\data-export
$env:PATCH = node get-patch.mjs        # 3.28.x
node gen-config.mjs
node node_modules/pathofexile-dat/dist/cli/run.js
# dict.json 若要全新 PoE1,先重置空骨架再跑 build-names/descriptions/ui
node ..\build-names.mjs; node build-descriptions.mjs; node build-ui.mjs
node build-stats.mjs
node ..\build-version.mjs
```
