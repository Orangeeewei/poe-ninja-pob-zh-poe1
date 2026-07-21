/**
 * gen-config.mjs — 動態產生 pathofexile-dat 的 config.json(取代寫死的表清單)。
 *
 * 動機:原本表清單寫死在「本機 config.json + CI workflow heredoc」兩處,已漂移不一致
 * (本機 18 表、CI 16 表),且未來遊戲新增欄位不會自動納入。改成:
 *   - 表清單來自 relevance.mjs(單一事實來源;與 poe2db 同源、poe.ninja 會顯示的表)。
 *   - 每張表的「string 欄位」由 schema.json **動態推導**(取所有具名非陣列 string 欄)
 *     → 未來該表新增中文欄位會自動被匯出、自動被 build 腳本掃到。
 *   - 只保留「當前 patch bundle 真的有 .datc64」的表(schema 列了很多版本不存在的幽靈表;
 *     pathofexile-dat 遇缺檔會整個中止,故必須先過濾)。
 *   ⚠️ 不能用 schema 的 localized 旗標篩 —— 它有假陰性(Description / SupportText /
 *      Words.Text2 都標 false 卻有官方繁中)。可靠訊號是 build 階段的 EN/TW 逐列比對。
 *
 * 模式:
 *   node gen-config.mjs          # 正式:只匯出 relevance.mjs 的相關表(快,約 30 表)
 *   node gen-config.mjs --all    # 稽核:匯出全部 PoE2 表(供 audit-coverage.mjs 找新模塊)
 *   node gen-config.mjs --refresh-schema   # 強制重新下載 schema(否則有本地 cache 就用)
 *
 * schema 來源:與 pathofexile-dat 同一個 SCHEMA_URL(dat-schema 的 latest release)。
 *   schema.json 已 gitignore,CI 沒有本地檔 → 自動下載並 cache。這也讓 schema 永遠跟著
 *   社群最新版,新表/新欄自動跟上(動態)。
 * patch 版本:優先環境變數 PATCH/POE2_PATCH,否則沿用既有 config.json,再否則 fallback。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_URL } from 'pathofexile-dat-schema';
import * as loaders from './node_modules/pathofexile-dat/dist/cli/bundle-loaders.js';
import { listDatTables } from './list-tables.mjs';
import { allTableNames, SPECIAL_TABLES } from './relevance.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(here, 'schema.json');
const configPath = path.join(here, 'config.json');

const FALLBACK_PATCH = '3.28.0.16';   // PoE1(實測 patch.pathofexile.com:12995 回傳值)
const ALL = process.argv.includes('--all');
const REFRESH = process.argv.includes('--refresh-schema');

// 取得 schema:本地有 cache(且未要求 refresh)就讀檔,否則從 SCHEMA_URL 下載並 cache。
async function loadSchema() {
  if (!REFRESH && existsSync(schemaPath)) {
    return JSON.parse(readFileSync(schemaPath, 'utf8'));
  }
  console.log(`下載 schema:${SCHEMA_URL}`);
  const res = await fetch(SCHEMA_URL);
  if (!res.ok) throw new Error(`schema 下載失敗 HTTP ${res.status}`);
  const json = await res.json();
  writeFileSync(schemaPath, JSON.stringify(json), 'utf8');
  return json;
}

function resolvePatch() {
  if (process.env.PATCH) return process.env.PATCH;
  if (process.env.POE2_PATCH) return process.env.POE2_PATCH;
  if (existsSync(configPath)) {
    try {
      const c = JSON.parse(readFileSync(configPath, 'utf8'));
      if (c.patch) return c.patch;
    } catch { /* ignore */ }
  }
  return FALLBACK_PATCH;
}

const patch = resolvePatch();
const schema = await loadSchema();

// ★ PoE1 修正:schema 有 249 組「同名表」(每款遊戲一個變體,欄位不同)。
// 原本 `new Map(schema.tables.map(...))` 保留「最後一個」→ PoE2 管線靠陣列順序碰巧拿到
// PoE2 變體;但 PoE1 會誤拿 PoE2 變體(欄位多出 GrantedEffect 等),匯出時 pathofexile-dat
// 嚴格比對真實 .dat 就會爆「doesn't have a column named …」。
// 故:依本遊戲位元挑變體(GAME_BIT & validFor);無同遊戲變體才退而求其次。
const GAME_BIT = 1; // 1 = PoE1(此 fork);PoE2 版請設 2
const byName = new Map();
for (const t of schema.tables) {
  const cur = byName.get(t.name);
  if (!cur || ((t.validFor & GAME_BIT) && !(cur.validFor & GAME_BIT))) byName.set(t.name, t);
}

// 當前 patch 的 bundle 實際存在哪些表(小寫檔名集合);用來過濾 schema 的幽靈表。
const cdn = await loaders.CdnBundleLoader.create(path.join(here, '.cache'), patch);
const existing = await listDatTables(cdn);
const exists = (name) => existing.has(name.toLowerCase());

// 動態取某 schema 表的所有「具名、非陣列」string 欄 + 強制鍵欄(SPECIAL 的 join 鍵)。
function columnsOf(schemaTable) {
  const cols = [];
  for (const c of schemaTable.columns) {
    if (!c.name || c.array) continue;
    if (c.type === 'string') cols.push(c.name);
  }
  for (const forced of SPECIAL_TABLES[schemaTable.name] || []) {
    if (schemaTable.columns.some((c) => c.name === forced) && !cols.includes(forced)) cols.push(forced);
  }
  return cols;
}

// 要產生 config 的表名集合:--all = 全 PoE2 表;否則 = relevance.mjs 的相關表。
const wanted = ALL
  ? schema.tables.filter((t) => t.validFor & 1).map((t) => t.name)   // 1 = PoE1(已驗:BaseItemTypes/Mods/Stats 皆 validFor&1)
  : allTableNames();

const tables = [];
let colCount = 0;
let skippedGhost = 0;
const missingFromSchema = [];

for (const name of [...new Set(wanted)].sort((a, b) => a.localeCompare(b))) {
  const st = byName.get(name);
  if (!st) { missingFromSchema.push(name); continue; }
  if (!exists(name)) { skippedGhost++; continue; }
  const cols = columnsOf(st);
  if (cols.length === 0) continue;
  tables.push({ name, columns: cols });
  colCount += cols.length;
}

const config = { patch, translations: ['English', 'Traditional Chinese'], tables };
writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

console.log(
  `gen-config[${ALL ? 'ALL' : 'relevance'}]: patch=${patch} → ${tables.length} 表 / ${colCount} string 欄` +
  `(略過 ${skippedGhost} 個 bundle 不存在的表)-> config.json`
);
if (missingFromSchema.length) {
  console.warn(`⚠️ relevance.mjs 列了但 schema 沒有的表(可能改名):${missingFromSchema.join(', ')}`);
}
