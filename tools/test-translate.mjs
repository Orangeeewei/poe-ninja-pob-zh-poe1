/** 簡易測試:用真實字典模擬 translator 的比對邏輯 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const base = join(dirname(fileURLToPath(import.meta.url)), '..');
const dict = JSON.parse(readFileSync(join(base, 'data', 'dict.json'), 'utf8'));
const ui = JSON.parse(readFileSync(join(base, 'data', 'ui-labels.json'), 'utf8'));
JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8'));
console.log('JSON 全部有效 ✓\n');

const uiMap = new Map(
  Object.entries(ui.labels).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k.toLowerCase(), v])
);
const nameMap = new Map(Object.entries(dict.names));
const multi = [...nameMap.keys()].filter((e) => e.includes(' ') && e.length >= 5).sort((a, b) => b.length - a.length);
const multiLookup = new Map(multi.map((e) => [e.toLowerCase(), nameMap.get(e)]));
const esc = multi.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const re = new RegExp('(?<![A-Za-z0-9])(' + esc.join('|') + ')(?![A-Za-z0-9])', 'gi');

function translate(input) {
  const t = input.trim();
  if (!/[A-Za-z]/.test(t)) return t;
  if (uiMap.has(t.toLowerCase())) return uiMap.get(t.toLowerCase());
  if (nameMap.has(t)) return nameMap.get(t);
  re.lastIndex = 0;
  if (re.test(t)) {
    re.lastIndex = 0;
    return t.replace(re, (m) => multiLookup.get(m.toLowerCase()) || m);
  }
  return t + '  (未翻譯)';
}

const samples = [
  'Level 93 Spirit Walker', 'Boneshatter', 'Movement Speed', 'DEFENSIVE',
  'Herald of Ash', 'Resistances', 'Spirit', 'Energy shield', 'Effective Health Pool',
  'Back to character list', 'Lightning Arrow', 'Cast on Freeze', 'Some Random English Text',
];
for (const s of samples) console.log(JSON.stringify(s), '->', translate(s));
console.log(`\n多字名稱數:${multi.length}`);
