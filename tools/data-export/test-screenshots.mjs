/**
 * test-screenshots.mjs — 截圖重現測試。
 *
 * 把使用者 6 張截圖中「仍殘留英文」的 DOM 結構用 jsdom 重建,
 * 載入「真正的 translator.js」(stub chrome/fetch 供本地 data/*.json)執行,
 * 然後斷言:目標英文已消失、且關鍵中文已出現。
 *
 * 這是自動驗證「沒有任何 poe2db 英文殘留」的把關測試。
 * 用法:node test-screenshots.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';

const base = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const translatorCode = readFileSync(join(base, 'translator.js'), 'utf8');

// 各截圖的 DOM 重建。poe.ninja 常把關鍵字拆成獨立 <span>/<a>,
// 故同時包含「整句單一文字節點」與「關鍵字拆 span」兩種形態以求穩健。
const HTML = `<body>
  <!-- 圖3:珠寶詞綴(文字佔位符技能等級) -->
  <div class="line" id="t1">+2 to Level of all <span>Spark</span> Skills</div>
  <div class="line" id="t1b">+2 to Level of all Spark Skills</div>

  <!-- 圖4:基石 keystone,兩句各自獨立成行 -->
  <div class="line" id="t2">Convert 100% of maximum <span>Energy Shield</span> to maximum <span>Mana</span></div>
  <div class="line" id="t3">Mana Costs are Doubled</div>

  <!-- 圖1:物品需求(標籤:值 + 屬性縮寫)。真實 poe.ninja 把 Level 拆成獨立 span
       (截圖「等級 65」已翻譯佐證)→ t4b 是真實結構(嚴格零英文);
       t4 把整列塞成單一文字節點是人為極端 → 僅要求標籤/屬性翻出。 -->
  <div class="line" id="t4">Requires: Level 65, 121 Int</div>
  <div class="line" id="t4b">Requires: <span>Level</span> 65, <span>121 Int</span></div>

  <!-- 圖2:符文 Stack Size / 類別 Rune -->
  <div class="line" id="t5">Stack Size: 1/10</div>
  <div class="line" id="t6">Rune</div>

  <!-- 圖6:輔助寶石類別 Short Fuse / 需求 -->
  <div class="line" id="t7">Short Fuse</div>
  <div class="line" id="t8">Support Gem Requirements: +5 Str (5)</div>

  <!-- placement 整段(圖2/3/6) -->
  <div class="line" id="t9">Place into an empty Augment Socket in a Weapon or Armour to apply its effect to that item. Once socketed it cannot be retrieved but can be replaced by other Augment items.</div>
  <div class="line" id="t10">Place into an allocated Jewel Socket on the Passive Skill Tree. Right click to remove from the Socket.</div>

  <!-- 圖5:任務分段標題 -->
  <div class="line" id="t11">Interludes</div>

  <!-- 圖5:任務獎勵名「地區 - 任務」(poe.ninja 以連結拆成獨立節點) -->
  <div class="line" id="t12"><a>Eye of Hinekora</a> - <a>Tribal Medicine</a></div>
  <div class="line" id="t13"><a>Halls of the Dead</a> - <a>Ngamahu's Test</a></div>

  <!-- 第二輪截圖(圖14-19):傳奇名 / 物品屬性標籤 / 賦予技能 -->
  <div class="line" id="t14"><a>Wake of Destruction</a></div>
  <div class="line" id="t15">Attacks per Second: <span>2.09</span></div>
  <div class="line" id="t16">Grants Skill: Level 18 <a>灰燼之捷</a></div>
  <div class="line" id="t17">需求: <span>等級 48</span>, <span>12 Str</span>, <span>25 Dex</span></div>

  <!-- 第三輪(圖20-22):屬性拆 span / 賦予技能含技能名 / Runic Ward -->
  <div class="line" id="t18">需求: 等級 78, <span>67</span> <span>Str</span>, <span>67</span> <span>Dex</span></div>
  <div class="line" id="t19">Grants Skill: Level 18 Herald of Ash</div>
  <div class="line" id="t20">Runic Ward: 258</div>

  <!-- 第四輪(圖25/26):傳奇風味文字(flavour),poe.ninja 每行一個節點 -->
  <div class="line" id="t21">Whiff of cold, tiny spark, faintest flicker in the dark.</div>

  <!-- 第五輪(圖28-31):傳奇詞綴數值範圍 (min-max) + rune [[ ]] 括號 -->
  <div class="line" id="t22">(252-340)% increased <span>Physical</span> Damage</div>
  <div class="line" id="t23">[[ 49% increased <span>Lightning</span> Damage ]]</div>
  <div class="line" id="t24">Adds (156-199) to (352-400) <span>Cold</span> Damage</div>

  <!-- 第六輪(圖33/34):遺物/碑牌傳奇名(不在 UniqueStashLayout,改用多字 Words.Text2) -->
  <div class="line" id="t25"><a>The Last Flame</a></div>
  <div class="line" id="t26"><a>Visions of Paradise</a></div>

  <!-- 第七輪(圖35-37 藥劑、圖38 魔像):ClientStrings 藥劑模板 + (Bonded) 標籤 -->
  <div class="line" id="t27">Recovers (920-1104) <span>Life</span> over 3 Seconds</div>
  <div class="line" id="t28">Consumes (20-25) of 75 <span>Charges</span> on use</div>
  <div class="line" id="t29">Body Armour (Bonded): 有 15% 機率不消耗充能</div>

  <!-- 第八輪(圖39/42):ClientStrings 自動長句 + Martial Weapon (Bonded) -->
  <div class="line" id="t30">This Skill will copy the Level of the Gem it is Socketed in</div>
  <div class="line" id="t31">Martial Weapon (Bonded): 增加 15% 凋零幅度</div>

  <!-- 圖1 妄想症:附魔殘留標記 {enchant} + Allocates 天賦名(天賦名拆 span) -->
  <div class="line" id="g1">{enchant}Allocates <a>Mind Eraser</a></div>
  <div class="line" id="g1b">{enchant}Allocates Struck Through</div>

  <!-- 圖4 妄想症(卡片):Allocates Passive Skill(通用佔位,Passive Skill 拆 span) -->
  <div class="line" id="g2">Allocates <a>Passive Skill</a></div>

  <!-- 圖2/3 珠寶範圍 Radius: Small / Variable(標籤+值同一節點) -->
  <div class="line" id="g3">Radius: Small</div>
  <div class="line" id="g4">Radius: Variable</div>

  <!-- 圖4/5 卡片:僅限 Limited to -->
  <div class="line" id="g5">Limited to: 1</div>

  <!-- 圖8 Hypnotic Glimmer:巢狀珠寶詞綴(範圍內賦予內層詞綴),內層詞綴拆 span -->
  <div class="line" id="g6">Notable Passive Skills in Radius also grant 1% increased maximum Mana</div>
  <div class="line" id="g7">Notable Passive Skills in Radius also grant 7% increased <a>Critical Hit Chance</a> for Spells</div>
  <div class="line" id="g8">Small Passive Skills in Radius also grant 3% increased Cast Speed</div>

  <!-- 圖9/11/12 從無到有:Passives in Radius of <Notable> can be Allocated… -->
  <div class="line" id="g9">Passives in Radius of <a>Eldritch Battery</a> can be Allocated without being connected to your tree</div>
  <div class="line" id="g10">Passives in Radius of Ancestral Bond can be Allocated without being connected to your tree</div>

  <!-- sentinel:確認引擎已初始化(Energy Shield→能量護盾) -->
  <div id="sentinel">Energy Shield</div>
</body>`;

const dom = new JSDOM(`<!DOCTYPE html><html>${HTML}</html>`, { runScripts: 'outside-only' });
const { window } = dom;

// ---- stub chrome.runtime.getURL + fetch(讀本地 data/*.json) ----
window.chrome = {
  runtime: { getURL: (f) => join(base, f) },
  storage: { local: { get: () => Promise.reject(new Error('no storage in test')) } },
};
window.fetch = (p) =>
  Promise.resolve({ json: () => Promise.resolve(JSON.parse(readFileSync(p, 'utf8'))) });

// 在 window 作用域執行真正的 translator.js(識別子 chrome/fetch/document 都解析到 window)
window.eval(translatorCode);

// 等 init() 非同步載入字典 + 首次 walk 完成(以 sentinel 變中文為準)
async function waitReady(timeoutMs = 8000) {
  const t0 = Date.now();
  for (;;) {
    if (window.document.getElementById('sentinel').textContent.includes('能量護盾')) return;
    if (Date.now() - t0 > timeoutMs) throw new Error('translator 初始化逾時(sentinel 未翻譯)');
    await new Promise((r) => window.setTimeout(r, 50));
  }
}

const txt = (id) => window.document.getElementById(id).textContent;
const hasEng = (s) => /[A-Za-z]/.test(s);

// 每個檢查:目標節點不得殘留英文,且(可選)須含指定中文
const CHECKS = [
  { id: 't1', must: '技能', desc: '圖3 +2 to Level of all Spark Skills(拆span)' },
  { id: 't1b', must: '技能', desc: '圖3 +2 to Level of all Spark Skills(整句)' },
  { id: 't2', must: '能量護盾', desc: '圖4 Convert ES to Mana' },
  { id: 't3', must: '魔力消耗加倍', desc: '圖4 Mana Costs are Doubled' },
  { id: 't4', must: '智慧', desc: '圖1 Requires:…Int(單節點:標籤+屬性翻出)' },
  { id: 't4b', must: '需求', noEng: true, desc: '圖1 Requires: Level 65, 121 Int(真實拆 span,零英文)' },
  { id: 't5', must: '堆疊數量', desc: '圖2 Stack Size: 1/10' },
  { id: 't6', must: '符文', desc: '圖2 類別 Rune' },
  { id: 't7', must: '易怒', desc: '圖6 類別 Short Fuse' },
  { id: 't8', must: '輔助寶石需求', desc: '圖6 Support Gem Requirements: +5 Str (5)' },
  { id: 't9', must: '符文插槽', desc: '圖2 符文 placement' },
  { id: 't10', must: '珠寶插槽', desc: '圖3 珠寶 placement' },
  { id: 't11', must: '間歇', desc: '圖5 Interludes' },
  { id: 't12', must: '悉妮蔻拉之眼', noEng: true, desc: '圖5 任務獎勵 Eye of Hinekora - Tribal Medicine' },
  { id: 't13', must: '亡者之殿', noEng: true, desc: '圖5 任務獎勵 Halls of the Dead - Ngamahu\'s Test' },
  { id: 't14', must: '覆滅之兆', noEng: true, desc: '圖17 傳奇名 Wake of Destruction' },
  { id: 't15', must: '每秒攻擊次數', noEng: true, desc: '圖19 Attacks per Second: 2.09' },
  { id: 't16', must: '賦予技能', noEng: true, desc: '圖16 Grants Skill: Level 18 …(標籤+Level+技能)' },
  { id: 't17', must: '敏捷', noEng: true, desc: '圖19 需求 …12 Str, 25 Dex(拆 span,零英文)' },
  { id: 't18', must: '力量', noEng: true, desc: '圖20 需求 67 Str, 67 Dex(數字與Str拆不同span)' },
  { id: 't19', must: '灰燼之捷', noEng: true, desc: '圖20 賦予技能: Level 18 Herald of Ash(rest 含技能名)' },
  { id: 't20', must: '符文保護', noEng: true, desc: '圖20 Runic Ward: 258' },
  { id: 't21', must: '冷颼颼', noEng: true, desc: '圖26 傳奇風味文字 flavour(逐行)' },
  { id: 't22', must: '物理傷害', noEng: true, desc: '圖28 範圍詞綴 (252-340)% increased Physical Damage' },
  { id: 't23', must: '閃電傷害', noEng: true, desc: '圖28 rune 詞綴 [[ 49% increased Lightning Damage ]]' },
  { id: 't24', must: '冰冷傷害', noEng: true, desc: '圖29 雙範圍 Adds (156-199) to (352-400) Cold Damage' },
  { id: 't25', must: '終焉烈焰', noEng: true, desc: '圖33 遺物名 The Last Flame' },
  { id: 't26', must: '天堂異象', noEng: true, desc: '圖34 碑牌名 Visions of Paradise' },
  { id: 't27', must: '回復', noEng: true, desc: '圖35 藥劑 Recovers (920-1104) Life over 3 Seconds' },
  { id: 't28', must: '充能', noEng: true, desc: '圖35 藥劑 Consumes (20-25) of 75 Charges on use' },
  { id: 't29', must: '胸甲（命定）', noEng: true, desc: '圖38 魔像 Body Armour (Bonded): …' },
  { id: 't30', must: '此技能會複製', noEng: true, desc: '圖39 ClientStrings 自動長句 This Skill will copy…' },
  { id: 't31', must: '軍用武器（命定）', noEng: true, desc: '圖42 魔像 Martial Weapon (Bonded): …(官方:軍用武器)' },
  // 寶石(珠寶)顯示修正
  { id: 'g1', must: '配置心靈抹除', noEng: true, desc: '圖1 妄想症 {enchant}Allocates Mind Eraser' },
  { id: 'g1b', must: '配置擊穿防禦', noEng: true, desc: '圖1 妄想症 {enchant}Allocates Struck Through' },
  { id: 'g2', must: '配置天賦', noEng: true, desc: '圖4 妄想症卡片 Allocates Passive Skill' },
  { id: 'g3', must: '範圍：小', noEng: true, desc: '圖2 珠寶 Radius: Small' },
  { id: 'g4', must: '範圍：可變的', noEng: true, desc: '圖3 珠寶 Radius: Variable' },
  { id: 'g5', must: '僅限', noEng: true, desc: '圖4 卡片 Limited to: 1' },
  { id: 'g6', must: '範圍內核心天賦也會賦予 增加', noEng: true, desc: '圖8 巢狀:Notable…grant 1% increased maximum Mana' },
  { id: 'g7', must: '範圍內核心天賦也會賦予', noEng: true, desc: '圖8 巢狀:Notable…grant 7% …Crit for Spells' },
  { id: 'g8', must: '範圍內小型天賦也會賦予', noEng: true, desc: '圖8 巢狀:Small…grant 3% increased Cast Speed' },
  { id: 'g9', must: '範圍異能魔力內的天賦可以在沒有連結你的天賦樹下被配置', noEng: true, desc: '圖9 從無到有 of Eldritch Battery' },
  { id: 'g10', must: '範圍先祖魂約內的天賦可以在沒有連結你的天賦樹下被配置', noEng: true, desc: '圖12 從無到有 of Ancestral Bond' },
];

(async () => {
  await waitReady();
  let pass = 0;
  const fails = [];
  for (const c of CHECKS) {
    const t = txt(c.id);
    const okMust = !c.must || t.includes(c.must);
    // noEng:整句不得殘留英文字母;否則只要求含指定中文且非原英文
    const okEng = c.noEng ? !hasEng(t) : true;
    if (okMust && okEng) {
      pass++;
      console.log(`  ✅ ${c.desc} → "${t}"`);
    } else {
      fails.push(c);
      console.log(`  ❌ ${c.desc} → "${t}"  ${okMust ? '' : '(缺「' + c.must + '」)'}${okEng ? '' : '(殘留英文)'}`);
    }
  }
  console.log(`\n截圖重現:${pass}/${CHECKS.length} 通過`);

  // ---- 中英切換按鈕測試 ----
  console.log('\n中英切換按鈕:');
  let togglePass = 0;
  const tfail = [];
  const btn = window.document.querySelector('.pob-zh-toggle');
  const check = (name, cond, got) => {
    if (cond) { togglePass++; console.log(`  ✅ ${name}${got ? ' → "' + got + '"' : ''}`); }
    else { tfail.push(name); console.log(`  ❌ ${name}${got ? ' → "' + got + '"' : ''}`); }
  };
  check('按鈕已注入頁面', !!btn, btn && btn.textContent);
  if (btn) {
    check('初始顯示中文(符文)', txt('t6') === '符文', txt('t6'));
    check('按鈕文字為 EN', btn.textContent === 'EN', btn.textContent);
    btn.click(); // 切到英文
    check('切到英文:詞綴行還原(Rune)', txt('t6') === 'Rune', txt('t6'));
    check('切到英文:整列容器還原(g1 含 Allocates)', /Allocates/.test(txt('g1')), txt('g1'));
    check('切到英文:按鈕文字為 中', btn.textContent === '中', btn.textContent);
    btn.click(); // 切回中文
    check('切回中文:詞綴行重新翻譯(符文)', txt('t6') === '符文', txt('t6'));
    check('切回中文:整列容器重新翻譯(配置心靈抹除)', txt('g1').includes('配置心靈抹除'), txt('g1'));
    check('切回中文:按鈕文字為 EN', btn.textContent === 'EN', btn.textContent);
  }
  console.log(`\n按鈕切換:${togglePass} 項通過`);

  if (fails.length || tfail.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
