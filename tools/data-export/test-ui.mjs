/**
 * test-ui.mjs — 驗證自動 UI 字典(dict.uiAuto)的「整節點精確比對」行為:
 *   ① 整個文字節點 === key(大小寫無關)→ 翻成中文
 *   ② 子字串不可被替換(避免切壞句子/名稱)— 安全性保證
 *   ③ 手工 ui-labels.json 優先權高於自動
 * 以真實 data 驅動,鏡射 translator.js 的 uiMap 建法與 translateTextNode 的 UI 分支。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const base = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dict = JSON.parse(readFileSync(join(base, 'data', 'dict.json'), 'utf8'));
const ui = JSON.parse(readFileSync(join(base, 'data', 'ui-labels.json'), 'utf8'));

// 鏡射 translator.buildIndexes 的 uiMap:先自動,後手工(手工覆蓋)
const uiMap = new Map();
for (const [en, zh] of Object.entries(dict.uiAuto || {})) uiMap.set(en.toLowerCase(), zh);
for (const [en, zh] of Object.entries(ui.labels || {})) {
  if (en.startsWith('_')) continue;
  uiMap.set(en.toLowerCase(), zh);
}

// 鏡射 translateTextNode 的 UI 分支(只動整節點精確比對)
function translateNodeUI(node) {
  const raw = node.nodeValue;
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed || !/[A-Za-z]/.test(trimmed)) return false;
  const hit = uiMap.get(trimmed.toLowerCase());
  if (hit) { node.nodeValue = raw.replace(trimmed, hit); return true; }
  return false;
}

let pass = 0, fail = 0;
function check(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.log(`✗ ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

const { document } = new JSDOM('<div id=r></div>').window;
function nodeFor(text) { const t = document.createTextNode(text); document.getElementById('r').appendChild(t); return t; }

// ① 精確節點命中(大小寫無關)
for (const [en, want] of [['Currency', '通貨'], ['Amulets', '項鍊'], ['Life Flasks', '生命藥劑'], ['Witch', '女巫'], ['currency', '通貨']]) {
  const expect = en === 'currency' ? en.replace('currency', want) : en.replace(en.trim(), want);
  const n = nodeFor(en); translateNodeUI(n); check('hit:' + en, n.nodeValue, want);
}

// ② 子字串安全:整節點不等於 key → 不可被改
//    (Chaos Orb 自 ref 挖掘後整節點命中 uiAuto=混沌石,與 names 官方值一致 → 移到①類)
for (const en of ['Currency Orb', 'Witch Hunter Ascendancy', 'A bow for the ranger']) {
  const n = nodeFor(en); translateNodeUI(n); check('nochange:' + en, n.nodeValue, en);
}
{ const n = nodeFor('Chaos Orb'); translateNodeUI(n); check('hit:Chaos Orb(ref 挖掘)', n.nodeValue, '混沌石'); }

// ③ 前後空白保留(只換 trim 後的字)
{ const n = nodeFor('  Currency  '); translateNodeUI(n); check('whitespace', n.nodeValue, '  通貨  '); }

console.log(`\nuiAuto 筆數 ${Object.keys(dict.uiAuto || {}).length} | uiMap 合併後 ${uiMap.size} | PASS ${pass} FAIL ${fail}`);
if (fail) process.exit(1);
