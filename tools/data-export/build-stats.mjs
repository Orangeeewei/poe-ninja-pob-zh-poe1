/**
 * build-stats.mjs — 從遊戲的 .csd 檔產生「英文→繁中」詞綴模板表
 *
 * 來源:data/statdescriptions/*.csd（UTF-16，含所有語言，{N} 佔位符）
 * 產出:data/stat-templates.json
 *   { templates: { <bucketKey>: [ { en, zh } ] }, count }
 *   - en/zh：refs 已還原成顯示文字、佔位符保留為 {N}
 *   - bucketKey：把 en 的數字與 {N} 都換成 {} → 供執行期快速分桶
 *
 * 用法:node build-stats.mjs        （需先有 .cache，或會自動下載）
 */
import * as loaders from './node_modules/pathofexile-dat/dist/cli/bundle-loaders.js';
import { readIndexBundle } from './node_modules/pathofexile-dat/dist/bundles/index-bundle.js';
import { getDirContent } from './node_modules/pathofexile-dat/dist/bundles/index-paths.js';
import { decompressSliceInBundle, decompressedBundleSize } from './node_modules/pathofexile-dat/dist/bundles/bundle.js';
import path from 'node:path';
import fs from 'node:fs/promises';

const PATCH = process.env.PATCH || process.env.POE2_PATCH || '3.28.0.16';   // PoE1 fallback
const OUT = path.join(process.cwd(), '..', '..', 'data', 'stat-templates.json');
// PoE1:詞綴描述在 metadata/statdescriptions/*.txt(UTF-16LE,格式與 PoE2 .csd 相容)。
// (PoE2 是 data/statdescriptions/*.csd)
const STAT_DIR = 'metadata/statdescriptions';
const STAT_EXT = '.txt';

const LANG = 'Traditional Chinese';

// 自動遞迴列出 data/statdescriptions 底下所有 .csd（含子目錄）→ 改版自動涵蓋新增/移除
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
const NUM = '[+-]?\\d+(?:[.,]\\d+)*';

// [Ref|顯示] -> 顯示；[Ref] -> Ref
function stripRefs(s) {
  return s.replace(/\[([^\]]+)\]/g, (_, inner) => {
    const pipe = inner.indexOf('|');
    return pipe === -1 ? inner : inner.slice(pipe + 1);
  });
}
// {0}, {0:+d}, {0:d} -> {0}
const normPlaceholders = (s) => s.replace(/\{(\d+)(?::[^}]*)?\}/g, '{$1}');
// en/zh 清理:還原 refs + 正規化佔位符
const clean = (s) => normPlaceholders(stripRefs(s)).trim();
// bucketKey:數字與 {N} 都換成 {}
const bucketize = (enClean) =>
  enClean.replace(/\{\d+\}/g, '{}').replace(new RegExp(NUM, 'g'), '{}');

// 解析一行 "<conditions> "<template>" <handlers>" → template（取首尾引號間）
function extractTemplate(line) {
  const first = line.indexOf('"');
  const last = line.lastIndexOf('"');
  if (first === -1 || last <= first) return null;
  return line.slice(first + 1, last);
}

// handler 尾段(如 "specific_skill 2")→ 文字佔位符的 {N} 索引陣列。
// specific_skill K 表示「第 K 個值是技能名(文字)」,對應佔位符 {K-1}。
function detectTextIdx(tail) {
  const idx = [];
  const re = /\b(?:specific_skill|display_indexable_support)\s+(\d+)/g;
  let m;
  while ((m = re.exec(tail || ''))) idx.push(Number(m[1]) - 1);
  return idx;
}

const isBroken = (s) => /#?ERROR!?/i.test(s) || /^＃?ERROR/i.test(s);

function parseCsd(text, acc, textAcc) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  const n = lines.length;
  const readVariant = () => {
    // 目前行應為數量 M
    const m = parseInt(lines[i].trim(), 10);
    i++;
    const out = [];
    for (let k = 0; k < m && i < n; k++, i++) {
      const line = lines[i];
      const t = extractTemplate(line);
      // tail = 最後一個引號之後的 handler(如 "specific_skill 2"),用來判斷文字佔位符
      const last = line.lastIndexOf('"');
      const tail = last === -1 ? '' : line.slice(last + 1).trim();
      out.push({ tpl: t == null ? '' : t, tail });
    }
    return out;
  };

  // 加入一條 en↔zh 模板(已 clean)。textIdx 非空 → 進文字佔位符表;否則進數字桶。
  const addPair = (enC, zhC, textIdx) => {
    if (!enC || !zhC) return;
    if (isBroken(zhC)) return; // 來源損壞且無變體可頂替 → 丟棄,不呈現 #ERROR! 給使用者
    if (!/\{\d+\}/.test(enC) && enC === zhC) return; // 沒佔位符又完全相同→沒翻
    // zh 參照了 en 沒有的佔位符 → 執行期無值可填,會殘留「{0}」字樣
    // (GGG 部分昇華:英文寫死數字、中文用 {N},兩者不一致)→ 丟棄,寧可保留英文。
    const enPh = new Set(enC.match(/\{\d+\}/g) || []);
    for (const ph of zhC.match(/\{\d+\}/g) || []) if (!enPh.has(ph)) return;
    if (textIdx && textIdx.length) {
      if (!textAcc.some((e) => e.en === enC)) textAcc.push({ en: enC, zh: zhC, text: textIdx });
      return;
    }
    const key = bucketize(enC);
    if (!acc.has(key)) acc.set(key, []);
    const arr = acc.get(key);
    if (!arr.some((e) => e.en === enC)) arr.push({ en: enC, zh: zhC });
  };

  while (i < n) {
    if (lines[i].trim() !== 'description') { i++; continue; }
    i++; // skip 'description'
    if (i >= n) break;
    // id 行: "<count> id1 id2 ..."（我們不需要 id，跳過即可）
    i++;
    if (i >= n) break;
    // 英文(預設)變體
    const en = readVariant();
    // 各語言變體
    let zh = null;
    while (i < n && /^\s*lang\s+"/.test(lines[i])) {
      const langName = lines[i].match(/^\s*lang\s+"([^"]+)"/)[1];
      i++;
      const variant = readVariant();
      if (langName === LANG) zh = variant;
    }
    if (!zh) continue;

    // GGG 官方資料偶有某變體(常為正數版 "+{0}…")被寫成 "#ERROR!"。
    // 但同 description 的另一變體(負數版 "{0}…")是好的,且其 en 開頭無字面符號、
    // {0} 的 STAT_NUM 含 [+-]? → 能同時匹配 +2 / -2 並保留正確符號。
    // 故策略:壞變體直接丟棄(addPair 內 isBroken 會擋),讓好兄弟變體涵蓋正負號。
    const pairs = [];
    for (let k = 0; k < en.length && k < zh.length; k++) {
      pairs.push({ enC: clean(en[k].tpl), zhC: clean(zh[k].tpl), textIdx: detectTextIdx(en[k].tail) });
    }

    // 整段 en/zh 的佔位符集合是否一致。不一致 = 兩者結構錯位(GGG 來源把某語言的某變體
    // 內容填錯格,實例:owl_feather_max_bonus_to_stack 的繁中 variant1 被填成 variant2 文字)
    // → 整段不可信,尤其「不可逐行拆」(拆出來會把英文句配到完全無關的中文句而成垃圾模板,
    //   例:Expend an Owl Feather…Primal Bounty ↔ 原始賞金100%更多強化效果)。
    const phSet = (s) => new Set(s.match(/\{\d+\}/g) || []);
    const phEqual = (a, b) => {
      const A = phSet(a), B = phSet(b);
      if (A.size !== B.size) return false;
      for (const x of A) if (!B.has(x)) return false;
      return true;
    };

    for (const p of pairs) {
      addPair(p.enC, p.zhC, p.textIdx);
      // 多行描述(基石等以字面 \n 串多句)→ 額外拆成單行子模板,
      // 讓 poe.ninja 上各自獨立成行的句子也能單獨命中。
      // 註:.csd 內換行是字面 "\n"(反斜線+n 兩字元),非真換行。
      // 僅在整段佔位符一致(EN/繁中對得上)時才拆,避免拆出錯位垃圾配對。
      const NL = /\\n|\n/;
      if (NL.test(p.enC) && NL.test(p.zhC) && phEqual(p.enC, p.zhC)) {
        const es = p.enC.split(NL);
        const zs = p.zhC.split(NL);
        if (es.length === zs.length) {
          for (let j = 0; j < es.length; j++) addPair(es[j].trim(), zs[j].trim(), []);
        }
        // 「換行→空白」整段版本:poe.ninja 有時把多行詞綴連成單一行容器顯示
        // (例:昇華「25% more Skill Speed … you have a One-Handed Martial Weapon …」)。
        const joinNL = (s) => s.replace(/\\n|\n/g, ' ').replace(/\s+/g, ' ').trim();
        addPair(joinNL(p.enC), joinNL(p.zhC), p.textIdx);
      }
    }
  }
}

async function main() {
  const cdn = await loaders.CdnBundleLoader.create(path.join(process.cwd(), '.cache'), PATCH);
  const loader = await loaders.FileLoader.create(cdn);
  const files = await listCsdFiles(cdn);
  console.log(`自動探索到 ${files.length} 個 .csd`);
  const acc = new Map();
  const textAcc = []; // 含文字佔位符(技能名等)的模板
  for (const f of files) {
    const data = await loader.tryGetFileContents(f);
    if (!data) { console.warn('skip (missing):', f); continue; }
    const text = Buffer.from(data).toString('utf16le');
    const before = acc.size;
    parseCsd(text, acc, textAcc);
    const added = acc.size - before;
    if (added) console.log(`${f.replace(STAT_DIR + '/', '')}: +${added}`);
  }

  // 精選 ClientStrings 帶佔位符的藥劑/護符文字(回復/消耗/持續)→ 當成詞綴模板。
  // 這些不在 stat_descriptions,但 poe.ninja 藥劑/護符會顯示;ClientStrings 已含
  // 單數/複數兩型(Second/Seconds、Charge/Charges),故自動解決單複數對不上的問題。
  // 數值在 poe.ninja 多為範圍 (920-1104),由執行期 range-aware STAT_NUM 處理。
  const CS_TPL = [
    /^Recovers \{0\} (?:Life|Mana|Energy Shield) (?:over|every) \{1\} Seconds?$/,
    /^Consumes \{0\} of \{1\} Charges? on use$/,
    /^Currently has \{0\}(?: of \{1\})? Charges?$/,
    /^Lasts \{0\} Seconds?$/,
    /^Grants \{0\} Charges? on use$/,
  ];
  try {
    const csEn = JSON.parse(await fs.readFile(path.join(process.cwd(), 'tables', 'English', 'ClientStrings.json'), 'utf8'));
    const csTw = JSON.parse(await fs.readFile(path.join(process.cwd(), 'tables', 'Traditional Chinese', 'ClientStrings.json'), 'utf8'));
    let n = 0;
    for (let i = 0; i < csEn.length && i < csTw.length; i++) {
      const enRaw = normPlaceholders(String(csEn[i].Text || '').trim());
      if (!CS_TPL.some((re) => re.test(enRaw))) continue;
      const enC = clean(csEn[i].Text);
      const zhC = clean(csTw[i].Text);
      if (!enC || !zhC || isBroken(zhC)) continue;
      const enPh = new Set(enC.match(/\{\d+\}/g) || []);
      let ok = true;
      for (const ph of zhC.match(/\{\d+\}/g) || []) if (!enPh.has(ph)) ok = false;
      if (!ok) continue;
      const key = bucketize(enC);
      if (!acc.has(key)) acc.set(key, []);
      const arr = acc.get(key);
      if (!arr.some((e) => e.en === enC)) { arr.push({ en: enC, zh: zhC }); n++; }
    }
    console.log(`ClientStrings(藥劑/護符模板): +${n}`);

    // 珠寶巢狀詞綴(範圍內賦予/天賦配置):{0} 是「內層詞綴」或「天賦名」(文字佔位符),
    // 官方來源在 ClientStrings(ModStatJewelAddToNotable/Small)。依 Id 動態抓 → 進 textAcc,
    // 執行期把 {0} 遞迴翻譯(內層詞綴)或查 nameMap(天賦名)。
    const JEWEL_NESTED_IDS = new Set(['ModStatJewelAddToNotable', 'ModStatJewelAddToSmall']);
    let jn = 0;
    for (let i = 0; i < csEn.length && i < csTw.length; i++) {
      if (!JEWEL_NESTED_IDS.has(String(csEn[i].Id || ''))) continue;
      const enC = clean(csEn[i].Text);
      const zhC = clean(csTw[i].Text);
      if (!enC || !zhC || isBroken(zhC)) continue;
      if (!textAcc.some((t) => t.en === enC)) { textAcc.push({ en: enC, zh: zhC, text: [0] }); jn++; }
    }
    console.log(`ClientStrings(珠寶巢狀詞綴): +${jn}`);
  } catch (e) {
    console.warn('skip ClientStrings templates', e.message);
  }

  // 補充文字佔位符模板:.csd 內 {0} 是 passive_hash(天賦名),detectTextIdx 抓不到該 handler
  // → 自動管線漏掉。以下官方文字(遊戲/poe.ninja 顯示繁中,可在 poe2db 驗證)補進文字佔位符表。
  // From Nothing(從無到有)「of {Notable}」變體目前無 .dat 表來源,故在此補。
  const SUPPLEMENT_TEXT_TEMPLATES = [
    { en: 'Passives in Radius of {0} can be Allocated without being connected to your tree',
      zh: '範圍{0}內的天賦可以在沒有連結你的天賦樹下被配置', text: [0] },
  ];
  for (const t of SUPPLEMENT_TEXT_TEMPLATES) {
    if (!textAcc.some((e) => e.en === t.en)) textAcc.push(t);
  }

  // 天賦名佔位符模板:某些 stat 的 {0} 是「天賦/基石名」(文字),而非數字。
  // .csd 的 handler 不是 specific_skill/display_indexable_support → detectTextIdx 抓不到,
  // 故被分到數字桶,bucketKey 變成 "Allocates {}",但實例「Allocates Mind Eraser」沒有數字
  // 可正規化 → 永遠對不上。這裡把這些「官方模板」從數字桶提升為文字佔位符模板,
  // 讓執行期把佔位符當天賦名,再用 nameMap 翻成中文(妄想症/禁忌血肉烈焰/從無到有 等珠寶)。
  const PASSIVE_NAME_TEMPLATES = new Set([
    'Allocates {0}',
    'Allocates {0} if you have the matching modifier on Forbidden Flesh',
    'Allocates {0} if you have the matching modifier on Forbidden Flame',
  ]);
  for (const [key, arr] of acc) {
    for (const e of arr) {
      if (PASSIVE_NAME_TEMPLATES.has(e.en) && !textAcc.some((t) => t.en === e.en)) {
        textAcc.push({ en: e.en, zh: e.zh, text: [0] });
      }
    }
  }

  const templates = {};
  let lines = 0;
  for (const [k, v] of acc) { templates[k] = v; lines += v.length; }
  await fs.writeFile(
    OUT,
    JSON.stringify({ _source: 'PoE2 stat_descriptions .csd', count: lines, templates, textTemplates: textAcc }),
    'utf8'
  );
  console.log(`\n完成:${acc.size} buckets / ${lines} 模板 + ${textAcc.length} 文字佔位符模板 -> ${OUT}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
