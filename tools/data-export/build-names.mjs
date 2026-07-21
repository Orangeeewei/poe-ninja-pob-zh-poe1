/**
 * build-names.mjs — 用匯出的表(EN+TW，以 Id join)建立名稱字典，
 * 合併進 ../../data/dict.json（保留既有 POEDB 名稱，新增通貨/底材/天賦等）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { entriesFor } from './relevance.mjs';

// 用「腳本自身所在目錄」算路徑(cwd 無關),這樣不論從 repo 根目錄或 tools/data-export
// 執行都正確。CI「重建名稱字典」步驟與 build-dict 同一步、cwd 在根目錄,故必須如此。
const here = path.dirname(fileURLToPath(import.meta.url));
const dictPath = path.join(here, '..', '..', 'data', 'dict.json');

// route:'name' 的表(relevance.mjs 單一來源):BaseItemTypes/PassiveSkills/GemTags/
// Quest/WorldAreas/AlternatePassiveSkills。皆以 Id join、取 Name 欄,屬專有名詞 → 併入
// names(長者走多字子字串、短者走整節點精確比對)。ActiveSkills/Words/UniqueStashLayout
// 有特殊列序/join 邏輯,於下方各自特例處理。
const TABLES = entriesFor('name').map((e) => e.table);
const isCJK = (s) => /[㐀-鿿豈-﫿]/.test(s);
// 英文側:濾掉空/DNT/markup/單字噪音(length<2)。
const bad = (s) => !s || /^\[DNT\]|\bDNT\b|^<.*>$/.test(s) || s.length < 2;
// 中文側:同上但「不」套用 length<2 —— 單一中文字是合法譯名(弓/熊/龍/鏟)。
const badZh = (s) => !s || /^\[DNT\]|\bDNT\b|^<.*>$/.test(s);
// [Ref|顯示] -> 顯示；[Ref] -> Ref（GemTags 的 Name 是這種格式）
const stripRefs = (s) => (s || '').replace(/\[([^\]]+)\]/g, (_, x) => { const p = x.indexOf('|'); return p === -1 ? x : x.slice(p + 1); });

function loadJoin(table, col = 'Name') {
  const en = JSON.parse(readFileSync(path.join(here, 'tables', 'English', table + '.json'), 'utf8'));
  const tw = JSON.parse(readFileSync(path.join(here, 'tables', 'Traditional Chinese', table + '.json'), 'utf8'));
  const twById = new Map(tw.map((r) => [r.Id, r[col]]));
  const out = {};
  for (const r of en) {
    const enName = stripRefs(r[col]);
    const zhName = stripRefs(twById.get(r.Id));
    if (bad(enName) || !zhName || badZh(zhName)) continue;
    if (enName === zhName) continue;
    if (isCJK(enName) || !isCJK(zhName)) continue; // 英文側不該含中文、中文側必須含中文
    if (!(enName in out)) out[enName] = zhName;
  }
  return out;
}

const dict = JSON.parse(readFileSync(dictPath, 'utf8'));
const names = dict.names || {};
let added = 0;
for (const table of TABLES) {
  const m = loadJoin(table);
  let a = 0;
  for (const [en, zh] of Object.entries(m)) {
    if (!(en in names)) { names[en] = zh; a++; }
  }
  added += a;
  console.log(`${table}: 可用 ${Object.keys(m).length} 筆，新增 ${a} 筆`);
}

// 技能名:遊戲 ActiveSkills.DisplayedName(官方中文,如 Ground Slam→裂地之擊)。
// 先前技能名只靠 POEDB 爬蟲(不完整),改用遊戲表補齊。
// ⚠️ ActiveSkills 未匯出 Id 欄 → 不能用 Id join(會全對到 undefined)。
//    EN/TW 表以相同列序匯出,故以「列索引」對齊。
{
  const en = JSON.parse(readFileSync(path.join(here, 'tables', 'English', 'ActiveSkills.json'), 'utf8'));
  const tw = JSON.parse(readFileSync(path.join(here, 'tables', 'Traditional Chinese', 'ActiveSkills.json'), 'utf8'));
  let a = 0;
  let avail = 0;
  for (let i = 0; i < en.length && i < tw.length; i++) {
    const enName = stripRefs(en[i].DisplayedName);
    const zhName = stripRefs(tw[i].DisplayedName);
    if (bad(enName) || badZh(zhName) || enName === zhName) continue;
    if (isCJK(enName) || !isCJK(zhName)) continue;
    avail++;
    if (!(enName in names)) { names[enName] = zhName; a++; }
  }
  added += a;
  console.log(`ActiveSkills.DisplayedName(技能名,列序對齊): 可用 ${avail} 筆，新增 ${a} 筆`);
}

// 傳奇物品名:UniqueStashLayout.WordsKey 精確指向 Words 的「傳奇列」,
// 藉此避開 Words.Text2 的稀有物名稱生成字庫(Iron/Chaos/Edge… 單字)噪音。
// Words 無 Id,EN/TW 以列索引對齊;WordsKey 即列索引。
try {
  const usl = JSON.parse(readFileSync(path.join(here, 'tables', 'English', 'UniqueStashLayout.json'), 'utf8'));
  const wEn = JSON.parse(readFileSync(path.join(here, 'tables', 'English', 'Words.json'), 'utf8'));
  const wTw = JSON.parse(readFileSync(path.join(here, 'tables', 'Traditional Chinese', 'Words.json'), 'utf8'));
  const seen = new Set();
  let avail = 0;
  let a = 0;
  for (const row of usl) {
    const k = row.WordsKey;
    if (typeof k !== 'number' || k < 0 || k >= wEn.length) continue;
    const en = stripRefs(String(wEn[k].Text2 || '')).trim();
    const zh = stripRefs(String((wTw[k] || {}).Text2 || '')).trim();
    if (bad(en) || !zh || badZh(zh) || en === zh) continue;
    if (isCJK(en) || !isCJK(zh)) continue;
    if (seen.has(en)) continue;
    seen.add(en);
    avail++;
    if (!(en in names)) { names[en] = zh; a++; }
  }
  added += a;
  console.log(`UniqueStashLayout→Words.Text2(傳奇名): 可用 ${avail} 筆，新增 ${a} 筆`);

  // 遺物/碑牌/其餘傳奇:不在 UniqueStashLayout(PoE2 unique 分頁不含遺物/碑牌)。
  // 但它們在 Words.Text2 都有官方中文,且皆為「多字」名稱(如 Visions of Paradise→
  // 天堂異象、The Last Flame→終焉烈焰);Words 的稀有生成字庫噪音(Iron/Chaos…)
  // 全是「單字」,故「多字 Text2」可安全全收(實測 0 可疑)。
  let m = 0;
  for (let i = 0; i < wEn.length; i++) {
    const en = stripRefs(String(wEn[i].Text2 || '')).trim();
    const zh = stripRefs(String((wTw[i] || {}).Text2 || '')).trim();
    if (!en.includes(' ')) continue; // 只收多字 → 避開單字 affix 字庫
    if (bad(en) || !zh || badZh(zh) || en === zh) continue;
    if (isCJK(en) || !isCJK(zh)) continue;
    if (!(en in names)) { names[en] = zh; m++; }
  }
  added += m;
  console.log(`Words.Text2(多字傳奇名,含遺物/碑牌): 新增 ${m} 筆`);
} catch (e) {
  console.warn('skip Words/UniqueStashLayout', e.message);
}

const sorted = {};
for (const k of Object.keys(names).sort()) sorted[k] = names[k];
dict.names = sorted;
dict._source = 'poe2db.tw + PoE2 data export (pathofexile-dat)';
writeFileSync(dictPath, JSON.stringify(dict, null, 2), 'utf8');
console.log(`\n合併完成:總名稱 ${Object.keys(sorted).length} 筆（本次新增 ${added}）-> ${dictPath}`);
