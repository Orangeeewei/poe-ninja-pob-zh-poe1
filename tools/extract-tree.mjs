// extract-tree.mjs — 從本機 PoB 的 TreeData 抽出天賦樹 → gamedata/tree*.json。
//   PoE1:最新版一檔 tree.json(沿用舊行為)。
//   PoE2:每個樹版本各一檔 tree-poe2-<ver>.json —— PoE2 還在改版期,0_1~0_5 之間節點會改名
//        也會新增,而編號區間重疊,拿新版硬對舊 build 會列出不相干的天賦 → 依 build 自己的
//        treeVersion 取對應那一份才不會說錯。
//   PoE2 順便併中文:PoeCharm2 的 zh-rTW 字典(節點名 tree_dn.csv、詞綴 tree_sd.csv,
//        帶數字的詞綴再走 statDescriptions.csv 的 {0} 模板)。字典不在就只出英文,不算失敗。
// 用 poe-mcp/pob-bridge 的 luajit 跑 dump-tree.lua(tree.lua 是幾 MB 的 lua 表,luajit 解析最穩)。
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const arg = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || `=${dflt}`).split('=').pop();
const want = arg('game', 'both');   // poe1 | poe2 | both

// luajit:env 優先,否則找兄弟資料夾 poe-mcp/pob-bridge
const LUAJIT = process.env.POE_LUAJIT
  || join(dirname(repo), 'poe-mcp', 'pob-bridge', 'luajit.exe');
const DUMPER = join(repo, 'tools', 'dump-tree.lua');
const OUT_DIR = join(repo, 'gamedata');

const POB = {
  poe1: process.env.POB_DIR
    || 'C:\\Users\\User\\Desktop\\PoeCharm2-20251103\\Path of Building Community',
  poe2: process.env.POB2_DIR
    || 'C:\\Users\\User\\Desktop\\PoeCharm2-20251103\\Path of Building Community (PoE2)',
};
// PoE2 中文字典(PoeCharm2 的 zh-rTW 資料夾);沒有就跳過中文
const ZH_DIR = process.env.POE2_ZH_DIR
  || 'C:\\Users\\User\\Desktop\\PoeCharm2-20251103\\Data\\Translate\\zh-rTW';

if (!existsSync(LUAJIT)) { console.error(`找不到 luajit:${LUAJIT}(設 POE_LUAJIT)`); process.exit(1); }
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const cmpVer = (a, b) => { const [a1, a2] = a.split('_').map(Number), [b1, b2] = b.split('_').map(Number); return a1 - b1 || a2 - b2; };

// TreeData 下 /^\d+_\d+$/ 的版本(排除 ruthless / alternate 這種變體資料夾)
function versionsOf(pobDir) {
  const td = join(pobDir, 'TreeData');
  if (!existsSync(td)) return { td, vers: [] };
  return { td, vers: readdirSync(td).filter((d) => /^\d+_\d+$/.test(d)).sort(cmpVer) };
}

function dumpTree(treeLua) {
  const json = execFileSync(LUAJIT, [DUMPER, treeLua], { maxBuffer: 64 * 1024 * 1024, windowsHide: true }).toString();
  return JSON.parse(json);   // 順便驗證是合法 JSON
}

const tally = (nodes) => {
  const v = Object.values(nodes);
  return `${v.length} 節點(keystone ${v.filter((x) => x.t === 'k').length} / notable ${v.filter((x) => x.t === 'n').length} / mastery ${v.filter((x) => x.t === 'm').length})`;
};

// —— CSV(RFC4180):這幾份字典引號風格不一致,逐字元解最保險 ——
const QUOTE = String.fromCharCode(34);
function parseCsv(text) {
  const rows = []; let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c !== QUOTE) { field += c; }
      else if (text[i + 1] === QUOTE) { field += QUOTE; i++; }
      else inQ = false;
    } else if (c === QUOTE) inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const csvMap = (file) => {
  const m = new Map();
  if (!existsSync(file)) return m;
  for (const r of parseCsv(readFileSync(file, 'utf8'))) {
    const k = (r[0] || '').trim(), v = (r[1] || '').trim();
    if (k && v && k !== v) m.set(k, v);
  }
  return m;
};

function loadZh() {
  if (!existsSync(ZH_DIR)) return null;
  const dn = csvMap(join(ZH_DIR, 'tree_dn.csv'));            // 節點名
  const sd = csvMap(join(ZH_DIR, 'tree_sd.csv'));            // 詞綴(字面)
  const st = csvMap(join(ZH_DIR, 'statDescriptions.csv'));   // 詞綴({0} 數字模板)
  if (!dn.size && !sd.size) return null;
  const NUM = /[+-]?\d+(?:\.\d+)?%?/g;
  // 帶數字的詞綴:數字抽成 {0}/{1} 查模板,再把原數字填回譯文
  const stat = (s) => {
    if (sd.has(s)) return sd.get(s);
    const nums = []; let i = 0;
    const key = s.replace(NUM, (m) => { nums.push(m); return `{${i++}}`; });
    const z = st.get(key);
    return z ? z.replace(/\{(\d+)\}/g, (_, k) => nums[+k] ?? `{${k}}`) : null;
  };
  return { name: (n) => dn.get(n) || null, stat, size: dn.size + sd.size + st.size };
}

// 把中文塞進節點:z = 中文名、sz = 中文詞綴(整組都翻得出來才放,免得中英混雜看了更亂)
function applyZh(nodes, zh) {
  let hitName = 0, hitStat = 0, totStat = 0;
  for (const nd of Object.values(nodes)) {
    const z = zh.name(nd.n);
    if (z) { nd.z = z; hitName++; }
    if (nd.s?.length) {
      totStat += nd.s.length;
      const tr = nd.s.map(zh.stat);
      const got = tr.filter(Boolean).length;
      hitStat += got;
      if (got === tr.length) nd.sz = tr;
    }
  }
  return { hitName, hitStat, totStat };
}

// ═══ PoE1:最新版一檔 ═══
function doPoe1() {
  const { td, vers } = versionsOf(POB.poe1);
  if (!vers.length) { console.error(`PoE1:找不到版本資料夾(${td});設 POB_DIR`); return false; }
  const latest = vers.at(-1);
  const treeLua = join(td, latest, 'tree.lua');
  if (!existsSync(treeLua)) { console.error(`PoE1:缺 ${treeLua}`); return false; }
  console.log(`抽取 PoE1 天賦樹:${latest}`);
  const parsed = dumpTree(treeLua);
  parsed.version = latest;
  const out = join(OUT_DIR, 'tree.json');
  writeFileSync(out, JSON.stringify(parsed), 'utf8');
  console.log(`✅ tree.json:${tally(parsed.nodes)} → ${out}`);
  return true;
}

// ═══ PoE2:每個樹版本一檔(+ 中文)═══
function doPoe2() {
  const { td, vers } = versionsOf(POB.poe2);
  if (!vers.length) { console.log(`PoE2:略過(找不到 ${td};有裝 PoE2 的 PoB 就設 POB2_DIR)`); return true; }
  const zh = loadZh();
  console.log(zh ? `PoE2 中文字典:${zh.size} 條(${ZH_DIR})` : 'PoE2 中文字典:無 → 只出英文');
  for (const v of vers) {
    const treeLua = join(td, v, 'tree.lua');
    if (!existsSync(treeLua)) { console.log(`  ${v}:無 tree.lua,跳過`); continue; }
    const parsed = dumpTree(treeLua);
    parsed.version = v;
    parsed.game = 'poe2';
    let zhInfo = '';
    if (zh) {
      const r = applyZh(parsed.nodes, zh);
      const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
      zhInfo = `;中文名 ${pct(r.hitName, Object.keys(parsed.nodes).length)}% / 詞綴 ${pct(r.hitStat, r.totStat)}%`;
    }
    const out = join(OUT_DIR, `tree-poe2-${v}.json`);
    writeFileSync(out, JSON.stringify(parsed), 'utf8');
    console.log(`✅ tree-poe2-${v}.json:${tally(parsed.nodes)}${zhInfo}`);
  }
  return true;
}

let ok = true;
if (want === 'poe1' || want === 'both') ok = doPoe1() && ok;
if (want === 'poe2' || want === 'both') ok = doPoe2() && ok;
process.exit(ok ? 0 : 1);
