// fetch-divcards.mjs — 從 poewiki cargo API 抓命運卡(獎勵 + 掉落區)→ gamedata/divcards.json。
// 注意:欄位不能混查(stack_size 會 500),分兩趟:name+description、name+drop_*,再合併。
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const API = 'https://www.poewiki.net/w/api.php';
const UA = { headers: { 'User-Agent': 'poe-mcp/0.1 (personal tool)' } };

// wiki HTML/markup → 純文字
const clean = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/\[\[File:[^\]]*\]\]/gi, '')                     // 圖示連結整塊移除(否則殘留 16x16px|link=…)
  .replace(/\b\d+x\d+px\|[^\s\]]*/g, '')                    // 已解構的圖片參數殘渣
  .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1').replace(/\[\[([^\]]*)\]\]/g, '$1')
  .replace(/\s*•\s*/g, ' / ').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();

async function cargoAll(fields) {
  const out = [];
  for (let offset = 0; ; offset += 500) {
    const url = `${API}?action=cargoquery&tables=items&fields=${encodeURIComponent(fields)}&where=${encodeURIComponent('items.class_id="DivinationCard"')}&limit=500&offset=${offset}&format=json`;
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

const rewards = await cargoAll('items.name,items.description');
const drops = await cargoAll('items.name,items.drop_areas_html,items.drop_monsters,items.drop_text');
const cards = {};
for (const r of rewards) {
  if (!r.name) continue;
  cards[r.name] = { name: r.name, reward: clean(r.description) };
}
for (const d of drops) {
  const c = cards[d.name];
  if (!c) continue;
  const areas = clean(d['drop areas html']);
  const monsters = clean(d['drop monsters']);
  const text = clean(d['drop text']);
  if (areas) c.dropAreas = areas;
  if (monsters) c.dropMonsters = monsters;
  if (text) c.dropText = text;
}
const n = Object.keys(cards).length;
if (n < 200) { console.error(`只抓到 ${n} 張,疑似壞資料,不覆寫`); process.exit(1); }
const outDir = join(repo, 'gamedata');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'divcards.json'), JSON.stringify(cards), 'utf8');
const withDrop = Object.values(cards).filter((c) => c.dropAreas || c.dropMonsters || c.dropText).length;
console.log(`✅ divcards.json:${n} 張(${withDrop} 張有掉落資訊)`);
