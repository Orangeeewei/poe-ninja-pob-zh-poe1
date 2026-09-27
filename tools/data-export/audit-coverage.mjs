/**
 * audit-coverage.mjs — 稽核:掃描所有已匯出的 EN/TW 表,找出「有官方繁中」的 string 欄,
 * 並依字串形態分類(短 UI / 句子描述),標出哪些「目前 curated 管線沒對接」。
 *
 * 純唯讀分析,不寫任何成品檔。供決定動態 harvester 要納入什麼用。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROUTED, SPECIAL_TABLES } from './relevance.mjs';

const here = process.cwd();

// --out <檔案>:把報告同時寫成 markdown(CI 用;人看 repo 的 diff 就知道有沒有新欄位要對接)
const OUT = (() => { const i = process.argv.indexOf('--out'); return i !== -1 ? process.argv[i + 1] : null; })();
const outBuf = [];
if (OUT) {
  const orig = console.log;
  console.log = (...a) => { const s = a.join(' '); outBuf.push(s); orig(s); };
}
const enDir = path.join(here, 'tables', 'English');
const twDir = path.join(here, 'tables', 'Traditional Chinese');

const stripRefs = (s) =>
  String(s || '').replace(/\[([^\]]+)\]/g, (_, inner) => {
    const pipe = inner.indexOf('|');
    return pipe === -1 ? inner : inner.slice(pipe + 1);
  });
const norm = (s) => stripRefs(s).replace(/\s+/g, ' ').trim();
const isCJK = (s) => /[㐀-鿿豈-﫿]/.test(s);
const hasLetter = (s) => /[A-Za-z]/.test(s);

// 已對接的來源,直接由 relevance.mjs 推導(單一事實來源),不再手動維護:
//   - ROUTED columns:'*' → 整張表所有欄都算已對接(用 'Table.*' 標記)
//   - ROUTED columns:[...] → 該表指定欄
//   - SPECIAL_TABLES(Words/UniqueStashLayout/ClientStrings)→ 整張表(特例腳本處理)
const CURATED = new Set();
for (const r of ROUTED) {
  if (r.columns === '*') CURATED.add(`${r.table}.*`);
  else for (const c of r.columns) CURATED.add(`${r.table}.${c}`);
}
for (const t of Object.keys(SPECIAL_TABLES)) CURATED.add(`${t}.*`);
const isCurated = (table, col) => CURATED.has(`${table}.*`) || CURATED.has(`${table}.${col}`);

const files = readdirSync(enDir).filter((f) => f.endsWith('.json'));
const rows = [];

for (const file of files) {
  const table = file.replace(/\.json$/, '');
  let en, tw;
  try {
    en = JSON.parse(readFileSync(path.join(enDir, file), 'utf8'));
    tw = JSON.parse(readFileSync(path.join(twDir, file), 'utf8'));
  } catch { continue; }
  if (!Array.isArray(en) || !en.length) continue;
  const cols = Object.keys(en[0] || {});
  for (const col of cols) {
    let total = 0, loc = 0, sentence = 0, shortUi = 0, name = 0;
    const samples = [];
    const n = Math.min(en.length, tw.length);
    for (let i = 0; i < n; i++) {
      const ev = norm(en[i][col]);
      const zv = norm(tw[i][col]);
      if (!ev) continue;
      total++;
      if (!zv || ev === zv) continue;
      if (!hasLetter(ev) || !isCJK(zv)) continue;
      loc++;
      const multiWord = ev.includes(' ');
      if (ev.length >= 12 && multiWord) sentence++;
      else if (multiWord) name++; // 多字但短 → 多為專有名詞片語
      else shortUi++;             // 單字 → UI/標籤
      if (samples.length < 2) samples.push(`${ev} → ${zv}`);
    }
    if (loc < 3) continue; // 太少 → 忽略雜訊
    rows.push({ key: `${table}.${col}`, total, loc, sentence, name, shortUi, samples, curated: isCurated(table, col) });
  }
}

rows.sort((a, b) => b.loc - a.loc);

const NEW = rows.filter((r) => !r.curated);
console.log(`\n=== 有官方繁中的 string 欄:${rows.length} 個(curated ${rows.length - NEW.length} / 未對接 ${NEW.length}) ===\n`);

const fmt = (r) => `${String(r.loc).padStart(5)} 譯 | 句${String(r.sentence).padStart(4)} 名${String(r.name).padStart(4)} 短${String(r.shortUi).padStart(4)} | ${r.key}`;

console.log('--- 未對接、且以「句子」為主(最該納入 descriptions,exact-match 安全)---');
for (const r of NEW.filter((r) => r.sentence >= r.loc * 0.5 && r.sentence >= 5)) {
  console.log(fmt(r));
  for (const s of r.samples) console.log(`        e.g. ${s.slice(0, 90)}`);
}

console.log('\n--- 未對接、以「名稱/多字片語」為主 ---');
for (const r of NEW.filter((r) => r.name >= r.loc * 0.5 && r.name >= 5 && r.sentence < r.loc * 0.5)) {
  console.log(fmt(r));
  for (const s of r.samples) console.log(`        e.g. ${s.slice(0, 90)}`);
}

console.log('\n--- 未對接、以「單字短 UI」為主(高風險,需謹慎)---');
let shortShown = 0;
for (const r of NEW.filter((r) => r.shortUi >= r.loc * 0.5 && r.shortUi >= 5)) {
  if (shortShown++ < 40) console.log(fmt(r));
}

console.log(`\n=== 總計未對接句子型欄位的可譯句數合計 ===`);
const sentSum = NEW.filter((r) => r.sentence >= 5).reduce((a, r) => a + r.sentence, 0);
console.log(`未對接欄位的「句子」可譯數合計約 ${sentSum}`);

if (OUT) {
  const patch = process.env.PATCH || process.env.POE2_PATCH || '';
  writeFileSync(OUT,
    '# 官方繁中欄位對接稽核\n\n' +
    `patch:${patch || '(未知)'}\n\n` +
    '由 CI 每日自動產生(`audit-coverage.mjs --out`)。「未對接」= 該欄有官方繁中但 `relevance.mjs` 尚未路由;\n' +
    '若某欄的內容 poe.ninja 會顯示,把它加進 `relevance.mjs` 的 ROUTED 即可,下次 build 自動納入。\n\n' +
    '```\n' + outBuf.join('\n') + '\n```\n', 'utf8');
  console.log(`報告已寫入 ${OUT}`);
}
