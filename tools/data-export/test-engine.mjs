/**
 * test-engine.mjs — 引擎安全性回歸(2026-06-10 重構:骨架保留 / 可逆 / 回音標記)。
 *
 * 驗證重點:
 *   1. 整行合併「不增刪元素」:行內 <span>/<a>/<img> 在翻譯後仍存在(React 安全)。
 *   2. 屬性翻譯:title / placeholder 譯出且可還原。
 *   3. 截斷字串(…結尾)前綴唯一命中才翻。
 *   4. 網站改寫已翻譯節點(模擬 React 重繪)→ 重新翻譯,且切英文還原的是「新」原文
 *      (原文快照不過期)。
 *   5. 切英文/切中文在以上情境全部可逆。
 *
 * 用法:node test-engine.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const base = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const translatorCode = readFileSync(join(base, 'translator.js'), 'utf8');

const HTML = `<body>
  <!-- 整行合併:關鍵字拆 span -->
  <div id="m1">Convert 100% of maximum <span class="kw">Energy Shield</span> to maximum <span class="kw">Mana</span></div>
  <!-- 整行合併:行內含 <a>(巢狀珠寶詞綴) -->
  <div id="m2">Notable Passive Skills in Radius also grant 7% increased <a href="/x">Critical Hit Chance</a> for Spells</div>
  <!-- 整行合併:行內含 <img>(以前會被跳過,現在骨架保留可安全合併) -->
  <div id="m3"><img src="i.png" alt=""><span>Mana Costs are Doubled</span></div>
  <!-- 屬性翻譯 -->
  <input id="a1" placeholder="Filter by Name">
  <span id="a2" title="Energy Shield">x</span>
  <!-- 截斷字串:前綴唯一命中 -->
  <div id="e1">Lineage Support Ge...</div>
  <!-- 網站重繪模擬目標 -->
  <div id="r1">Mana Costs are Doubled</div>
  <!-- 數值欄「數字+單位」 -->
  <div id="u1">56 Mana</div>
  <div id="u2">0.70 sec</div>
  <!-- 句子層級不可被單位規則半翻(留給收集器) -->
  <div id="u3">Gain 5 Mana per Enemy Killed by Hits</div>
  <!-- 導覽列/灌注標題 -->
  <div id="n1">Precursor Tablets</div>
  <div id="n2">Cold-Infused</div>
  <!-- svg 的 <style> 不得進翻譯(SVG tagName 是小寫) -->
  <svg id="s1"><style>.logo{fill:#fff}</style></svg>
  <!-- 行內 svg 圖示 + 詞綴:排除 svg 文字後仍可整行合併 -->
  <div id="s2"><svg><style>.ic{fill:#000}</style></svg><span>Mana Costs are Doubled</span></div>
  <!-- 魔遺(ref 挖掘 uiAuto):拆節點與整節點都要翻成官方名 -->
  <div id="k1">Legacy of <a>Diamond</a></div>
  <div id="k1b"><a>Legacy of Sulphur</a></div>
  <!-- 魔血真實 DOM(使用者提供):tooltip 觸發器是 span[data-tooltip-trigger],非 <a> -->
  <div id="mb1" class="whitespace-pre-line"><span>Legacy of </span><span class="underline decoration-dotted" data-tooltip-trigger="true" data-tooltip-id="_r_1_">Diamond</span><span></span></div>
  <div id="mb2" class="whitespace-pre-line"><span>All </span><span class="underline decoration-dotted" data-tooltip-trigger="true" data-tooltip-id="_r_2_">Mage's Legacies</span><span> have 48% increased effect per duplicate </span><span class="underline decoration-dotted" data-tooltip-trigger="true" data-tooltip-id="_r_3_">Mage's Legacy</span><span> you have</span></div>
  <!-- keepEnglish:尚無官方繁中的名稱整行保留 -->
  <div id="k2"><a>Hypnotic Glimmer</a></div>
  <!-- 站方 UI 樣式 -->
  <div id="p1">5 minutes ago</div>
  <div id="p2">20 Levels from Gem (Max)</div>
  <div id="p3">+1 Level from Corruption</div>
  <div id="p4">(trigger)</div>
  <div id="p5">26 Ward</div>
  <!-- sentinel -->
  <div id="sentinel">Energy Shield</div>
</body>`;

const dom = new JSDOM(`<!DOCTYPE html><html>${HTML}</html>`, { runScripts: 'outside-only' });
const { window } = dom;

window.chrome = {
  runtime: { getURL: (f) => join(base, f) },
  storage: { local: { get: () => Promise.reject(new Error('no storage in test')) } },
};
window.fetch = (p) =>
  Promise.resolve({ json: () => Promise.resolve(JSON.parse(readFileSync(p, 'utf8'))) });

window.eval(translatorCode);

const doc = window.document;
const txt = (id) => doc.getElementById(id).textContent;
const sleep = (ms) => new Promise((r) => window.setTimeout(r, ms));

async function waitReady(timeoutMs = 8000) {
  const t0 = Date.now();
  for (;;) {
    if (txt('sentinel').includes('能量護盾')) return;
    if (Date.now() - t0 > timeoutMs) throw new Error('translator 初始化逾時');
    await sleep(50);
  }
}

let pass = 0;
const fails = [];
const check = (name, cond, got) => {
  if (cond) { pass++; console.log(`  ✅ ${name}${got !== undefined ? ' → "' + got + '"' : ''}`); }
  else { fails.push(name); console.log(`  ❌ ${name}${got !== undefined ? ' → "' + got + '"' : ''}`); }
};

(async () => {
  await waitReady();
  const btn = doc.querySelector('.pob-zh-toggle');

  // 1) 骨架保留:翻譯後元素數不變、span/a/img 仍在
  const m1 = doc.getElementById('m1');
  check('m1 整行翻成中文', txt('m1').includes('能量護盾') && !/[A-Za-z]/.test(txt('m1')), txt('m1'));
  check('m1 的 2 個 <span> 仍在(React 安全)', m1.querySelectorAll('span.kw').length === 2);

  const m2 = doc.getElementById('m2');
  check('m2 巢狀詞綴翻出', txt('m2').includes('範圍內核心天賦也會賦予'), txt('m2'));
  check('m2 的 <a> 仍在(連結不消失)', !!m2.querySelector('a[href="/x"]'));

  const m3 = doc.getElementById('m3');
  check('m3 含 <img> 的行可整行翻譯', txt('m3').includes('魔力消耗加倍'), txt('m3'));
  check('m3 的 <img> 仍在', !!m3.querySelector('img'));

  // 2) 屬性翻譯
  const a1 = doc.getElementById('a1');
  const a2 = doc.getElementById('a2');
  check('placeholder 翻出', a1.getAttribute('placeholder') === '依名稱篩選', a1.getAttribute('placeholder'));
  check('title 翻出', a2.getAttribute('title') === '能量護盾', a2.getAttribute('title'));

  // 3) 截斷字串
  check('截斷字串前綴唯一命中', txt('e1') === '血脈輔助寶石', txt('e1'));

  // 3.5) 數值單位 / 導覽列 / svg style
  check('數值單位 56 Mana', txt('u1') === '56 魔力', txt('u1'));
  check('數值單位 0.70 sec', txt('u2') === '0.70 秒', txt('u2'));
  // 允許:完全沒翻(交給收集器)或被詞綴模板完整翻譯;不允許只把單位半翻成「5 魔力」混在英文句裡
  check('句子不被單位規則半翻', !(txt('u3').includes('魔力') && /[A-Za-z]/.test(txt('u3'))), txt('u3'));
  check('導覽 Precursor Tablets', txt('n1') === '先行者碑牌', txt('n1'));
  check('灌注標題 Cold-Infused', txt('n2') === '冰冷灌注', txt('n2'));
  check('svg <style> 內容未被動到', doc.getElementById('s1').textContent.includes('.logo{fill:#fff}'));
  check('行內 svg 圖示不擋整行合併', txt('s2').includes('魔力消耗加倍') && txt('s2').includes('.ic{fill:#000}'), txt('s2').replace(/\s+/g,' ').trim());
  check('魔遺拆節點整行翻譯(Legacy of Diamond)', txt('k1').replace(/\s+/g,' ').trim() === '寶鑽之遺', txt('k1'));
  check('魔遺譯文寫進連結內(可點、保留樣式)', doc.querySelector('#k1 a').textContent === '寶鑽之遺', doc.querySelector('#k1 a').textContent);
  check('魔遺整節點翻譯(Legacy of Sulphur)', txt('k1b') === '硫磺之遺', txt('k1b'));
  // 魔血真實 DOM:tooltip 觸發 span 必須保有文字(hover lore),不得被清空
  const mb1t = doc.querySelector('#mb1 [data-tooltip-trigger]');
  check('魔血魔遺行整行翻譯', txt('mb1').replace(/\s+/g,' ').trim() === '寶鑽之遺', txt('mb1'));
  check('魔血觸發 span 保有譯文(hover lore 可用)', mb1t.textContent === '寶鑽之遺', mb1t.textContent);
  const mb2t = [...doc.querySelectorAll('#mb2 [data-tooltip-trigger]')].map(e=>e.textContent);
  check('48% 行整行翻譯且零英文', !/[A-Za-z]/.test(txt('mb2')) && txt('mb2').includes('魔遺'), txt('mb2').replace(/\s+/g,' ').trim());
  check('48% 行兩個觸發詞各保有「魔遺」', mb2t.length === 2 && mb2t.every(t=>t === '魔遺'), JSON.stringify(mb2t));
  check('keepEnglish:整名保留(Hypnotic Glimmer)', txt('k2') === 'Hypnotic Glimmer', txt('k2'));
  check('相對時間 5 minutes ago', txt('p1') === '5 分鐘前', txt('p1'));
  check('寶石等級來源 (Max)', txt('p2') === '來自寶石 20 等（上限）', txt('p2'));
  check('污染等級 +1', txt('p3') === '來自污染 +1 等', txt('p3'));
  check('(trigger) 標籤', txt('p4') === '(觸發)', txt('p4'));
  check('Ward 單位', txt('p5') === '26 保護', txt('p5'));

  // 4) 切英文:全部可逆(含骨架行、屬性)
  btn.click();
  check('切英文:m1 還原', txt('m1').replace(/\s+/g, ' ').trim() === 'Convert 100% of maximum Energy Shield to maximum Mana', txt('m1'));
  check('切英文:m2 還原且 <a> 仍在', /Critical Hit Chance/.test(txt('m2')) && !!m2.querySelector('a[href="/x"]'));
  check('切英文:placeholder 還原', a1.getAttribute('placeholder') === 'Filter by Name', a1.getAttribute('placeholder'));
  check('切英文:title 還原', a2.getAttribute('title') === 'Energy Shield', a2.getAttribute('title'));

  // 5) 切回中文
  btn.click();
  check('切回中文:m1 重新翻譯', txt('m1').includes('能量護盾'), txt('m1'));
  check('切回中文:placeholder 重新翻譯', a1.getAttribute('placeholder') === '依名稱篩選', a1.getAttribute('placeholder'));

  // 6) 模擬 React 重繪:網站直接改寫已翻譯節點的文字 → 應重新翻譯
  const r1node = doc.getElementById('r1').firstChild;
  r1node.nodeValue = 'Energy Shield'; // 網站換成新內容(非我們寫入)
  await sleep(300); // 等 observer + debounce(jsdom 走 setTimeout 100ms 路徑)
  check('網站改寫後重新翻譯', txt('r1') === '能量護盾', txt('r1'));

  // 7) 原文快照不過期:切英文應顯示「新」原文(Energy Shield),不是舊的
  btn.click();
  check('切英文:還原為網站的新原文', txt('r1') === 'Energy Shield', txt('r1'));
  btn.click();

  console.log(`\n引擎安全性:${pass}/${pass + fails.length} 通過`);
  if (fails.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
