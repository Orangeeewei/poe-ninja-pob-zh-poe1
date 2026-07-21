/**
 * fetch-repoe.mjs — 下載 RePoE(PoE1)處理好的遊戲數值資料到 ../gamedata/
 *
 * RePoE = 社群把 GGG .dat 處理成查詢友善 JSON(含數值範圍/tier/tags/spawn_weights)。
 * PoE1 版 base URL = https://repoe-fork.github.io/(PoE2 版才是 /poe2)。
 * 詞綴正規化用 '#'(與遊戲 stat-templates 的 '{}' 不同,別混)。
 *
 * §12 自我擴充:除了 CORE 清單,還解析 https://repoe-fork.github.io/poe1.html 的檔案索引
 * (每檔一個 href="./X.min.json"),自動發現「新出現的資料檔」:
 *   - DENY_FILE_RE 擋不相關/巨型 pivot 檔(audio/visuals/_by_ 樞紐/minimal 重複…)。
 *   - ⚠️ uniques.min.json 必須排除:gamedata/uniques.json 是我們自己從 PoB Lua 解析的
 *     傳奇資料(fetch-pob-uniques.mjs 產),RePoE 同名檔會把它覆寫掉!
 *   - 單檔 > SIZE_CAP 跳過(防爆)。
 *   - 新檔記錄在 gamedata/auto-manifest.json(status:'unvalidated');
 *     MCP 的 query_gamedata 據此把新資料集標「新結構/未驗證」。
 *   - 索引頁抓不到 → 退回 CORE 清單照舊(不因索引掛掉而中斷)。
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'gamedata');
const BASE = 'https://repoe-fork.github.io';
const INDEX = `${BASE}/poe1.html`;
const UA = { 'User-Agent': 'poe1-mcp gamedata fetch' };
const SIZE_CAP = 30 * 1024 * 1024; // 30MB(mods.json 21MB 為目前最大 CORE 檔)

// CORE:語意已驗證、MCP 工具依賴的檔(名稱 → 是否必需)。
const CORE = [
  ['mods.min.json', true],
  ['base_items.min.json', true],
  ['stat_translations.min.json', true],
  ['essences.min.json', true],
  ['fossils.min.json', true],
  ['crafting_bench_options.min.json', true],
  ['gems.min.json', false],
  ['mod_types.min.json', false],
];
const coreNames = new Set(CORE.map(([n]) => n));

// 自動發現的排除規則:不相關(音效/視覺/怪物)/重複樞紐(_by_、minimal)/會覆寫自家檔(uniques)
const DENY_FILE_RE = /audio|visual|monster|lab_layout|minimal|_by_|stats_by_file|^uniques\./i;

// 解析索引頁 → 可用 .min.json 檔名集合;失敗回 null(退回 CORE-only)
async function discover() {
  try {
    const res = await fetch(INDEX, { headers: UA });
    if (!res.ok) return null;
    const html = await res.text();
    const found = new Set();
    for (const m of html.matchAll(/href="\.\/([A-Za-z0-9_.-]+\.min\.json)"/g)) found.add(m[1]);
    return found.size ? found : null;
  } catch { return null; }
}

await mkdir(OUT, { recursive: true });

// 既有 auto-manifest(保留 firstSeen)
let manifest = { files: {} };
try { manifest = JSON.parse(await readFile(join(OUT, 'auto-manifest.json'), 'utf8')); } catch { /* 首次 */ }

const discovered = await discover();
const autoNew = [];
if (discovered) {
  for (const name of [...discovered].sort()) {
    if (coreNames.has(name)) continue;
    if (DENY_FILE_RE.test(name)) continue;
    autoNew.push([name, false]);
  }
} else {
  console.warn('⚠️ 索引頁抓取失敗,退回 CORE 清單(自動發現本次停用)');
}

const summary = [];
for (const [name, required] of [...CORE, ...autoNew]) {
  const url = `${BASE}/${name}`;
  const isAuto = !coreNames.has(name);
  try {
    const res = await fetch(url, { headers: UA });
    if (!res.ok) { summary.push(`${res.status} ${name}${required ? ' ⚠️必需卻失敗' : '(可選,略過)'}`); continue; }
    const len = Number(res.headers.get('content-length') || 0);
    if (isAuto && len > SIZE_CAP) { summary.push(`skip ${name}(${(len / 1e6).toFixed(1)}MB > 上限,防爆)`); continue; }
    const json = await res.json();
    const outName = name.replace('.min', '');
    await writeFile(join(OUT, outName), JSON.stringify(json), 'utf8');
    const n = Array.isArray(json) ? json.length : Object.keys(json).length;
    if (isAuto && !manifest.files[outName]) {
      manifest.files[outName] = { firstSeen: new Date().toISOString().slice(0, 10), status: 'unvalidated' };
    }
    summary.push(`✓ ${outName}  (${n} 筆)${isAuto ? '  [auto/unvalidated]' : ''}`);
  } catch (e) {
    summary.push(`ERR ${name}: ${e.message}${required ? ' ⚠️' : ''}`);
  }
}

await writeFile(join(OUT, 'auto-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log('RePoE PoE1 gamedata → ' + OUT);
console.log(summary.join('\n'));
const autoCnt = Object.keys(manifest.files).length;
if (autoCnt) console.log(`\nauto-manifest:${autoCnt} 個自動發現資料集(unvalidated;人工驗證後改 status 或收進 CORE)`);
