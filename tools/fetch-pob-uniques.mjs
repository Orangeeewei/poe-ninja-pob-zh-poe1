/**
 * fetch-pob-uniques.mjs — 下載並解析 PoB 的傳奇資料到 ../gamedata/uniques.json
 *
 * 為什麼要這支(plan §4/§14):RePoE 的 mods.json 把傳奇詞綴拆成無名的獨立 mod
 * (domain 非 item),沒有「傳奇名 → 完整詞綴組 + implicit + 底材」對應。所以查傳奇
 * (例 Obliteration/抹滅)用 search_mods 只能命中零散單條,既不完整又耗 token。
 *
 * 解法:抓 PathOfBuildingCommunity/PathOfBuilding 的 src/Data/Uniques/*.lua
 * (純資料檔,不需跑 PoB runtime)。這些 .lua 用 `[[ ... ]]` 長字串一款一個傳奇,
 * 我們解析出「當前版本(Current variant)」的底材 / implicit / 完整 explicit。
 * 中文化不在此做:uniques.json 只存英文原文,交給 poe-mcp 的 lib-uniques.mjs 在查詢時
 * 用 dict.names(名稱)+ stat-templates(詞綴)轉繁中(與 mods.json 一樣「資料存英、查時翻」)。
 *
 * ⚠️ 跳過的檔:
 *   - 無 `[[` 的表格式檔(graft/BoundByDestiny/WatchersEye/…):非長字串格式,無法用此解析器。
 *   - Special/Generated.lua:自動生成的變體/附魔傳奇(Precursor's Emblem、Sublime Vision、
 *     Impossible Escape、Watcher's Eye 詞池…),格式非標準 `]],[[` 串接、會解析破碎 → 略過。
 *     這些屬「選變體/挑詞」的特殊傳奇,要收需另寫專屬解析(未做,見 PoE1-改造記錄.md)。
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'gamedata');
const REPO = 'PathOfBuildingCommunity/PathOfBuilding';
const API = `https://api.github.com/repos/${REPO}/contents/src/Data/Uniques`;
const RAW = `https://raw.githubusercontent.com/${REPO}/master/src/Data/Uniques/`;
const H = { 'User-Agent': 'poe1-mcp uniques fetch', Accept: 'application/vnd.github+json' };

// ---- PoB Uniques Lua 解析器 ----
// 每款傳奇 = 一個 `[[ ... ]]` 區塊。行結構:
//   Name
//   <底材>(1+ 行;多底材皆 {variant:N} 前綴)
//   <meta: Variant:/League:/Source:/Requires/Implicits: N …>
//   <implicit 詞綴 × Implicits:N 行> <explicit 詞綴…>
// 詞綴行可有前置標籤 {variant:1,2}{tags:..}{crafted}…;數值範圍寫 (min-max)。
// 我們取「Current」那個 variant:底材與詞綴只保留「無 variant 前綴」或「前綴含 currentIdx」者。
const META_RE = /^(Variant:|Selected Variant:|Alt Variant:|Alt Variant Two:|Alt Variant Three:|Alt Variant Four:|Alt Variant Five:|Selected Alt Variant|Implicits:|League:|Source:|Upgrade:|Requires |Has Alt Variant|Radius:|Limited to:|LevelReq:)/;
// 物品屬性行(非 meta 也非詞綴):曾因這些行打斷 meta 掃描,害 91 款傳奇把 Variant:/Source:/
// Implicits: 洩漏進詞綴陣列(Blightwell 的 Talisman Tier、Impresence 的 Elder Item…)。
const PROP_RE = /^(Talisman Tier:|Elder Item$|Shaper Item$|Hunter Item$|Warlord Item$|Crusader Item$|Redeemer Item$|Searing Exarch Item$|Eater of Worlds Item$|Sockets:|Quality:|Cannot be traded or modified$|Unmodifiable$)/;
const stripTags = (s) => s.replace(/^(\{[^}]*\})+/, '').trim();
const variantSet = (s) => { const m = s.match(/\{variant:([0-9,]+)\}/); return m ? m[1].split(',').map(Number) : null; };

export function parseBlock(raw) {
  const lines = raw.split('\n').map((l) => l.replace(/\r$/, '').trim()).filter(Boolean);
  if (!lines.length) return null;
  const name = stripTags(lines[0]);
  if (!name) return null;

  // 1) 底材候選:name 之後、第一個 meta 行之前的連續行(第一個底材後,只有 {variant:} 前綴才是額外底材)
  let idx = 1;
  const baseCands = [];
  while (idx < lines.length) {
    const ln = lines[idx];
    if (META_RE.test(stripTags(ln))) break;
    if (baseCands.length && !ln.startsWith('{variant:')) break;
    baseCands.push(ln); idx++;
  }

  // 2) meta 區(Variant 名序、League、Source、Requires、Implicits 行數)。
  //    META 與 PROP(物品屬性)行都消化;Implicits: 之後進詞綴區。
  const variantNames = [];
  let league = null, source = null, requires = null, implicitCount = 0, sawImplicits = false, corrupted = false;
  const eatMeta = (ln) => {
    if (ln.startsWith('Variant:')) variantNames.push(ln.slice(8).trim());
    else if (ln.startsWith('League:')) league = ln.slice(7).trim();
    else if (ln.startsWith('Source:')) source = (source ? source + ' ' : '') + ln.slice(7).trim();
    else if (ln.startsWith('Requires ')) requires = ln.trim();
    else if (ln.startsWith('Implicits:')) { implicitCount = parseInt(ln.slice(10).trim(), 10) || 0; sawImplicits = true; }
  };
  while (idx < lines.length) {
    const ln = stripTags(lines[idx]);
    if (/^Corrupted$/i.test(ln)) { corrupted = true; idx++; continue; }
    if (PROP_RE.test(ln)) { idx++; continue; }
    if (!META_RE.test(ln)) break;
    eatMeta(ln);
    idx++;
    if (sawImplicits) break;
  }
  // ★ 防洩漏第二道:即使有未知行提早打斷上面掃描,詞綴區內殘留的 meta/prop 行也要
  //   撿回(而不是當成詞綴輸出)。曾害 91 款傳奇把 "Implicits: 1"/"Variant: Fire"/
  //   "Source: …" 直接顯示成詞綴,且 variant 過濾整組失效。
  const restLines = [];
  for (const rawLn of lines.slice(idx)) {
    const ln = stripTags(rawLn);
    if (/^Corrupted$/i.test(ln)) { corrupted = true; continue; }
    if (PROP_RE.test(ln)) continue;
    if (META_RE.test(ln)) { eatMeta(ln); continue; }
    restLines.push(rawLn);
  }

  // 3) 判定 variant 模式(這是「取哪些詞綴」的關鍵):
  //   - current:有名為 "Current" 的變體 → 只取該變體(歷史 Pre x.x.x 丟棄)。多數裝備屬此。
  //   - last   :無 Current,但變體名都是版本號式(Pre x.x.x / 3.10 / 純數字)→ 依時序取最後一個。
  //   - all    :無 Current,變體名是「描述性標籤」(如神殿/光環名,或 Voices 的
  //             "Adds 7 Small Passive Skills")→ 「掉落時隨機其一」,保留全部變體詞綴。
  //   ⚠️ 版本號判別不可用「含任何數字」:Voices 的描述性變體名含 7/5/3/1,曾被誤判成
  //      版本號式而只留最後一種 → 改成「Pre 開頭 / x.y 版號 / 純數字」才算版本號。
  let currentIdx = null, mode = null, pickOne = false;
  if (variantNames.length) {
    const ci = variantNames.findIndex((v) => /current/i.test(v));
    if (ci >= 0) { currentIdx = ci + 1; mode = 'current'; }
    else if (variantNames.every((v) => /^pre\b/i.test(v) || /\d+\.\d+/.test(v) || /^\d+$/.test(v))) { currentIdx = variantNames.length; mode = 'last'; }
    else { mode = 'all'; pickOne = true; }
  }
  const applies = (ln) => {
    if (mode === 'all') return true;                 // 挑一種型:全部變體詞綴都收(下方去重)
    const vs = variantSet(ln);
    return !vs || (currentIdx != null && vs.includes(currentIdx));
  };

  // 4) 選底材:符合條件 → 無前綴 → 第一個候選
  const base = stripTags(baseCands.find(applies) || baseCands.find((b) => !variantSet(b)) || baseCands[0] || '') || null;

  // 5) 詞綴:剩餘行前 implicitCount 行 = implicit,其餘 = explicit;各自依 variant 過濾、去標籤、去重
  const dedupe = (arr) => { const seen = new Set(); return arr.filter((t) => (t && !seen.has(t)) && seen.add(t)); };
  const implicitLines = sawImplicits ? restLines.slice(0, implicitCount) : [];
  const explicitLines = sawImplicits ? restLines.slice(implicitCount) : restLines;
  const implicits = dedupe(implicitLines.filter(applies).map(stripTags).filter(Boolean));
  const explicits = dedupe(explicitLines.filter(applies).map(stripTags).filter(Boolean));

  return {
    name, base, league, source, requires, implicits, explicits, pickOne, corrupted,
    variant: mode === 'all' ? null : (variantNames.length ? variantNames[currentIdx - 1] : null),
    variantCount: variantNames.length,
  };
}

export function parseFile(text) {
  const out = [];
  const re = /\[\[([\s\S]*?)\]\]/g;
  let m;
  while ((m = re.exec(text))) { const p = parseBlock(m[1]); if (p) out.push(p); }
  return out;
}

// 底材看起來不像底材(空/含數字或%/太長/含冒號)→ 判為解析碎片,丟棄。
const badBase = (b) => !b || /[%\d]/.test(b) || b.length > 50 || b.includes(':');

// ---- Special 檔解析(2026-07-21)----
// (A) 詞池表(WatchersEye.lua / Special/BoundByDestiny.lua):
//     ["Key"] = { (type="..",)? affix = "", "詞綴文字", ... } 的靜態 keyed table → 可完整收詞池。
export function parsePoolFile(text) {
  const out = [];
  // 一個 mod 可以是多行(如 Sublime Vision 的 3 行一組)→ 抓 affix 後「連續的字串字面值」
  // 全部行,join 成一條;去重也以整組為準(各組首行常相同,不能只看第一行)。
  const re = /\["([^"]+)"\]\s*=\s*\{\s*(?:type\s*=\s*"[^"]*",\s*)?affix\s*=\s*"[^"]*",\s*((?:"(?:[^"\\]|\\.)*",?\s*)+)/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(text))) {
    const key = m[1];
    const lines = [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].replace(/\\"/g, '"').trim()).filter(Boolean);
    const joined = lines.join('\n');
    if (!joined || seen.has(joined)) continue;
    seen.add(joined);
    out.push({ key, line: joined });
  }
  return out;
}

// (B) Special/Generated.lua:程式生成傳奇(隱匿詞/天賦/寶石池視變體而定)。
//     完整詞池要跑 PoB runtime 拿不到,但「名稱/底材/聯盟/來源」是靜態 [[..]] 或 "字串列" 標頭
//     → 至少收成可查的 stub(標 generated),不再「找不到」。
export function parseGeneratedHeaders(text) {
  const inserted = new Set();
  for (const m of text.matchAll(/table\.insert\(data\.uniques\.generated,\s*table\.concat\((\w+)/g)) inserted.add(m[1]);
  const items = [];
  // [[..]] 長字串標頭
  for (const m of text.matchAll(/local\s+(\w+)\s*=\s*\{\s*\[\[([\s\S]*?)\]\]/g)) {
    if (inserted.has(m[1])) items.push({ var: m[1], header: m[2] });
  }
  // "行","行" 字串列標頭(取 table 開頭連續的字串字面值)
  for (const m of text.matchAll(/local\s+(\w+)\s*=\s*\{\s*((?:"(?:[^"\\]|\\.)*",\s*)+)/g)) {
    if (!inserted.has(m[1]) || items.some((i) => i.var === m[1])) continue;
    const lines = [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].replace(/\\"/g, '"'));
    items.push({ var: m[1], header: lines.join('\n') });
  }
  return items;
}

// 列出 Uniques/(含 Special/)所有 .lua
async function listLua(path = '') {
  const res = await fetch(`${API}${path}`, { headers: H });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path || '/'}`);
  const j = await res.json();
  const files = [], dirs = [];
  for (const e of j) {
    if (e.type === 'dir') dirs.push(e.name);
    else if (e.name.endsWith('.lua')) files.push((path ? path.slice(1) + '/' : '') + e.name);
  }
  for (const d of dirs) files.push(...await listLua(`${path}/${d}`));
  return files;
}

// ---- 主流程 ----
if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === process.argv[1]) {
  await mkdir(OUT, { recursive: true });
  const files = await listLua('');
  const byName = {};
  const summary = [];
  let dropped = 0;
  const specialTexts = {}; // Generated.lua / 詞池表原文,主迴圈後另行解析
  for (const f of files) {
    const t = await (await fetch(RAW + f, { headers: { 'User-Agent': H['User-Agent'] } })).text();
    if (basename(f) === 'Generated.lua') { specialTexts.generated = t; summary.push(`◆ ${f}(程式生成 → 收 stub+詞池)`); continue; }
    if (!t.includes('[[')) { specialTexts[basename(f)] = t; summary.push(`◆ ${f}(詞池表 → 併入對應傳奇)`); continue; }
    let kept = 0;
    for (const u of parseFile(t)) {
      if (badBase(u.base)) { dropped++; continue; }
      const k = u.name.toLowerCase();
      // 同名(跨檔/重複)取 explicit 較多者(較完整)
      if (!byName[k] || u.explicits.length > byName[k].explicits.length) byName[k] = compact(u);
      kept++;
    }
    summary.push(`✓ ${f}  (${kept})`);
  }

  // ---- Special:Generated.lua 標頭 stub + 靜態詞池(Watcher's Eye / Sublime Vision / Bound by Destiny)----
  if (specialTexts.generated) {
    const pools = {
      watchers: specialTexts['WatchersEye.lua'] ? parsePoolFile(specialTexts['WatchersEye.lua']) : [],
      bound: specialTexts['BoundByDestiny.lua'] ? parsePoolFile(specialTexts['BoundByDestiny.lua']) : [],
    };
    const NOTE_POOL = {
      watcherseye: {
        implicits: ['(4-6)% increased maximum Energy Shield', '(4-6)% increased maximum Life', '(4-6)% increased maximum Mana'],
        explicits: () => pools.watchers.filter((p) => !/^(SublimeVision|SummonArbalist)/.test(p.key)).map((p) => p.line),
        pickNote: '掉落時從以下光環詞池隨機 2 條(Uber Elder 版 3 條)',
      },
      sublimevision: {
        explicits: () => pools.watchers.filter((p) => /^SublimeVision/.test(p.key)).map((p) => p.line),
        pickNote: '掉落時從以下詞池隨機 1 條(對應單一光環,裝備後該光環無法對他人生效)',
      },
      boundbydestiny: {
        explicits: () => pools.bound.map((p) => p.line),
        pickNote: '掉落時從以下詞池隨機(同裝備條件型選項池)',
      },
    };
    let gkept = 0;
    for (const { header } of parseGeneratedHeaders(specialTexts.generated)) {
      const u = parseBlock(header);
      if (!u || badBase(u.base)) continue;
      const k = u.name.toLowerCase();
      const pool = NOTE_POOL[k.replace(/[^a-z]/g, '')];
      if (pool) {
        if (pool.implicits) u.implicits = pool.implicits;
        u.explicits = pool.explicits();
        u.pickNote = pool.pickNote;
        u.pickOne = false; // 用 pickNote 精確描述,不套「隨機其一」語意
      } else {
        u.generated = true; // 純 stub:詞綴為程式生成(隱匿詞/天賦/寶石池),僅收基本資訊
        u.explicits = [];
        u.implicits = [];
      }
      if (!byName[k] || (u.explicits.length >= (byName[k].explicits || []).length)) { byName[k] = compact(u); gkept++; }
    }
    summary.push(`✓ Special/Generated.lua 標頭 → 收 ${gkept} 款(Watcher's Eye/Sublime Vision/Bound by Destiny 含完整詞池,其餘 stub)`);
  }
  const count = Object.keys(byName).length;
  await writeFile(join(OUT, 'uniques.json'), JSON.stringify(byName), 'utf8');
  console.log('PoB uniques → ' + join(OUT, 'uniques.json'));
  console.log(summary.join('\n'));
  console.log(`\n共 ${count} 款傳奇(丟棄解析碎片 ${dropped} 筆)。`);
}

// 省 token:null/空欄不落地
function compact(u) {
  const o = { name: u.name, base: u.base };
  if (u.variant) o.variant = u.variant;
  if (u.variantCount) o.variantCount = u.variantCount;
  if (u.league) o.league = u.league;
  if (u.source) o.source = u.source;
  if (u.requires) o.requires = u.requires;
  if (u.pickOne) o.pickOne = true;   // 掉落時隨機其一(explicits 為所有可能選項)
  if (u.corrupted) o.corrupted = true; // 此傳奇必定汙損(如塔莉斯曼/汙損專屬)
  if (u.pickNote) o.pickNote = u.pickNote;   // 選項池型的精確說明(Watcher's Eye 等)
  if (u.generated) o.generated = true;       // 程式生成 stub(隱匿詞/天賦/寶石池,詞綴查 PoB)
  o.implicits = u.implicits;
  o.explicits = u.explicits;
  return o;
}
