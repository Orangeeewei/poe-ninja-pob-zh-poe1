// extract-tree.mjs — 從本機 PoB 的 TreeData 抽出天賦樹 → gamedata/tree.json。
// 用 poe-mcp/pob-bridge 的 luajit 跑 dump-tree.lua(tree.lua 是 3MB 的 lua 表,luajit 解析最穩)。
// 選版規則:TreeData 下 /^\d+_\d+$/ 的最新版(排除 ruthless/alternate)。
import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));

// luajit:env 優先,否則找兄弟資料夾 poe-mcp/pob-bridge
const LUAJIT = process.env.POE_LUAJIT
  || join(dirname(repo), 'poe-mcp', 'pob-bridge', 'luajit.exe');
// PoB 資料夾:env 優先,否則已知安裝位置
const POB_DIR = process.env.POB_DIR
  || 'C:\\Users\\User\\Desktop\\PoeCharm2-20251103\\Path of Building Community';

if (!existsSync(LUAJIT)) { console.error(`找不到 luajit:${LUAJIT}(設 POE_LUAJIT)`); process.exit(1); }
const treeData = join(POB_DIR, 'TreeData');
if (!existsSync(treeData)) { console.error(`找不到 TreeData:${treeData}(設 POB_DIR)`); process.exit(1); }

// 最新正式版(3_28 > 3_27;排除 ruthless / alternate)
const vers = readdirSync(treeData).filter((d) => /^\d+_\d+$/.test(d))
  .sort((a, b) => { const [a1, a2] = a.split('_').map(Number), [b1, b2] = b.split('_').map(Number); return a1 - b1 || a2 - b2; });
const latest = vers.at(-1);
if (!latest) { console.error('TreeData 下找不到版本資料夾'); process.exit(1); }
const treeLua = join(treeData, latest, 'tree.lua');
if (!existsSync(treeLua)) { console.error(`缺 ${treeLua}`); process.exit(1); }

console.log(`抽取天賦樹:${latest}(${treeLua})`);
const dumper = join(repo, 'tools', 'dump-tree.lua');
const json = execFileSync(LUAJIT, [dumper, treeLua], { maxBuffer: 64 * 1024 * 1024 }).toString();
const parsed = JSON.parse(json); // 驗證合法 JSON
parsed.version = latest;
const outDir = join(repo, 'gamedata');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const out = join(outDir, 'tree.json');
writeFileSync(out, JSON.stringify(parsed), 'utf8');
const n = Object.keys(parsed.nodes).length;
const ks = Object.values(parsed.nodes).filter((x) => x.t === 'k').length;
const nb = Object.values(parsed.nodes).filter((x) => x.t === 'n').length;
const ms = Object.values(parsed.nodes).filter((x) => x.t === 'm').length;
console.log(`✅ tree.json:${n} 節點(keystone ${ks} / notable ${nb} / mastery ${ms})→ ${out}`);
