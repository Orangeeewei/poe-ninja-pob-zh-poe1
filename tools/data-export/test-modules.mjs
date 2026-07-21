/**
 * test-modules.mjs — 新動態對接模塊的回歸測試。
 *
 * 把「本次新增、與 poe2db 同源」的模塊各取一個代表性 DOM,用 jsdom 載入真正的
 * translator.js 執行,斷言譯出中文且無英文殘留。守住這些模塊不會在未來重構時悄悄斷掉。
 * 涵蓋:異常狀態名(BuffDefinitions)、昇華職業(Ascendancy)、角色面板統計
 * (CharacterPanelStats)、技能簡述(ActiveSkills.ShortDescription)、關鍵字名詞
 * (KeywordPopups)、昇華天賦名(AlternatePassiveSkills)。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const base = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const translatorCode = readFileSync(join(base, 'translator.js'), 'utf8');

const HTML = `<body>
  <div id="m1">Ignited</div>                              <!-- BuffDefinitions.Name → 點燃 -->
  <div id="m2">Deadeye</div>                               <!-- Ascendancy.Name → 銳眼 -->
  <div id="m3">Spirit</div>                                <!-- CharacterPanelStats → 精魂 -->
  <div id="m4">Evasion</div>                               <!-- CharacterPanelStats → 閃避 -->
  <div id="m5">Physical Damage</div>                       <!-- KeywordPopups.Term → 物理傷害 -->
  <div id="m6">Raise your Shield and charge forward.</div> <!-- ActiveSkills.ShortDescription -->
  <div id="m7"><a>Divine Flesh</a></div>                   <!-- AlternatePassiveSkills.Name → 神聖血肉 -->
  <!-- DPS 估算列:技能 icon(<img>)+ 名稱。翻名稱時 icon 不可被清掉(statLinePass 回歸) -->
  <div id="m8" class="dps-row"><img src="spark.png" class="skill-icon"/><span>Spark</span></div>
  <div id="sentinel">Energy Shield</div>
</body>`;

const dom = new JSDOM(`<!DOCTYPE html><html>${HTML}</html>`, { runScripts: 'outside-only' });
const { window } = dom;
window.chrome = {
  runtime: { getURL: (f) => join(base, f) },
  storage: { local: { get: () => Promise.reject(new Error('no storage in test')) } },
};
window.fetch = (p) => Promise.resolve({ json: () => Promise.resolve(JSON.parse(readFileSync(p, 'utf8'))) });
window.eval(translatorCode);

async function waitReady(timeoutMs = 8000) {
  const t0 = Date.now();
  for (;;) {
    if (window.document.getElementById('sentinel').textContent.includes('能量護盾')) return;
    if (Date.now() - t0 > timeoutMs) throw new Error('translator 初始化逾時');
    await new Promise((r) => window.setTimeout(r, 50));
  }
}

const txt = (id) => window.document.getElementById(id).textContent;
const hasEng = (s) => /[A-Za-z]/.test(s);

const CHECKS = [
  { id: 'm1', must: '點燃', desc: 'BuffDefinitions 異常狀態 Ignited' },
  { id: 'm2', must: '銳眼', desc: 'Ascendancy 昇華 Deadeye' },
  { id: 'm3', must: '精魂', desc: 'CharacterPanelStats Spirit' },
  { id: 'm4', must: '閃避', desc: 'CharacterPanelStats Evasion' },
  { id: 'm5', must: '物理傷害', desc: 'KeywordPopups Physical Damage' },
  { id: 'm6', must: '舉起你的盾牌', desc: 'ActiveSkills.ShortDescription' },
  { id: 'm7', must: '神聖血肉', desc: 'AlternatePassiveSkills Divine Flesh' },
  { id: 'm8', must: '電球', keepImg: true, desc: 'DPS 列 Spark 翻名稱但保留 icon <img>' },
];

(async () => {
  await waitReady();
  let pass = 0;
  const fails = [];
  for (const c of CHECKS) {
    const el = window.document.getElementById(c.id);
    const t = el.textContent;
    const imgOk = !c.keepImg || el.querySelector('img') !== null; // icon 不可被清掉
    if (t.includes(c.must) && !hasEng(t) && imgOk) {
      pass++;
      console.log(`  ✅ ${c.desc} → "${t}"${c.keepImg ? ' (img 保留)' : ''}`);
    } else {
      fails.push(c);
      console.log(`  ❌ ${c.desc} → "${t}" ${imgOk ? '(缺「' + c.must + '」或殘留英文)' : '(icon <img> 被清掉!)'}`);
    }
  }
  console.log(`\n新模塊回歸:${pass}/${CHECKS.length} 通過`);
  if (fails.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
