/** 用 jsdom 模擬 poe.ninja「關鍵字拆成 span」的結構，驗證 statLinePass 整行替換 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const base = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { templates } = JSON.parse(readFileSync(join(base, 'data', 'stat-templates.json'), 'utf8'));

// ---- 複製 translator.js 的詞綴比對核心 ----
const STAT_NUM = '[+-]?\\d+(?:[.,]\\d+)*';
const statNumRe = new RegExp(STAT_NUM, 'g');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map();
function compileStat(en) {
  if (cache.has(en)) return cache.get(en);
  let pattern = '', last = 0; const order = []; const phRe = /\{(\d+)\}/g; let pm;
  while ((pm = phRe.exec(en))) { pattern += esc(en.slice(last, pm.index)) + '(' + STAT_NUM + ')'; order.push(+pm[1]); last = pm.index + pm[0].length; }
  pattern += esc(en.slice(last));
  let re = null; try { re = new RegExp('^' + pattern + '$'); } catch {}
  const v = re ? { re, order } : null; cache.set(en, v); return v;
}
const pangu = (s) => s
  .replace(/([一-鿿])([A-Za-z0-9+\-])/g, '$1 $2')
  .replace(/([A-Za-z0-9%％)\]])([一-鿿])/g, '$1 $2');
function translateStat(line) {
  statNumRe.lastIndex = 0;
  const cands = templates[line.replace(statNumRe, '{}')];
  if (!cands) return null;
  for (const cand of cands) {
    const c = compileStat(cand.en); if (!c) continue;
    const mt = line.match(c.re); if (!mt) continue;
    const values = {}; c.order.forEach((idx, k) => { values[idx] = mt[k + 1]; });
    return pangu(cand.zh.replace(/\{(\d+)\}/g, (_, idx) => (idx in values ? values[idx] : '{' + idx + '}')));
  }
  return null;
}
const BLOCK_SEL = 'div,p,ul,ol,li,table,thead,tbody,tr,td,th,section,article,header,footer,nav,h1,h2,h3,h4,h5,h6,hr,form,button';
function depth(el) { let d = 0; for (let p = el.parentElement; p; p = p.parentElement) d++; return d; }
function statLinePass(root, doc) {
  const els = [...root.querySelectorAll('*')];
  els.sort((a, b) => depth(b) - depth(a));
  for (const el of els) {
    if (el.__pobTx || !el.isConnected) continue;
    if (el.childElementCount === 0) continue;
    if (el.querySelector(BLOCK_SEL)) continue;
    const norm = el.textContent.replace(/\s+/g, ' ').trim();
    if (!norm || !/[A-Za-z]/.test(norm)) continue;
    const zh = translateStat(norm);
    if (zh) { el.textContent = zh; el.__pobTx = true; }
  }
}

// 描述與符文前綴(從 dict.json 讀)
const dict = JSON.parse(readFileSync(join(base, 'data', 'dict.json'), 'utf8'));
const descMap = new Map(Object.entries(dict.descriptions || {}).map(([k, v]) => [k.replace(/\s+/g, ' ').trim(), v]));
const RUNE_PREFIX = { 'martial weapon': '軍用武器', 'wand or staff': '法杖或長杖', 'armour': '護甲' };
function translateLine(norm) {
  const d = descMap.get(norm); if (d) return d;
  const s = translateStat(norm); if (s) return s;
  const m = norm.match(/^(.{1,30}?):\s+(.+)$/);
  if (m) { const st = translateStat(m[2]); if (st) return (RUNE_PREFIX[m[1].toLowerCase()] || m[1]) + '：' + st; }
  return null;
}

// ---- 模擬 poe.ninja 把關鍵字拆成 <a> span 的行 ----
const html = `<div id="tip">
  <div class="mod">83% increased <a class="kw">Spirit</a></div>
  <div class="mod">Minions have 37% increased maximum <a class="kw">Life</a></div>
  <div class="mod"><a class="kw">Allies</a> in your Presence have 13% increased <a class="kw">Cast Speed</a></div>
  <div class="mod">Deals <span>58</span> to <span>88</span> <a class="kw">Fire</a> Damage</div>
  <div class="mod"><a class="kw">Martial Weapon</a>: Adds <span>1</span> to <span>30</span> <a class="kw">Lightning</a> Damage</div>
  <div class="mod">Right click this item then left click an item to apply it.</div>
  <div class="mod">Allows an item to foresee the result of the next <a>Currency</a> item used on it</div>
</div>`;
const dom = new JSDOM(html);
const doc = dom.window.document;
// statLinePass 用 translateLine
function statLinePass2(root) {
  const els = [...root.querySelectorAll('*')].sort((a, b) => depth(b) - depth(a));
  for (const el of els) {
    if (el.__pobTx || !el.isConnected || el.childElementCount === 0) continue;
    if (el.querySelector(BLOCK_SEL)) continue;
    const norm = el.textContent.replace(/\s+/g, ' ').trim();
    if (!norm || !/[A-Za-z]/.test(norm)) continue;
    const zh = translateLine(norm);
    if (zh) { el.textContent = zh; el.__pobTx = true; }
  }
}
statLinePass2(doc.getElementById('tip'));
for (const el of doc.querySelectorAll('.mod')) console.log('→', el.textContent);
