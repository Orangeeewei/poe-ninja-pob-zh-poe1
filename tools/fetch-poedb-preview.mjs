/**
 * fetch-poedb-preview.mjs — 季前更新前瞻(poedb Version_X.Y.0 頁)自動偵測與抓取。
 *
 * 背景:每次大改版上線前,poedb 會先出「版本更新前瞻」頁(如 /tw/Version_3.29.0,
 * 含新聯盟、技能/輔助/瓦爾寶石改動、傳奇改動、昇華改動…的完整章節)。
 * 使用者要求:偵測到季前更新時主動抓進來,MCP 可查,且特別標註「尚未上線的新資訊」。
 *
 * 邏輯:
 *   1. 從 .last-patch(如 3.28.0.16)推測下一版:probe Version_3.29.0、3.30.0(保險多探一版)。
 *   2. 頁面存在(HTTP 200 且有版本標題)→ 解析 TW 頁(內容較全):
 *      - 標題(聯盟名)+ TOC 錨點
 *      - 依 <h3 id=..> 切章節,章節內 <li>/<p>/表格列 → 純文字行
 *   3. 寫 data/preview.json:{ version, title, url, fetchedAt, currentPatch, status, sections }
 *      status:'upcoming'(版本 > 現行 patch)/'released'(已上線,僅供回顧)。
 *   4. 找不到任何前瞻頁 → 保留既有 preview.json(若其版本已上線改標 released),不清空。
 *
 * MCP 端由 poe-mcp 的 get_patch_preview 工具讀取,回答時一律加「⚠️ 季前前瞻,尚未上線」。
 * update-poe1.mjs 每日跑一次本腳本 → 前瞻一出現就自動接住。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'data', 'preview.json');
const LAST_PATCH = join(here, '..', '.last-patch');
const UA = { 'User-Agent': 'Mozilla/5.0 (poe-ninja-translator preview fetcher)' };

const decodeEnt = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
const stripTags = (s) => decodeEnt(String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t]+/g, ' ').trim();

// 章節切分:以 <h3 ...id="xxx"...>Title</h3> 為界;h3 沒 id 時用文字當 id。
export function parsePreview(html) {
  // 標題(h1)含版本與聯盟名
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1];
  const title = h1 ? stripTags(h1) : null;
  // 只取主內容區,避開導覽/頁尾雜訊(粗略:從 h1 開始)
  const start = html.search(/<h1[^>]*>/);
  const body = start >= 0 ? html.slice(start) : html;
  const parts = body.split(/<h3\b/);
  const sections = [];
  for (let i = 1; i < parts.length; i++) {
    const seg = '<h3' + parts[i];
    const id = (seg.match(/^<h3[^>]*id="([^"]+)"/) || [])[1] || null;
    const st = (seg.match(/^<h3[^>]*>([\s\S]*?)<\/h3>/) || [])[1];
    const sTitle = st ? stripTags(st) : null;
    if (!sTitle) continue;
    const content = seg.replace(/^<h3[^>]*>[\s\S]*?<\/h3>/, '');
    const lines = [];
    // 條列與段落;表格列攤平成「格1 | 格2…」
    for (const m of content.matchAll(/<li[^>]*>([\s\S]*?)<\/li>|<p[^>]*>([\s\S]*?)<\/p>|<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      let t;
      if (m[3] !== undefined) {
        t = [...m[3].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => stripTags(c[1])).filter(Boolean).join(' | ');
      } else t = stripTags(m[1] ?? m[2] ?? '');
      t = t.replace(/\s*\n\s*/g, ' ').trim();
      if (t && t.length > 1 && !lines.includes(t)) lines.push(t);
    }
    sections.push({ id: id || sTitle.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, ''), title: sTitle, lines });
  }
  return { title, sections };
}

const verNum = (v) => String(v).split('.').slice(0, 2).map(Number); // '3.29.0'→[3,29]
const cmpVer = (a, b) => { const [x1, y1] = verNum(a), [x2, y2] = verNum(b); return x1 - x2 || y1 - y2; };

async function main() {
  let current = '3.28.0.16';
  try { current = (await readFile(LAST_PATCH, 'utf8')).trim(); } catch { /* fallback */ }
  const [maj, min] = verNum(current);
  const probes = [`${maj}.${min + 1}.0`, `${maj}.${min + 2}.0`]; // 下一版 + 保險再探一版

  let existing = null;
  try { existing = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 首次 */ }

  let found = null;
  for (const v of probes) {
    const url = `https://poedb.tw/tw/Version_${v.replace(/\./g, '')}`.replace(/Version_(\d)(\d+)0$/, 'Version_$1.$2.0');
    // poedb 的 slug 其實是 Version_3.29.0(帶點),直接組:
    const realUrl = `https://poedb.tw/tw/Version_${v}`;
    try {
      const res = await fetch(realUrl, { headers: UA });
      if (!res.ok) { console.log(`probe ${v}: HTTP ${res.status}(尚無前瞻頁)`); continue; }
      const html = await res.text();
      const parsed = parsePreview(html);
      if (!parsed.title || !parsed.sections.length) { console.log(`probe ${v}: 頁面存在但無法解析章節,略過`); continue; }
      found = { version: v, url: realUrl, ...parsed };
      break;
    } catch (e) { console.log(`probe ${v}: ${e.message}`); }
    void url;
  }

  if (!found) {
    if (existing) {
      // 前瞻頁沒了/沒新版:若既有前瞻的版本已上線 → 改標 released 保留供回顧
      if (cmpVer(existing.version, current) <= 0 && existing.status !== 'released') {
        existing.status = 'released';
        await writeFile(OUT, JSON.stringify(existing, null, 1), 'utf8');
        console.log(`前瞻 ${existing.version} 已上線 → 標記 released(保留回顧)`);
      } else console.log('無新前瞻;保留既有 preview.json');
    } else console.log('目前沒有季前前瞻頁。');
    return;
  }

  const status = cmpVer(found.version, current) > 0 ? 'upcoming' : 'released';
  const out = {
    version: found.version,
    title: found.title,
    url: found.url,
    status,                       // upcoming = 尚未上線的季前資訊
    currentPatch: current,
    fetchedAt: new Date().toISOString(),
    sections: found.sections,
  };
  await writeFile(OUT, JSON.stringify(out, null, 1), 'utf8');
  const total = found.sections.reduce((a, s) => a + s.lines.length, 0);
  console.log(`✅ 前瞻 ${found.version}「${found.title}」→ ${found.sections.length} 章節 / ${total} 行(status=${status})-> data/preview.json`);
  for (const s of found.sections.slice(0, 8)) console.log(`   #${s.id} ${s.title}(${s.lines.length})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
