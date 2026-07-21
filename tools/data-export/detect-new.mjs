/**
 * detect-new.mjs — §12 L1 自我擴充:自動偵測「新出現的可譯結構」並納入管線(標 unvalidated)。
 *
 * 跑法(先 --all 全表匯出,才有東西可掃):
 *   node gen-config.mjs --all && node node_modules/pathofexile-dat/dist/cli/run.js
 *   node detect-new.mjs          # 掃描 + 更新 auto-relevance.json
 *   node detect-new.mjs --dry    # 只報告,不寫檔
 *
 * 設計(對照 plan §12 的安全設計):
 *   1. 只看「有官方繁中」的 string 欄(EN/TW 逐列比對,與 audit-coverage 同法)。
 *   2. 相關性過濾:DENY_TABLE_RE(NPC 對話/任務/MTX/音效……)整表排除 —— 防爆核心,
 *      全表盲收會把 dict.json 從 3MB 撐到十幾 MB。
 *   3. 只自動收「零誤判風險」的路由:
 *        - 句子型欄 → route:'desc'(整節點精確比對,未命中只是死資料)
 *        - 短標籤型欄 → route:'ui'(整節點精確 + UI_MAXLEN + denylist 三道保險)
 *      名稱型(多字子字串比對有誤判風險)**不自動收**,只列出來供人工判斷加進 ROUTED。
 *   4. 防爆上限:單次新收 ≤ AUTO_MAX_TABLES 個欄位組、估計新句數 ≤ AUTO_MAX_SENTENCES。
 *   5. 產出 auto-relevance.json,條目帶 status:'unvalidated' + firstSeen patch;
 *      build-descriptions/build-ui 會把這些寫進 dict 的「獨立區塊」(descriptionsAuto /
 *      uiUnvalidated),MCP 查詢命中時標「新結構/未驗證」,絕不默默混入已驗證資料。
 *   6. 人工轉正:確認 OK 後把條目搬進 relevance.mjs 的 ROUTED、從 auto-relevance.json 刪除。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROUTED, SPECIAL_TABLES, DENY_TABLE_RE, AUTO_FILE, AUTO_MAX_TABLES, AUTO_MAX_SENTENCES, AUTO_MAX_TOTAL,
} from './relevance.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const enDir = path.join(here, 'tables', 'English');
const twDir = path.join(here, 'tables', 'Traditional Chinese');
const DRY = process.argv.includes('--dry');

const stripRefs = (s) => String(s || '').replace(/\[([^\]]+)\]/g, (_, x) => { const p = x.indexOf('|'); return p === -1 ? x : x.slice(p + 1); });
const norm = (s) => stripRefs(s).replace(/\s+/g, ' ').trim();
const isCJK = (s) => /[㐀-鿿豈-﫿]/.test(s);
const hasLetter = (s) => /[A-Za-z]/.test(s);

// 已對接(curated)= ROUTED + SPECIAL(同 audit-coverage 規則)
const CURATED = new Set();
for (const r of ROUTED) {
  if (r.columns === '*') CURATED.add(`${r.table}.*`);
  else for (const c of r.columns) CURATED.add(`${r.table}.${c}`);
}
for (const t of Object.keys(SPECIAL_TABLES)) CURATED.add(`${t}.*`);
const isCurated = (t, c) => CURATED.has(`${t}.*`) || CURATED.has(`${t}.${c}`);

// 讀既有 auto-relevance(保留舊條目,偵測只「增量」;表消失才移除)
let prev = { entries: [] };
try { prev = JSON.parse(readFileSync(AUTO_FILE, 'utf8')); } catch { /* 首次 */ }
const prevKey = new Set(prev.entries.flatMap((e) => e.columns.map((c) => `${e.table}.${c}`)));

const patch = process.env.PATCH ||
  (existsSync(path.join(here, 'config.json')) ? JSON.parse(readFileSync(path.join(here, 'config.json'), 'utf8')).patch : '?');

// ---- 掃描全表 ----
const candidates = [];   // 可自動收
const nameOnly = [];     // 名稱型:只報告,不自動收
const denied = [];       // 被 DENY 擋下的表(有繁中但不相關)
const files = readdirSync(enDir).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const table = file.replace(/\.json$/, '');
  let en, tw;
  try {
    en = JSON.parse(readFileSync(path.join(enDir, file), 'utf8'));
    tw = JSON.parse(readFileSync(path.join(twDir, file), 'utf8'));
  } catch { continue; }
  if (!Array.isArray(en) || !en.length) continue;
  const deniedTable = DENY_TABLE_RE.test(table);
  for (const col of Object.keys(en[0] || {})) {
    if (isCurated(table, col)) continue;
    if (prevKey.has(`${table}.${col}`)) continue; // 已在 auto 清單
    let loc = 0, sentence = 0, shortUi = 0, name = 0;
    const samples = [];
    const n = Math.min(en.length, tw.length);
    for (let i = 0; i < n; i++) {
      const ev = norm(en[i][col]);
      const zv = norm(tw[i][col]);
      if (!ev || !zv || ev === zv) continue;
      if (!hasLetter(ev) || !isCJK(zv)) continue;
      loc++;
      const multi = ev.includes(' ');
      if (ev.length >= 12 && multi) sentence++;
      else if (multi) name++;
      else shortUi++;
      if (samples.length < 2) samples.push(`${ev.slice(0, 60)} → ${zv.slice(0, 30)}`);
    }
    if (loc < 5) continue; // 少於 5 筆 → 雜訊
    if (deniedTable) { denied.push({ key: `${table}.${col}`, loc }); continue; }
    if (sentence >= loc * 0.5) candidates.push({ table, col, route: 'desc', loc, est: sentence, samples });
    else if (shortUi >= loc * 0.5) candidates.push({ table, col, route: 'ui', loc, est: shortUi, samples });
    else nameOnly.push({ key: `${table}.${col}`, loc, samples });
  }
}

// ---- 防爆上限:依 loc 高→低取,超限的列出但不收 ----
candidates.sort((a, b) => b.loc - a.loc);
const accepted = [];
const overflow = [];
let estSum = 0;
const room = Math.max(0, AUTO_MAX_TOTAL - prev.entries.length); // 累積總量防爆
for (const c of candidates) {
  if (accepted.length >= Math.min(AUTO_MAX_TABLES, room) || estSum + c.est > AUTO_MAX_SENTENCES) { overflow.push(c); continue; }
  accepted.push(c); estSum += c.est;
}

// ---- 合併寫檔(同 table+route 併 columns)----
const merged = [...prev.entries];
for (const c of accepted) {
  const hit = merged.find((e) => e.table === c.table && e.route === c.route);
  if (hit) { if (!hit.columns.includes(c.col)) hit.columns.push(c.col); }
  else merged.push({ table: c.table, route: c.route, columns: [c.col], status: 'unvalidated', firstSeen: patch, loc: c.loc });
}
// 表已消失(改名/移除)→ 剔除並提示
const alive = new Set(files.map((f) => f.replace(/\.json$/, '')));
const kept = merged.filter((e) => alive.has(e.table));
for (const e of merged) if (!alive.has(e.table)) console.warn(`⚠️ auto 條目的表已消失,移除:${e.table}`);

if (!DRY) {
  writeFileSync(AUTO_FILE, JSON.stringify({ patch, updatedAt: new Date().toISOString(), entries: kept }, null, 2), 'utf8');
}

// ---- 報告 ----
console.log(`detect-new[${DRY ? 'dry' : 'write'}]: patch=${patch} 掃 ${files.length} 表`);
console.log(`本次新收 ${accepted.length} 欄(估 ${estSum} 句)→ auto-relevance.json 共 ${kept.length} 條目`);
for (const c of accepted) {
  console.log(`  + [${c.route}] ${c.table}.${c.col}(${c.loc} 譯)e.g. ${c.samples[0] || ''}`);
}
if (overflow.length) {
  console.log(`\n⚠️ 超過防爆上限未收 ${overflow.length} 欄(調 AUTO_MAX_* 或人工加 ROUTED):`);
  for (const c of overflow.slice(0, 10)) console.log(`    [${c.route}] ${c.table}.${c.col}(${c.loc} 譯)`);
}
if (nameOnly.length) {
  console.log(`\nℹ️ 名稱型欄位 ${nameOnly.length} 個(子字串比對有誤判風險,不自動收;要用請人工加進 ROUTED 的 name 路由):`);
  for (const c of nameOnly.slice(0, 12)) console.log(`    ${c.key}(${c.loc} 譯)e.g. ${c.samples[0] || ''}`);
}
if (denied.length) {
  const sum = denied.reduce((a, d) => a + d.loc, 0);
  console.log(`\n🚫 DENY 表擋下 ${denied.length} 欄 / 約 ${sum} 句(NPC 對話/任務/MTX 等,刻意不收)`);
}
