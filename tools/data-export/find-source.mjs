/**
 * find-source.mjs — 「未翻譯字串 → 官方來源」定位器(消零星英文殘留的標準流程第 2 步)。
 *
 * 流程:① poe.ninja 右下按鈕 Alt+點 → 匯出未翻譯字串(JSON 陣列,已在剪貼簿)
 *      ② node find-source.mjs misses.json        (或直接給字串:node find-source.mjs "Explosion" "…")
 *      ③ 依報告決定:加 relevance.mjs 路由 / 修 build 規則 / keepEnglish / 真的沒官方繁中
 *
 * 搜尋範圍(皆去 [Ref|顯示] 參照、忽略大小寫、空白正規化):
 *   - 所有 .csd 詞綴模板(當前 patch,自 .cache 讀;數字以 {N} 佔位比對)
 *   - tables/ 已匯出的全部表(EN 欄命中 → 印同列繁中;要涵蓋未對接的表請先
 *     `node gen-config.mjs --all && node node_modules/pathofexile-dat/dist/cli/run.js`)
 *   - data/*.json 成品(命中代表資料有、是引擎比對問題,不是資料缺)
 *
 * 用法:node find-source.mjs <misses.json | 字串…>   環境變數 POE2_PATCH(預設讀 config.json)
 */
import * as loaders from './node_modules/pathofexile-dat/dist/cli/bundle-loaders.js';
import { readIndexBundle } from './node_modules/pathofexile-dat/dist/bundles/index-bundle.js';
import { getDirContent } from './node_modules/pathofexile-dat/dist/bundles/index-paths.js';
import { decompressSliceInBundle, decompressedBundleSize } from './node_modules/pathofexile-dat/dist/bundles/bundle.js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// PoE1:詞綴描述在 metadata/statdescriptions/*.txt(UTF-16LE,格式同 PoE2 的 .csd)
const STAT_DIR = 'metadata/statdescriptions';
const STAT_EXT = '.txt';
const NUM = '[+-]?\\d+(?:[.,]\\d+)*';
const RANGE = '[+-]?\\([+-]?(?:\\d+(?:[.,]\\d+)*)-[+-]?(?:\\d+(?:[.,]\\d+)*)\\)'; // poe.ninja 的 (15-20) / (-10-10) 範圍值

function resolvePatch() {
  if (process.env.POE2_PATCH) return process.env.POE2_PATCH;
  if (process.env.PATCH) return process.env.PATCH;
  try { return JSON.parse(readFileSync(path.join(here, 'config.json'), 'utf8')).patch; } catch { return null; }
}

const stripRefs = (s) => String(s || '').replace(/\[([^\]]+)\]/g, (_, inner) => { const p = inner.indexOf('|'); return p === -1 ? inner : inner.slice(p + 1); });
const norm = (s) => stripRefs(s).replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
// 數字與 {N} 都換成 {} → 與 build-stats 的 bucketKey 同構,讓「100% of …」對得上「{0}% of …」
const bucket = (s) => norm(s).replace(/\{\d+(?::[^}]*)?\}/g, '{}').replace(new RegExp(RANGE, 'g'), '{}').replace(new RegExp(NUM, 'g'), '{}');

// ---- 輸入 ----
const args = process.argv.slice(2);
if (!args.length) { console.error('用法:node find-source.mjs <misses.json | 字串…>'); process.exit(1); }
let queries = [];
for (const a of args) {
  if (a.endsWith('.json') && existsSync(a)) queries.push(...JSON.parse(readFileSync(a, 'utf8')));
  else queries.push(a);
}
queries = [...new Set(queries.map((q) => String(q).trim()).filter(Boolean))];
const qb = queries.map((q) => ({ q, b: bucket(q), n: norm(q) }));
const hits = new Map(queries.map((q) => [q, []]));
const add = (q, src, en, zh) => hits.get(q).push({ src, en, zh });
const matchQ = (enRaw, test) => {
  const b = bucket(enRaw);
  const n = norm(enRaw);
  const out = [];
  for (const e of qb) if (b === e.b || n === e.n || (test && test(n, e.n))) out.push(e.q);
  return out;
};

// ---- 1) 成品 data/*.json ----
{
  const dataDir = path.join(here, '..', '..', 'data');
  try {
    const dict = JSON.parse(readFileSync(path.join(dataDir, 'dict.json'), 'utf8'));
    for (const [sec, map] of [['names', dict.names], ['descriptions', dict.descriptions], ['uiAuto', dict.uiAuto]]) {
      for (const [en, zh] of Object.entries(map || {})) for (const q of matchQ(en)) add(q, `data/dict.json ${sec}`, en, zh);
    }
    const ui = JSON.parse(readFileSync(path.join(dataDir, 'ui-labels.json'), 'utf8'));
    for (const [en, zh] of Object.entries(ui.labels || {})) for (const q of matchQ(en)) add(q, 'data/ui-labels.json', en, zh);
    for (const en of ui.keepEnglish || []) for (const q of matchQ(en)) add(q, 'data/ui-labels.json keepEnglish(刻意保留英文)', en, '');
    const st = JSON.parse(readFileSync(path.join(dataDir, 'stat-templates.json'), 'utf8'));
    for (const arr of Object.values(st.templates || {})) for (const t of arr) for (const q of matchQ(t.en)) add(q, 'data/stat-templates.json', t.en, t.zh);
    for (const t of st.textTemplates || []) for (const q of matchQ(t.en)) add(q, 'data/stat-templates.json textTemplates', t.en, t.zh);
  } catch (e) { console.warn('skip data/*.json:', e.message); }
}

// ---- 2) tables/(EN 欄命中 → 同列 TW)----
{
  const enDir = path.join(here, 'tables', 'English');
  const twDir = path.join(here, 'tables', 'Traditional Chinese');
  let files = [];
  try { files = readdirSync(enDir).filter((f) => f.endsWith('.json')); } catch { /* no tables */ }
  for (const f of files) {
    let en, tw;
    try { en = JSON.parse(readFileSync(path.join(enDir, f), 'utf8')); } catch { continue; }
    try { tw = JSON.parse(readFileSync(path.join(twDir, f), 'utf8')); } catch { tw = null; }
    const table = f.replace(/\.json$/, '');
    for (let i = 0; i < en.length; i++) {
      for (const [col, v] of Object.entries(en[i])) {
        if (typeof v !== 'string' || !v) continue;
        // 整值命中,或多行值的其中一行命中
        const parts = [v, ...v.split(/\r?\n/)];
        const zv = tw && tw[i] ? tw[i][col] : undefined;
        const seen = new Set();
        for (const p of parts) {
          for (const q of matchQ(p)) {
            if (seen.has(q)) continue;
            seen.add(q);
            add(q, `tables ${table}.${col}[${i}]`, v.replace(/\r?\n/g, '\\n'), zv === undefined ? '(無繁中表)' : String(zv).replace(/\r?\n/g, '\\n'));
          }
        }
      }
    }
  }
}

// ---- 3) .csd(當前 patch)----
async function listCsdFiles(cdn) {
  const indexBin = await cdn.fetchFile('_.index.bin');
  const ib = new Uint8Array(decompressedBundleSize(indexBin));
  decompressSliceInBundle(indexBin, 0, ib);
  const idx = readIndexBundle(ib);
  const pr = new Uint8Array(decompressedBundleSize(idx.pathRepsBundle));
  decompressSliceInBundle(idx.pathRepsBundle, 0, pr);
  const out = [];
  const visit = (dir) => {
    let c;
    try { c = getDirContent(dir, pr, idx.dirsInfo); } catch { return; }
    for (const f of c.files) if (f.endsWith(STAT_EXT)) out.push(f);
    for (const d of c.dirs) visit(d);
  };
  visit(STAT_DIR);
  return out.sort();
}
const extractTemplate = (line) => {
  const a = line.indexOf('"');
  const b = line.lastIndexOf('"');
  return a === -1 || b <= a ? null : line.slice(a + 1, b);
};
const PATCH = resolvePatch();
if (PATCH) {
  const origLog = console.log;
  console.log = (...a) => { if (!/^Loading/.test(String(a[0]))) origLog(...a); }; // 靜音 bundle 下載訊息
  const cdn = await loaders.CdnBundleLoader.create(path.join(here, '.cache'), PATCH);
  const loader = await loaders.FileLoader.create(cdn);
  const files = await listCsdFiles(cdn);
  console.log = origLog;
  for (const f of files) {
    const data = await loader.tryGetFileContents(f);
    if (!data) continue;
    const lines = Buffer.from(data).toString('utf16le').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() !== 'description') continue;
      // 區塊:description / id 行 / 英文變體 / lang 變體…;找英文變體命中,再抓繁中變體
      const start = i;
      let end = i + 1;
      while (end < lines.length && lines[end].trim() !== 'description') end++;
      const block = lines.slice(start, end);
      let zhStart = block.findIndex((l) => /^\s*lang\s+"Traditional Chinese"/.test(l));
      let zhEnd = zhStart === -1 ? -1 : block.findIndex((l, k) => k > zhStart && /^\s*lang\s+"/.test(l));
      if (zhStart !== -1 && zhEnd === -1) zhEnd = block.length;
      const enEnd = block.findIndex((l, k) => k > 1 && /^\s*lang\s+"/.test(l));
      const enLines = block.slice(2, enEnd === -1 ? block.length : enEnd);
      const zhLines = zhStart === -1 ? [] : block.slice(zhStart + 1, zhEnd);
      const id = (block[1] || '').trim();
      enLines.forEach((l, k) => {
        const t = extractTemplate(l);
        if (!t) return;
        const parts = [t, ...t.split(/\\n/)];
        const seen = new Set();
        for (const p of parts) {
          for (const q of matchQ(p)) {
            if (seen.has(q)) continue;
            seen.add(q);
            const zt = zhLines[k] ? extractTemplate(zhLines[k]) : null;
            add(q, `csd ${f.replace(STAT_DIR + '/', '')} [${id}]`, t, zt === null ? '(無繁中變體)' : zt);
          }
        }
      });
      i = end - 1;
    }
  }
} else {
  console.warn('未指定 patch(POE2_PATCH 或 config.json)→ 略過 .csd 搜尋');
}

// ---- 報告 ----
let found = 0;
for (const q of queries) {
  const h = hits.get(q);
  console.log(`\n=== ${q}`);
  if (!h.length) { console.log('   (無命中:官方表/.csd 都找不到 → 可能是 poe.ninja 站方文字、需擴大匯出表、或官方無繁中)'); continue; }
  found++;
  const inData = h.some((x) => x.src.startsWith('data/'));
  console.log(inData ? '   ▶ 成品資料已含此字串 → 是引擎比對/DOM 結構問題,非資料缺'
                     : '   ▶ 官方來源有、成品沒有 → 對接:加 relevance.mjs 路由或修 build 規則');
  for (const x of h.slice(0, 8)) console.log(`   [${x.src}]\n      EN: ${x.en}\n      TW: ${x.zh}`);
  if (h.length > 8) console.log(`   … 另 ${h.length - 8} 筆`);
}
console.log(`\n${found}/${queries.length} 個字串找到來源`);
