// 驗證自繪清單的過濾比對(itemHaystack,與 translator.js 內同邏輯),餵真實 dict。
// 資料源是 fiber 的 resultItems:{ key(英文名), percentage }。
import { readFileSync } from 'node:fs';
const dict = JSON.parse(readFileSync(new URL('../data/dict.json', import.meta.url)));
const ui = JSON.parse(readFileSync(new URL('../data/ui-labels.json', import.meta.url)));

const nameMap = new Map(), uiMap = new Map();
for (const [en, zh] of Object.entries(dict.names || {})) nameMap.set(en, zh);
for (const [en, zh] of Object.entries(dict.uiAuto || {})) uiMap.set(en.toLowerCase(), zh);
for (const [en, zh] of Object.entries(ui.labels || {})) { if (!en.startsWith('_')) uiMap.set(en.toLowerCase(), zh); }

function zhAliasFor(raw) {
  if (!raw) return '';
  let out = '';
  if (nameMap.has(raw)) out += nameMap.get(raw);
  if (/[A-Za-z]/.test(raw)) for (const w of raw.split(/\s+/)) { const z = nameMap.get(w) || uiMap.get(w.toLowerCase()); if (z) out += z; }
  return out;
}
function itemHaystack(en, zh) {
  let hay = (zh || '').replace(/\s+/g, '') + (en || '').replace(/\s+/g, '');
  const alias = zhAliasFor(en); if (alias) hay += alias.replace(/\s+/g, '');
  return hay.toLowerCase();
}
// 模擬 renderList:給英文 key,算中文名與可搜文字,測 query 是否命中
const hayFor = (enKey) => itemHaystack(enKey, nameMap.get(enKey) || enKey);
const match = (enKey, q) => hayFor(enKey).includes(q.replace(/\s+/g, '').toLowerCase());

// [resultItems 的英文 key, [應命中], [不應命中]]
const cases = [
  ['Arc', ['電弧', 'arc'], ['水井', 'ring']],
  ['Frost Bomb', ['寒霜', '霜', 'frost', 'bomb'], ['arc', 'ring']],
  ['Heart of the Well', ['水井', '之心', 'heart', 'well'], ['電弧', 'ring']],
  ['Permafrost Bolts', ['永凍', '弩箭', 'permafrost', 'bolt'], ['ring']],
  ['Rare Ring', ['ring', '戒指', 'rare'], ['水井', 'arc']],
  ['Magic Flask', ['flask', 'magic', '藥劑'], ['ring']],
];
// 額外:「霜」應同時命中 Frost Bomb 與(若有)其他霜系
let pass = 0, fail = 0;
for (const [en, hits, misses] of cases) {
  for (const q of hits) { const ok = match(en, q); (ok ? pass++ : fail++); if (!ok) console.log(`FAIL 應命中: key="${en}" q="${q}" hay=${hayFor(en)}`); }
  for (const q of misses) { const ok = !match(en, q); (ok ? pass++ : fail++); if (!ok) console.log(`FAIL 誤命中: key="${en}" q="${q}" hay=${hayFor(en)}`); }
}
// 「霜」跨項:Frost Bomb 與 Herald of Ice(冰霜之捷)都應被「霜」命中
const frostAll = ['Frost Bomb', 'Herald of Ice'].filter((k) => match(k, '霜'));
console.log('「霜」命中的英文異詞項:', frostAll);
if (frostAll.length < 2) { console.log('注意:Herald of Ice 是否翻成含「霜」的中文?', nameMap.get('Herald of Ice')); }

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILED'}  pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
