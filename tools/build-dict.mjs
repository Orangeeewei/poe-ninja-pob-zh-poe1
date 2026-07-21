/**
 * build-dict.mjs — 從 poe2db.tw 建立英文→繁中名稱字典
 *
 * 原理：poe2db 同一個 slug 有 /us/(英文)與 /tw/(繁中)兩種版本。
 *   <a href="/us/Herald_of_Ash">Herald of Ash</a>  (英文頁)
 *   <a href="/tw/Herald_of_Ash">灰燼之捷</a>        (中文頁)
 * 以 slug 當鍵 join，得到精確的「英文 → 中文」對照。
 *
 * 用法：node tools/build-dict.mjs
 * 產出：data/dict.json
 *
 * 改版後要更新字典，重跑這支即可。
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'data', 'dict.json');

// 要抓的分類頁(只填 slug，會自動組 /us/ 與 /tw/)。
// 之後想擴充翻譯範圍，往這裡加 slug 即可。
// ★ PoE1 分類 slug(已對 poedb.tw 實測校正:皆 200 且有資料)。
// PoE1 沒有 PoE2 的 Spirit_Gems/Foci/Waystones/Runes/Spears/Crossbows/Bucklers/Charms;
// 武器分類改成 PoE1 的 One/Two_Hand + Thrusting/Rune/Warstaves 等。
const CATEGORIES = [
  // 技能 / 寶石
  'Skill_Gems',        // 569
  'Support_Gems',      // 277
  // 職業 / 昇華
  'Ascendancy_class',  // 43
  // 傳奇物品
  'Unique_item',       // 178
  // 底材(武器)
  'One_Hand_Swords', 'Two_Hand_Swords', 'Thrusting_One_Hand_Swords',
  'One_Hand_Axes', 'Two_Hand_Axes', 'One_Hand_Maces', 'Two_Hand_Maces',
  'Bows', 'Wands', 'Daggers', 'Rune_Daggers', 'Claws',
  'Sceptres', 'Staves', 'Warstaves', 'Fishing_Rods',
  // 底材(防具)
  'Helmets', 'Body_Armours', 'Gloves', 'Boots', 'Shields', 'Quivers',
  // 底材(配件)
  'Rings', 'Amulets', 'Belts',
  // 藥劑
  'Life_Flasks', 'Mana_Flasks', 'Hybrid_Flasks', 'Utility_Flasks',
  // 珠寶
  'Jewels', 'Abyss_Jewels',
];

const UA = { 'User-Agent': 'Mozilla/5.0 (poe-ninja-translator dict builder)' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 抓某分類頁某語言，回傳 { slug: 顯示文字 }；503/網路錯誤時退避重試。
async function fetchPairs(slug, lang, attempt = 1) {
  const url = `https://poedb.tw/${lang}/${slug}`;   // PoE1(PoE2 是 poe2db.tw)
  let res;
  try {
    res = await fetch(url, { headers: UA });
  } catch (e) {
    if (attempt <= 3) { await sleep(1500 * attempt); return fetchPairs(slug, lang, attempt + 1); }
    console.warn(`  ! ${lang}/${slug} -> ${e.message}`);
    return {};
  }
  if (res.status === 503 || res.status === 429) {
    if (attempt <= 3) { await sleep(2000 * attempt); return fetchPairs(slug, lang, attempt + 1); }
  }
  if (!res.ok) {
    console.warn(`  ! ${lang}/${slug} -> HTTP ${res.status}`);
    return {};
  }
  const html = await res.text();
  const map = {};
  // 抓所有指向實體頁的連結:<a ... href="/us|tw/Slug" ...>顯示文字</a>
  const re = /<a[^>]+href="\/(?:us|tw)\/([A-Za-z0-9_'%().-]+)"[^>]*>([^<]{1,60})<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const itemSlug = decodeURIComponent(m[1]);
    const text = m[2].trim();
    if (!text) continue;
    if (!(itemSlug in map)) map[itemSlug] = text; // 取第一次出現
  }
  return map;
}

const hasCJK = (s) => /[㐀-鿿豈-﫿]/.test(s);

async function main() {
  const names = {}; // 英文 -> 中文
  let totalSlugs = 0;
  const deadSlugs = []; // §12 audit:0 對照的分類(slug 失效提示)

  for (const cat of CATEGORIES) {
    process.stdout.write(`抓取 ${cat} ... `);
    let en, zh;
    try {
      [en, zh] = await Promise.all([
        fetchPairs(cat, 'us'),
        fetchPairs(cat, 'tw'),
      ]);
    } catch (e) {
      console.warn(`失敗:${e.message}`);
      continue;
    }

    let added = 0;
    let pairs = 0;
    for (const slug of Object.keys(zh)) {
      const enText = en[slug];
      const zhText = zh[slug];
      if (!enText || !zhText) continue;        // 兩邊都要有
      if (hasCJK(enText)) continue;            // 英文頁文字不該含中文(濾掉語言切換器等)
      if (!hasCJK(zhText)) continue;           // 中文頁文字必須含中文
      if (enText === zhText) continue;         // 沒翻譯到的略過
      if (enText.length < 2) continue;
      pairs++;
      if (!(enText in names)) {
        names[enText] = zhText;
        added++;
      }
    }
    totalSlugs += added;
    console.log(`${added} 筆`);
    // §12 audit:整個分類 0 對照 = slug 大概被 poedb 改名/移除 → 提示人工檢查,別靜默漏抓
    if (pairs === 0) deadSlugs.push(cat);
    await sleep(600); // 禮貌延遲，避免被擋 503
  }
  if (deadSlugs.length) {
    console.warn(`\n⚠️ 這些分類 slug 抓不到任何 EN/TW 對照(poedb 可能改名/移除,請檢查 CATEGORIES):${deadSlugs.join(', ')}`);
  }

  // ⚠️ 合併安全:本支只負責「POEDB 名稱」這一塊,絕不可整個覆寫 dict.json,
  //   否則會抹掉其他管線寫入的 descriptions / uiAuto 與遊戲匯出 names
  //   (曾因整個覆寫導致排程 routine 單獨跑本支時清空字典)。
  //   故:讀回既有 dict.json,只「合併」names(POEDB 刷新優先、保留遊戲匯出名),
  //   原封不動保留 descriptions / uiAuto。version.json 一律交給 build-version.mjs,本支不碰。
  let existing = {};
  try { existing = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 首次建檔 */ }

  const mergedNames = { ...(existing.names || {}), ...names }; // POEDB(names)刷新優先,既有遊戲匯出名保留
  const sorted = {};
  for (const k of Object.keys(mergedNames).sort()) sorted[k] = mergedNames[k];

  // ★ 用展開保留「所有」既有區塊(descriptions/uiAuto/descriptionsAuto/uiUnvalidated/
  //   未來新增區塊…),只覆寫 names —— 曾因列舉式保留漏掉新區塊而把資料洗掉。
  const out = {
    ...existing,
    _source: existing._source || 'poedb.tw + PoE1 data export (pathofexile-dat)',
    _generated: 'run tools/build-dict.mjs (names 合併;其餘區塊原樣保留)',
    names: sorted,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 2), 'utf8');

  console.log(`\n完成:POEDB 本次 ${totalSlugs} 筆;合併後 names 共 ${Object.keys(sorted).length} 筆 -> ${OUT}`);
  console.log(`(descriptions ${Object.keys(out.descriptions || {}).length} / uiAuto ${Object.keys(out.uiAuto || {}).length} 已保留;version.json 交給 build-version.mjs)`);

  // §12 audit:用 gamedata/base_items.json(RePoE)做覆蓋率稽核 —— 哪個物品類別的底材
  // 缺中文名最多 → 提示該加哪類 CATEGORIES slug(新增只要往上面清單加一行)。
  try {
    const bases = JSON.parse(await readFile(join(__dirname, '..', 'gamedata', 'base_items.json'), 'utf8'));
    const byClass = {};
    for (const b of Object.values(bases)) {
      if (!b?.name || b.release_state !== 'released') continue;
      if (!byClass[b.item_class]) byClass[b.item_class] = { total: 0, miss: 0 };
      byClass[b.item_class].total++;
      if (!(b.name in sorted)) byClass[b.item_class].miss++;
    }
    const gaps = Object.entries(byClass)
      .filter(([, v]) => v.miss >= 5 && v.miss / v.total > 0.3)
      .sort((a, b) => b[1].miss - a[1].miss);
    if (gaps.length) {
      console.warn('\n⚠️ 底材中文名覆蓋缺口(可能缺對應 CATEGORIES slug,或該類本無 poedb 分頁):');
      for (const [cls, v] of gaps.slice(0, 10)) console.warn(`   ${cls}: 缺 ${v.miss}/${v.total}`);
    }
  } catch { /* gamedata 未抓 → 略過稽核 */ }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
