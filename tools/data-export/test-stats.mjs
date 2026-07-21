/** 測試詞綴比對引擎（與 translator.js 的 compileStat/translateStat 相同邏輯） */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const base = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { templates, count } = JSON.parse(readFileSync(join(base, 'data', 'stat-templates.json'), 'utf8'));
console.log('模板數:', count, '/ buckets:', Object.keys(templates).length, '\n');

const STAT_NUM = '[+-]?\\d+(?:[.,]\\d+)*';
const numRe = new RegExp(STAT_NUM, 'g');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map();

function compileStat(en) {
  if (cache.has(en)) return cache.get(en);
  let pattern = '', last = 0; const order = [];
  const phRe = /\{(\d+)\}/g; let pm;
  while ((pm = phRe.exec(en))) {
    pattern += esc(en.slice(last, pm.index)) + '(' + STAT_NUM + ')';
    order.push(Number(pm[1])); last = pm.index + pm[0].length;
  }
  pattern += esc(en.slice(last));
  let re = null; try { re = new RegExp('^' + pattern + '$'); } catch {}
  const v = re ? { re, order } : null; cache.set(en, v); return v;
}

function translate(input) {
  const line = input.trim();
  numRe.lastIndex = 0;
  const key = line.replace(numRe, '{}');
  const cands = templates[key];
  if (!cands) return null;
  for (const cand of cands) {
    const c = compileStat(cand.en);
    if (!c) continue;
    const mt = line.match(c.re);
    if (!mt) continue;
    const values = {};
    c.order.forEach((idx, k) => { values[idx] = mt[k + 1]; });
    return cand.zh.replace(/\{(\d+)\}/g, (_, idx) => (idx in values ? values[idx] : '{' + idx + '}'));
  }
  return null;
}

const samples = [
  '8% increased Skill Effect Duration',
  '+1% to Maximum Lightning Resistance',
  'Gain 15% of Damage as Extra Cold Damage',
  '30% increased Charm Charges gained',
  '+1 Charm Slot',
  '20% increased Cooldown Recovery Rate',
  '25% increased Stun Threshold',
  '30% increased Life Recovery from Flasks',
  'Adds 12 to 24 Physical Damage',
  '8% increased Movement Speed',
  '+25 to maximum Life',
  '12% increased Attack Speed',
];
let hit = 0;
for (const s of samples) {
  const r = translate(s);
  if (r) hit++;
  console.log((r ? '✓' : '✗'), JSON.stringify(s), '->', r ?? '(未命中)');
}
console.log(`\n命中 ${hit}/${samples.length}`);
