/**
 * build-ui.mjs — 自動產生「整節點精確比對」UI 字典,寫進 ../../data/dict.json 的 uiAuto。
 *
 * 來源表:relevance.mjs 標 route:'ui' 的表(單一事實來源)。每張表「動態掃描所有
 * string 欄」(非寫死欄名)→ 未來新增中文欄位自動納入。
 *   - ItemClasses/ItemClassCategories/Characters 物品類別/職業名
 *   - SupportGemFamily 輔助寶石類別
 *   - BuffDefinitions 異常狀態/增益名(Ignited→點燃)
 *   - KeywordPopups 關鍵字名詞(Physical Damage→物理傷害)
 *   - Ascendancy 昇華職業名(Deadeye→銳眼)
 *
 * 安全性:translator 以「整個文字節點 === key」精確比對才替換(不做子字串),故短字
 *   也不會切壞句子。再加兩道保險:① maxLen(超過視為句子,留給 descriptions)
 *   ② UI_GENERIC_DENY 泛用英文字 denylist(Test/Recently… 在 poe.ninja 別處可能出現)。
 *   手工 ui-labels.json 優先權高於本檔(會覆蓋)。
 *
 * key 一律小寫(與 translator uiMap 慣例一致);value 為官方繁中。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { entriesFor, UI_MAXLEN, UI_GENERIC_DENY } from './relevance.mjs';

const here = process.cwd();
const dictPath = path.join(here, '..', '..', 'data', 'dict.json');

// [Ref|顯示] -> 顯示;[Ref] -> Ref(與 build-stats / build-descriptions 同規則)
const stripRefs = (s) =>
  String(s || '').replace(/\[([^\]]+)\]/g, (_, inner) => {
    const pipe = inner.indexOf('|');
    return pipe === -1 ? inner : inner.slice(pipe + 1);
  });

const norm = (s) => stripRefs(s).replace(/\s+/g, ' ').trim();
const isCJK = (s) => /[㐀-鿿豈-﫿]/.test(s);
const hasLetter = (s) => /[A-Za-z]/.test(s);

function loadTable(name) {
  try {
    const en = JSON.parse(readFileSync(path.join(here, 'tables', 'English', name + '.json'), 'utf8'));
    const tw = JSON.parse(readFileSync(path.join(here, 'tables', 'Traditional Chinese', name + '.json'), 'utf8'));
    return { en, tw };
  } catch (e) {
    console.warn('skip', name, e.message);
    return null;
  }
}

// 掃描指定欄(或所有 string 欄),把短標籤加進 map(keyLower -> zh)。
// 後加入者不覆蓋既有(先加入的來源優先);回傳新增數。
function sweepTable(map, name, columns) {
  const t = loadTable(name);
  if (!t) return 0;
  const cols = columns === '*'
    ? Object.keys(t.en[0] || {}).filter((c) => c !== '_index')
    : columns;
  let n = 0;
  const lim = Math.min(t.en.length, t.tw.length);
  for (let i = 0; i < lim; i++) {
    for (const col of cols) {
      const e = norm(t.en[i][col]);
      const z = norm(t.tw[i][col]);
      if (!e || !z || e === z) continue;
      if (!hasLetter(e) || !isCJK(z)) continue;
      if (e.length < 1 || e.length > UI_MAXLEN) continue;        // 超過 → 句子,留給 descriptions
      if (/[{}<>]/.test(e) || /[{}<>]/.test(z)) continue;        // 含佔位符/標記 → 不是純 UI 標籤
      const key = e.toLowerCase();
      if (UI_GENERIC_DENY.has(key)) continue;                    // 泛用英文字 → 不當遊戲術語替換
      if (key in map) continue;
      map[key] = z;
      n++;
    }
  }
  console.log(`${name}(掃 ${cols === '*' ? 'all' : cols.length} 欄): 新增 ${n}`);
  return n;
}

// ---- 參照對挖掘(ref-pair mining)----
// 官方文字常以 [RefId|顯示文字] 內嵌名詞,清單型內容只存在這種參照裡。
// 例:KeywordPopups 魔遺清單 EN「[LegacyOfDiamond|Legacy of Diamond]」
//                          TW「[LegacyOfDiamond|寶鑽之遺]」
// EN/TW 以 RefId 對齊(同 id 多次出現依序配對)→ 自動萃取顯示文字對照。
// 涵蓋「沒有獨立名稱表」的新內容(魔遺/關鍵字內嵌名詞…),未來新增自動跟上。
// 安全性同 uiAuto(整節點精確比對 + maxLen + deny);RefId 相同才配對,零錯位。
function collectRefs(s) {
  const out = new Map(); // refId -> [顯示文字, …](依出現順序)
  const re = /\[([^|\]]+)\|([^\]]+)\]/g;
  let m;
  while ((m = re.exec(s))) {
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push(m[2]);
  }
  return out;
}
function mineRefs(map, name, columns) {
  const t = loadTable(name);
  if (!t) return 0;
  const cols = columns === '*'
    ? Object.keys(t.en[0] || {}).filter((c) => c !== '_index')
    : columns;
  let n = 0;
  const lim = Math.min(t.en.length, t.tw.length);
  for (let i = 0; i < lim; i++) {
    for (const col of cols) {
      const e = String(t.en[i][col] || '');
      const z = String(t.tw[i][col] || '');
      if (!e.includes('|') || !z.includes('|')) continue;
      const em = collectRefs(e);
      const zm = collectRefs(z);
      for (const [id, list] of em) {
        const zl = zm.get(id);
        if (!zl) continue;
        const cnt = Math.min(list.length, zl.length);
        for (let k = 0; k < cnt; k++) {
          const ek = norm(list[k]);
          const zk = norm(zl[k]);
          if (!ek || !zk || ek === zk) continue;
          if (!hasLetter(ek) || !isCJK(zk)) continue;
          if (ek.length > UI_MAXLEN) continue;
          if (/[{}<>[\]]/.test(ek) || /[{}<>[\]]/.test(zk)) continue;
          const key = ek.toLowerCase();
          // 挖掘來源量大且未經人工確認 → 比欄位掃描更保守:
          // 短單字(hit/meta/gain/type…)在 poe.ninja 站方 UI 出現機率高,容易亂翻,不收;
          // 多字詞(legacy of diamond)與長單字(resistance)為遊戲術語,風險低。
          if (!key.includes(' ') && key.length < 6) continue;
          if (UI_GENERIC_DENY.has(key)) continue;
          if (key in map) continue;
          map[key] = zk;
          n++;
        }
      }
    }
  }
  console.log(`${name}(ref 挖掘): 新增 ${n}`);
  return n;
}

const ui = {};
const uiUnval = {};  // §12:auto-detected(unvalidated)獨立區塊
for (const { table, columns, auto } of entriesFor('ui')) sweepTable(auto ? uiUnval : ui, table, columns);
// ⚠️ ClientStrings(遊戲介面字串大表)仍不進 uiAuto:含大量泛用英文字 + 噪音,
//    整節點比對也會在 poe.ninja 亂翻。其「長句」走 build-descriptions 自動規則(安全)。
// 參照對挖掘:欄位掃描之後才跑(欄位來源為準,挖掘只補新 key);只挖人工驗證過的表。
for (const { table, columns, auto } of entriesFor('ui')) if (!auto) mineRefs(ui, table, columns);
for (const { table, columns, auto } of entriesFor('desc')) if (!auto) mineRefs(ui, table, columns);
for (const k of Object.keys(uiUnval)) if (k in ui) delete uiUnval[k]; // 不重複收已驗證 key

const dict = JSON.parse(readFileSync(dictPath, 'utf8'));
const sorted = {};
for (const k of Object.keys(ui).sort()) sorted[k] = ui[k];
dict.uiAuto = sorted;
const sortedU = {};
for (const k of Object.keys(uiUnval).sort()) sortedU[k] = uiUnval[k];
dict.uiUnvalidated = sortedU;  // MCP 查詢命中此區塊時標「新結構/未驗證」
writeFileSync(dictPath, JSON.stringify(dict, null, 2), 'utf8');
console.log(`\nuiAuto 字典:${Object.keys(sorted).length} 筆 + auto/unvalidated ${Object.keys(sortedU).length} 筆 -> dict.json (uiAuto / uiUnvalidated)`);
