// fetch-unique-drops.mjs — 從 poewiki cargo 抓「傳奇 → 掉落來源」→ gamedata/unique-drops.json。
// 大多數傳奇是全域掉落(欄位 null,不入檔);只存「有指定來源」的:boss/區域/絕版備註。
// 沿用 fetch-divcards 的分頁模式(欄位不能混查的坑同樣適用)。
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const API = 'https://www.poewiki.net/w/api.php';
const UA = { headers: { 'User-Agent': 'poe-mcp/0.1 (personal tool)' } };

const clean = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/\[\[File:[^\]]*\]\]/gi, '')
  .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1')
  .replace(/\s*•\s*/g, ' / ').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();

async function cargoAll(fields) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const url = `${API}?action=cargoquery&tables=items&fields=${encodeURIComponent(fields)}&where=${encodeURIComponent('items.rarity_id="unique"')}&limit=500&offset=${offset}&format=json`;
    const r = await fetch(url, UA);
    if (!r.ok) throw new Error(`cargo HTTP ${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(`cargo error: ${j.error.info || j.error.code}`);
    const rows = (j.cargoquery || []).map((x) => x.title);
    out.push(...rows);
    if (rows.length < 500) break;
  }
  return out;
}

const rows = await cargoAll('items.name,items.drop_monsters,items.drop_areas_html,items.drop_text');
const drops = {};
for (const r of rows) {
  const name = clean(r.name);
  if (!name) continue;
  const areas = clean(r['drop areas html']);
  const monsters = clean(r['drop monsters']);
  const text = clean(r['drop text']);
  if (!areas && !monsters && !text) continue; // 全域掉落 → 不入檔(檔案小、查詢也快)
  const e = {};
  if (areas) e.areas = areas;
  // drop_monsters 常是 metadata 路徑(不可讀)→ 只留看得懂的
  if (monsters && !/Metadata\//.test(monsters)) e.monsters = monsters;
  if (text) e.note = text;
  if (Object.keys(e).length) drops[name] = e;
}
const n = Object.keys(drops).length;
if (n < 100) { console.error(`只有 ${n} 筆有來源,疑似壞資料,不覆寫`); process.exit(1); }
const outDir = join(repo, 'gamedata');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'unique-drops.json'), JSON.stringify(drops), 'utf8');
console.log(`✅ unique-drops.json:${n} 筆有指定掉落來源(全域掉落不入檔)`);
