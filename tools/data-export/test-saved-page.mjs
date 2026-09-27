/**
 * test-saved-page.mjs — 對「瀏覽器另存的 poe.ninja 頁面」跑真正的 translator.js,
 * 印出翻譯後仍殘留英文的文字節點(= 收集器內容),直接接 find-source.mjs。
 *
 * 用法:node test-saved-page.mjs <saved.htm> [--json out.json] [--show-zh]
 *   --json     把殘留字串寫成 JSON 陣列(餵 find-source.mjs)
 *   --show-zh  同時印出已翻成中文的行(檢查有沒有亂翻)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const base = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const translatorCode = readFileSync(join(base, 'translator.js'), 'utf8');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) { console.error('用法:node test-saved-page.mjs <saved.htm> [--json out.json] [--show-zh]'); process.exit(1); }
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const showZh = args.includes('--show-zh');

let html = readFileSync(file, 'utf8');
// 另存的頁面帶站方 script,jsdom 不執行(runScripts: outside-only),但拿掉可加速解析
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
// 加一個 sentinel 判斷引擎初始化完成
html = html.replace(/<\/body>/i, '<div id="__sentinel">Energy Shield</div></body>');

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.chrome = {
  runtime: { getURL: (f) => join(base, f) },
  storage: { local: { get: () => Promise.reject(new Error('no storage in test')) } },
};
window.fetch = (p) => Promise.resolve({ json: () => Promise.resolve(JSON.parse(readFileSync(p, 'utf8'))) });
window.requestIdleCallback = (fn) => window.setTimeout(fn, 0);
const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };
window.eval(translatorCode);

const doc = window.document;
async function waitReady(timeoutMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    if (doc.getElementById('__sentinel').textContent.includes('能量護盾')) return;
    if (Date.now() - t0 > timeoutMs) throw new Error('translator 初始化逾時');
    await new Promise((r) => window.setTimeout(r, 50));
  }
}
await waitReady();
await new Promise((r) => window.setTimeout(r, 300)); // 讓排程中的重掃跑完
console.log = origLog;

// 匯出收集器內容(模擬 Alt+點右下按鈕)
const btn = doc.querySelector('.pob-zh-toggle');
const before = logs.length;
console.log = (...a) => { logs.push(a.join(' ')); };
btn.dispatchEvent(new window.MouseEvent('click', { altKey: true, bubbles: true }));
console.log = origLog;
const dump = logs.slice(before).find((l) => l.includes('未翻譯字串')) || '';
const misses = (() => { const i = dump.indexOf('\n['); return i === -1 ? [] : JSON.parse(dump.slice(i + 1)); })();

// 另外走訪一次 DOM:列出所有仍含英文的可見文字節點(含收集器過濾掉的,供對照)
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg', 'SVG']);
const residual = new Map();
const tw = doc.createTreeWalker(doc.body, window.NodeFilter.SHOW_TEXT);
let n;
while ((n = tw.nextNode())) {
  const t = n.nodeValue.replace(/\s+/g, ' ').trim();
  if (!t || !/[A-Za-z]{2,}/.test(t)) continue;
  let skip = false;
  for (let p = n.parentElement; p; p = p.parentElement) if (SKIP.has(p.tagName) || p.classList.contains('pob-zh-toggle')) { skip = true; break; }
  if (skip) continue;
  residual.set(t, (residual.get(t) || 0) + 1);
}

console.log(`頁面:${doc.title}`);
console.log(`\n=== 收集器(引擎判定未翻譯,${misses.length} 筆)===`);
for (const m of misses) console.log('  ' + m);
console.log(`\n=== 翻譯後仍含英文的文字節點(${residual.size} 種,含收集器過濾掉的品牌/帳號等)===`);
for (const [t, c] of [...residual].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(3)}× ${t.slice(0, 120)}`);
if (showZh) {
  console.log('\n=== 已翻譯(含中文)的文字節點 ===');
  const seen = new Set();
  const tw2 = doc.createTreeWalker(doc.body, window.NodeFilter.SHOW_TEXT);
  while ((n = tw2.nextNode())) {
    const t = n.nodeValue.replace(/\s+/g, ' ').trim();
    if (/[一-鿿]/.test(t) && !seen.has(t)) { seen.add(t); console.log('  ' + t.slice(0, 120)); }
  }
}
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify(misses, null, 2), 'utf8'); console.log(`\n已寫入 ${jsonOut}`); }
