/**
 * translator.js — 在 poe.ninja 把英文遊戲術語/名稱/詞綴即時換成繁中
 *
 * 字典來源:
 *   data/dict.json           名稱(POEDB + 遊戲資料匯出:技能/職業/傳奇/通貨/底材/天賦…)
 *   data/ui-labels.json      poe.ninja 介面固定標籤
 *   data/stat-templates.json 詞綴模板(來自遊戲 stat_descriptions，含 {N} 佔位符)
 *
 * 原理:只改文字節點與顯示屬性的「值」,絕不增刪/替換元素節點 → React 的 DOM
 * 結構完整保留(不會觸發 removeChild 崩潰)、行內連結/圖示不消失、所有功能照常。
 *   - 整行詞綴合併(statLinePass):譯文寫進該行第一個有字的文字節點,其餘文字
 *     節點清空 — 元素骨架(span/a/img)原地保留。
 *   - 可逆:每個被改的文字節點存原文 node.__pobOrig;切回英文時走訪即時 DOM
 *     還原(脫離 DOM 的節點自然被 GC,不另外持有引用 → 無記憶體洩漏)。
 *   - 自我寫入回音:寫入時記 node.__pobSet;MutationObserver 收到的變更若值
 *     等於 __pobSet 即是自己造成的,忽略;不等則是網站更新(React 重繪/即時
 *     資料),重置原文快照並重新翻譯 → 原文永不過期、也不會自我循環重掃。
 */

(() => {
  'use strict';

  // 不進入翻譯的標籤(避免動到輸入框、程式碼、PoB 代碼等)
  const SKIP_TAGS = new Set(['INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'CODE', 'PRE', 'SELECT', 'OPTION']);
  // 不進入翻譯的 class(本擴充自己注入的元素,如中英切換按鈕、中文搜尋框)
  const SKIP_CLASS = ['pob-zh-toggle', 'pob-zh-search'];

  // 中英切換狀態:true = 顯示中文(預設);false = 還原英文。
  let enabled = true;

  // 未翻譯字串收集器(資料驅動消英文):走完所有比對仍是英文的字串收進來,
  // Alt+點右下按鈕 → console 印出 + 複製到剪貼簿,直接餵白名單流程。
  const misses = new Set();
  const MISS_CAP = 1000;
  // 刻意保留英文的品牌/專名 → 不收進清單(降噪)
  const KEEP_ENGLISH = new Set([
    'poe.ninja', 'Discord', 'wiki', 'POE 1', 'POE 2', 'PoE 1', 'PoE 2',
    'Path of Building', 'Grinding Gear Games', 'GGG',
  ]);

  // 設定文字節點值:首次先保存原文(供切回英文還原),並記回音標記。
  function setNodeValue(node, val) {
    if (node.__pobOrig === undefined) node.__pobOrig = node.nodeValue;
    node.nodeValue = val;
    node.__pobSet = val;
  }

  let uiMap = null;          // 小寫標籤 -> 中文
  let nameMap = null;        // 精確英文名 -> 中文
  let reverseNameMap = null; // 中文名 -> 英文名(搜尋接管用:讓中文項也能用英文搜)
  let keepNames = null;      // 官方保留英文的名稱(整行)→ 不得翻其中任何片段(防「Legacy of 鑽石」)
  let multiWordRegex = null; // 多字名稱的子字串比對
  let multiWordLookup = null;// 小寫多字名 -> 中文
  let multiWordFirst = null; // 多字名稱「首詞」集合(便宜預過濾,免得每個節點都跑大 regex)
  let statTemplates = null;  // 詞綴模板:bucketKey -> [{en, zh}]
  let textStats = null;      // 含文字佔位符(技能名等)的模板:已預編 {re, order, zh}
  let descMap = null;        // 整句描述:正規化英文 -> 中文
  const statRegexCache = new Map();

  // 屬性縮寫(poe.ninja 物品需求:"121 Int" / "+5 Str")→ 官方全名
  const ATTR_ABBR = { str: '力量', dex: '敏捷', int: '智慧' };
  function translateAttrAbbr(s) {
    // 「標籤:值」的值部分:屬性縮寫 + 「Level N / Level (N-N)」(賦予技能/需求等)→ 等級 …
    // Level 後面接數字或括號範圍才換(用 lookahead 不吃掉值);避免動到「Level of all」。
    return s
      .replace(/\bLevel\s+(?=[\d(])/g, '等級 ')
      .replace(/([+-]?\d+)\s+(Str|Dex|Int)\b/gi, (m, num, a) => num + ' ' + ATTR_ABBR[a.toLowerCase()]);
  }

  // 數值欄單位(官方:魔力/生命/精魂;ClientStrings「Sec→秒」「Ward→保護」)
  const UNIT_WORD = {
    mana: '魔力', life: '生命', spirit: '精魂', ward: '保護',
    sec: '秒', secs: '秒', seconds: '秒',
  };

  // poe.ninja 站方 UI 樣式(整節點比對,零誤判):相對時間、寶石等級來源、(Max)
  const TIME_WORD = { second: '秒', minute: '分鐘', hour: '小時', day: '天', week: '週', month: '個月', year: '年' };
  const LEVEL_SRC = { gem: '寶石', corruption: '污染', support: '輔助寶石' };
  const SITE_PATTERNS = [
    { re: /^(a|an|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i,
      zh: (m) => (/^an?$/i.test(m[1]) ? '1' : m[1]) + ' ' + TIME_WORD[m[2].toLowerCase()] + '前' },
    { re: /^([+-]?\d+)\s+Levels?\s+from\s+(Gem|Corruption|Support)(\s*\(Max\))?$/i,
      zh: (m) => '來自' + LEVEL_SRC[m[2].toLowerCase()] + ' ' + m[1] + ' 等' + (m[3] ? '（上限）' : '') },
    { re: /^(\d+)\s*\(Max\)$/i, zh: (m) => m[1] + '（上限）' },
  ];

  // 符文等「物品類型限制: 詞綴」前綴的中文(找不到就維持英文,詞綴照樣翻)。
  // 用詞以 ClientStrings 官方為準:Martial Weapon→軍用武器、Crossbow→十字弓、
  // Wand or Staff→法杖或長杖、Quiver→箭袋(2026-06-10 查證)。
  const RUNE_PREFIX = {
    'martial weapon': '軍用武器', 'wand or staff': '法杖或長杖', 'caster weapon': '施法武器',
    'armour': '護甲', 'martial weapon or focus': '軍用武器或法器', 'focus': '法器',
    'bow': '弓', 'crossbow': '十字弓', 'quiver': '箭袋', 'shield': '盾',
  };

  // 詞綴數值樣式:傳奇物品在 poe.ninja 以「數值範圍」顯示詞綴(min-max 卷軸範圍),
  // 如「(252-340)% increased Physical Damage」「+(3-4) to Level of all …」。
  // 故數值樣式要同時認:① 括號範圍 (N-N) / +(N-N) ② 一般單一數字。
  // 範圍分支放前面(較長優先),整個 (N-N) 視為單一佔位符值,才能對上模板 {0}。
  const NUM_PLAIN = '[+-]?\\d+(?:[.,]\\d+)*';
  const STAT_NUM = '[+-]?\\((?:\\d+(?:[.,]\\d+)*)-(?:\\d+(?:[.,]\\d+)*)\\)|' + NUM_PLAIN;
  const statNumRe = new RegExp(STAT_NUM, 'g');
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const processed = new WeakSet();

  function buildIndexes(dict, ui, stats) {
    // 官方保留英文的名稱:資料側(dict.keepNames,未來由 build 產出)∪ 手工(ui-labels keepEnglish)。
    // 新傳奇/新底材常不在舊資料表 → 先手工列入避免片段亂翻;等官方繁中入字典後 nameMap 優先。
    keepNames = new Set([...(dict && dict.keepNames || []), ...(ui && ui.keepEnglish || [])]);
    statTemplates = (stats && stats.templates) || null;
    // 含文字佔位符的模板(如「+{0} to Level of all {1} Skills」,{1}=技能名)→ 預編 regex。
    textStats = compileTextStats((stats && stats.textTemplates) || []);
    descMap = new Map();
    for (const [en, zh] of Object.entries((dict && dict.descriptions) || {})) {
      descMap.set(en.replace(/\s+/g, ' ').trim(), zh);
    }
    uiMap = new Map();
    // 先放自動產生的 UI 字典(物品類別/職業名等,來自官方表),
    // 再放手工 ui-labels.json — 手工的優先權較高,會覆蓋自動的。
    for (const [en, zh] of Object.entries((dict && dict.uiAuto) || {})) {
      uiMap.set(en.toLowerCase(), zh);
    }
    for (const [en, zh] of Object.entries(ui.labels || {})) {
      if (en.startsWith('_')) continue;
      uiMap.set(en.toLowerCase(), zh);
    }

    nameMap = new Map();
    reverseNameMap = new Map();
    const multiWord = [];
    for (const [en, zh] of Object.entries(dict.names || {})) {
      nameMap.set(en, zh);
      // 中文 -> 英文(第一個出現的英文為準;搜尋接管讓中文項也可用英文搜)
      if (!reverseNameMap.has(zh)) reverseNameMap.set(zh, en);
      if (en.includes(' ') && en.length >= 5) multiWord.push(en);
    }

    // 多字名稱：長的優先，避免短名先吃掉長名的一部分
    multiWord.sort((a, b) => b.length - a.length);
    multiWordLookup = new Map(multiWord.map((en) => [en.toLowerCase(), nameMap.get(en)]));
    if (multiWord.length) {
      const escaped = multiWord.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      // 前後不可緊鄰英數，避免切到別的單字中間
      multiWordRegex = new RegExp('(?<![A-Za-z0-9])(' + escaped.join('|') + ')(?![A-Za-z0-9])', 'gi');
      // 首詞集合:節點文字若不含任何多字名的首詞,直接跳過大 regex(7000+ 選項)
      multiWordFirst = new Set();
      for (const en of multiWord) {
        const m = en.toLowerCase().match(/[a-z0-9']+/);
        if (m) multiWordFirst.add(m[0]);
      }
    }
  }

  // 便宜預過濾:文字含任一多字名首詞才值得跑 multiWordRegex
  function mayContainMultiWord(s) {
    if (!multiWordFirst) return false;
    const tokens = s.toLowerCase().match(/[a-z0-9']+/g);
    if (!tokens) return false;
    for (const t of tokens) if (multiWordFirst.has(t)) return true;
    return false;
  }

  // 把英文模板(含 {N})編成 { re, order }:逐段 escape 字面、{N} 換成數字捕獲。
  // 逐段處理可保留模板中的「字面數字」(例如 "for 6 seconds") 不被當成佔位符。
  function compileStat(en) {
    let cached = statRegexCache.get(en);
    if (cached !== undefined) return cached;
    let pattern = '';
    let last = 0;
    const order = [];
    const phRe = /\{(\d+)\}/g;
    let pm;
    while ((pm = phRe.exec(en))) {
      pattern += escapeRe(en.slice(last, pm.index)) + '(' + STAT_NUM + ')';
      order.push(Number(pm[1]));
      last = pm.index + pm[0].length;
    }
    pattern += escapeRe(en.slice(last));
    let re = null;
    try { re = new RegExp('^' + pattern + '$'); } catch (e) { re = null; }
    cached = re ? { re, order } : null;
    statRegexCache.set(en, cached);
    return cached;
  }

  // 把含文字佔位符的模板預編:文字 {N} → 捕文字(技能名)、數字 {N} → 捕數字。
  // text 陣列標記哪些 {N} 是文字佔位符(由 build-stats 從 specific_skill handler 推得)。
  function compileTextStats(list) {
    const out = [];
    for (const tpl of list) {
      const textIdx = new Set(tpl.text || []);
      let pattern = '';
      let last = 0;
      const order = [];
      const phRe = /\{(\d+)\}/g;
      let pm;
      while ((pm = phRe.exec(tpl.en))) {
        pattern += escapeRe(tpl.en.slice(last, pm.index));
        const idx = Number(pm[1]);
        const isText = textIdx.has(idx);
        pattern += isText ? '(.+?)' : '(' + STAT_NUM + ')';
        order.push({ idx, isText });
        last = pm.index + pm[0].length;
      }
      pattern += escapeRe(tpl.en.slice(last));
      try { out.push({ re: new RegExp('^' + pattern + '$'), order, zh: tpl.zh }); } catch (e) { /* skip */ }
    }
    return out;
  }

  // 文字佔位符模板比對:命中後,文字佔位符捕到的英文(技能名)再用 nameMap 翻成中文。
  function translateTextStat(line) {
    if (!textStats) return null;
    for (const ts of textStats) {
      const mt = line.match(ts.re);
      if (!mt) continue;
      const values = {};
      ts.order.forEach((o, k) => {
        let v = mt[k + 1];
        // 文字佔位符可能是:① 技能/天賦名(nameMap)② 內層詞綴(珠寶巢狀詞綴,如
        //「Notable Passive Skills in Radius also grant 1% increased maximum Mana」的內層
        //「1% increased maximum Mana」→ 遞迴翻譯)③ UI 詞(uiMap);都找不到才保留原文。
        if (o.isText) {
          v = (nameMap && nameMap.get(v)) ||
              translateLine(v.replace(/\s+/g, ' ').trim()) ||
              (uiMap && uiMap.get(v.toLowerCase())) || v;
        }
        values[o.idx] = v;
      });
      const zh = ts.zh.replace(/\{(\d+)\}/g, (_, idx) => (idx in values ? values[idx] : '{' + idx + '}'));
      return panguSpace(zh);
    }
    return null;
  }

  // 詞綴:把整行英文敘述比對 stat 模板 → 套用中文模板
  // 例:"8% increased Skill Effect Duration" -> "增加8%技能效果持續時間"
  // 在中文與數字/英數之間補空白(poedb 風格):增加 37% 最大生命
  function panguSpace(s) {
    return s
      .replace(/([一-鿿])([A-Za-z0-9+\-(])/g, '$1 $2')
      .replace(/([A-Za-z0-9%％)\]])([一-鿿])/g, '$1 $2');
  }

  function translateStat(line) {
    if (!statTemplates) return null;
    statNumRe.lastIndex = 0;
    const key = line.replace(statNumRe, '{}');
    const cands = statTemplates[key];
    if (cands) {
      for (const cand of cands) {
        const c = compileStat(cand.en);
        if (!c) continue;
        const mt = line.match(c.re);
        if (!mt) continue;
        const values = {};
        c.order.forEach((idx, k) => { values[idx] = mt[k + 1]; });
        const zh = cand.zh.replace(/\{(\d+)\}/g, (_, idx) => (idx in values ? values[idx] : '{' + idx + '}'));
        return panguSpace(zh);
      }
    }
    // 數字桶沒命中 → 試含文字佔位符的模板(技能等級詞綴等)
    return translateTextStat(line);
  }

  // poe.ninja 在附魔/工藝等詞綴前會殘留顯示標記(如「{enchant}Allocates …」)。
  // 這些是顯示用標籤、非遊戲 stat 內文 → 比對前剝除,讓詞綴模板能正常命中。
  const ENCHANT_TAG_RE = /^\{(?:enchant|crafted|fractured|scourge|veiled|implicit|explicit|rune|corrupted|enchanted)\}\s*/i;

  // 整行翻譯:① 整句描述精確比對 ② 詞綴模板 ③「前綴: 詞綴」(符文)
  function translateLine(norm) {
    norm = norm.replace(ENCHANT_TAG_RE, '');
    if (descMap) {
      const d = descMap.get(norm);
      if (d) return d;
    }
    const s = translateStat(norm);
    if (s) return s;
    const m = norm.match(/^(.{1,30}?):\s+(.+)$/);
    if (m) {
      const stat = translateStat(m[2]);
      if (stat) {
        const prefix = RUNE_PREFIX[m[1].toLowerCase()] || (uiMap && uiMap.get(m[1].toLowerCase())) || m[1];
        return prefix + '：' + stat;
      }
    }
    // 符文/附魔詞綴在 poe.ninja 以「[[ … ]]」包住(或單層 [ … ])→ 剝括號翻內層再包回
    const br = norm.match(/^(\[+)\s*(.+?)\s*(\]+)$/);
    if (br) {
      const inner = translateLine(br[2]);
      if (inner) return br[1] + ' ' + inner + ' ' + br[3];
    }
    return null;
  }

  // 是否該跳過這個文字節點
  function shouldSkip(node) {
    let el = node.parentElement;
    while (el) {
      // SVG 元素的 tagName 是小寫(HTML 才是大寫)→ 統一大寫比對,
      // 否則 svg 內的 <style> CSS 文字會漏進翻譯流程。
      if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
      if (el.tagName.toUpperCase() === 'SVG') return true;
      if (el.isContentEditable) return true;
      for (const c of SKIP_CLASS) if (el.classList && el.classList.contains(c)) return true;
      el = el.parentElement;
    }
    return false;
  }

  // 截斷字串(表格欄寬不夠時 poe.ninja 以「…」收尾,如「Unique Accessor...」):
  // 拿省略號前的前綴去比對 UI/名稱字典,「唯一命中」才翻(多個候選歧義就不動)。
  function lookupTruncated(prefix) {
    if (!prefix || prefix.length < 4) return null;
    const p = prefix.toLowerCase();
    const hits = new Set();
    for (const [k, zh] of uiMap) {
      if (k.startsWith(p)) { hits.add(zh); if (hits.size > 1) return null; }
    }
    if (hits.size === 1) return hits.values().next().value;
    for (const [k, zh] of nameMap) {
      if (k.toLowerCase().startsWith(p)) { hits.add(zh); if (hits.size > 1) return null; }
    }
    return hits.size === 1 ? hits.values().next().value : null;
  }

  // 此節點是否位在「官方保留英文的名稱」整行內(往上最多 3 層比對行文字)。
  // 命中且該名稱尚無官方繁中(不在 nameMap)→ 整行任何片段都不得翻。
  function inKeptName(node) {
    if (!keepNames || !keepNames.size) return false;
    let el = node.parentElement;
    for (let i = 0; el && i < 3; i++, el = el.parentElement) {
      const t = el.textContent.replace(/\s+/g, ' ').trim();
      if (t.length > 60) return false;
      // 名稱已有官方繁中(nameMap/uiMap)→ 解除保護,走正常翻譯
      if (keepNames.has(t) && !(nameMap && nameMap.has(t)) && !(uiMap && uiMap.has(t.toLowerCase()))) return true;
    }
    return false;
  }

  // 翻譯單一文字節點，回傳是否有改動。
  // 注意:所有 raw.replace(trimmed, X) 的 X 一律用函式回傳,避免譯文含 $ 被當特殊替換樣式。
  function translateTextNode(node) {
    const raw = node.nodeValue;
    if (!raw) return false;
    const trimmed = raw.trim();
    if (!trimmed) return false;
    // 已是中文(沒有英文字母)就不用處理
    if (!/[A-Za-z]/.test(trimmed)) return false;

    // 保留英文名稱的片段保護(懶計算:多數節點用不到)
    let kept = null;
    const isKept = () => (kept === null ? (kept = inKeptName(node)) : kept);

    // 1) UI 標籤:整個節點精確比對(大小寫無關)
    const ui = uiMap.get(trimmed.toLowerCase());
    if (ui) {
      if (isKept()) return false;
      setNodeValue(node, raw.replace(trimmed, () => ui));
      return true;
    }

    // 2) 名稱:整個節點精確比對
    const exact = nameMap.get(trimmed);
    if (exact) {
      if (isKept()) return false;
      setNodeValue(node, raw.replace(trimmed, () => exact));
      return true;
    }

    // 2b) 截斷字串(結尾省略號)→ 字典前綴唯一命中才翻
    if (/(\.\.\.|…)$/.test(trimmed)) {
      const z = lookupTruncated(trimmed.replace(/(\.\.\.|…)$/, '').trim());
      if (z && !isKept()) {
        setNodeValue(node, raw.replace(trimmed, () => z));
        return true;
      }
    }

    // 3) 詞綴/數據敘述/整句描述:整行比對
    const line = translateLine(trimmed.replace(/\s+/g, ' '));
    if (line) {
      setNodeValue(node, raw.replace(trimmed, () => line));
      return true;
    }

    // 3b) UI「標籤:值」或純標籤+冒號(poe.ninja 常見:Requires: / Stack Size: /
    //     Support Gem Requirements: +5 Str)。標籤必須在 UI 字典才翻,值保留並翻屬性縮寫。
    const cm = trimmed.match(/^([A-Za-z][A-Za-z .'/()-]{0,32}?)\s*([:：])\s*(.*)$/);
    if (cm) {
      let labelZh = uiMap.get(cm[1].toLowerCase());
      // 標籤帶「(狀態)」尾綴(魔像詞綴:Body Armour (Bonded) / Sceptre (Bonded))→
      // 翻基礎類別 + 括號內狀態(Bonded→命定),如「胸甲(命定)」。
      if (!labelZh) {
        const pm = cm[1].match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        if (pm) {
          const bk = pm[1].trim().toLowerCase();
          const base = uiMap.get(bk) || RUNE_PREFIX[bk]; // 武器類別(近戰武器/法杖…)重用符文前綴表
          if (base) labelZh = base + '（' + (uiMap.get(pm[2].trim().toLowerCase()) || pm[2].trim()) + '）';
        }
      }
      if (labelZh) {
        const restRaw = cm[3];
        let rest = '';
        if (restRaw) {
          rest = translateAttrAbbr(restRaw);
          // 值整段恰為 UI 詞(如珠寶範圍 Radius: Small→範圍：小、Variable→可變的)→ 直接換
          const restUi = uiMap.get(rest.trim().toLowerCase());
          if (restUi) {
            rest = restUi;
          } else if (multiWordRegex && mayContainMultiWord(rest)) {
            // rest 內可能含名稱(如「賦予技能: 等級 18 Herald of Ash」的技能名)→ 一併翻譯
            multiWordRegex.lastIndex = 0;
            rest = rest.replace(multiWordRegex, (m) => multiWordLookup.get(m.toLowerCase()) || m);
          }
        }
        const out = restRaw ? labelZh + '：' + rest : labelZh + cm[2];
        setNodeValue(node, raw.replace(trimmed, () => out));
        return true;
      }
    }

    // 3c) 屬性需求縮寫:任意節點中「數字 + Str/Dex/Int」(限數字相鄰,安全)
    if (/\d\s+(?:Str|Dex|Int)\b/i.test(trimmed)) {
      const out = translateAttrAbbr(trimmed);
      if (out !== trimmed) {
        setNodeValue(node, raw.replace(trimmed, () => out));
        return true;
      }
    }

    // 3d) 「數字 + 單位」整節點(poe.ninja 數值欄:消耗「56 Mana」、施放時間「0.70 sec」)。
    //     限整個節點恰為此形,零誤判;句子層級的缺漏留給詞綴模板/收集器,不在這裡半翻。
    const um = trimmed.match(/^([+-]?[\d.,]+)\s*(Mana|Life|Spirit|Ward|secs?|seconds)$/i);
    if (um) {
      const zhUnit = UNIT_WORD[um[2].toLowerCase()];
      if (zhUnit) {
        setNodeValue(node, raw.replace(trimmed, () => um[1] + ' ' + zhUnit));
        return true;
      }
    }

    // 3e) 站方 UI 樣式(相對時間「5 minutes ago」、寶石等級來源「20 Levels from Gem (Max)」…)
    for (const p of SITE_PATTERNS) {
      const pm2 = trimmed.match(p.re);
      if (pm2) {
        setNodeValue(node, raw.replace(trimmed, () => p.zh(pm2)));
        return true;
      }
    }

    // 4) 多字名稱:子字串替換(例如 "Level 93 Spirit Walker");先做便宜首詞預過濾
    if (multiWordRegex && mayContainMultiWord(trimmed)) {
      multiWordRegex.lastIndex = 0;
      if (isKept()) return false;
      const out = raw.replace(multiWordRegex, (m) => multiWordLookup.get(m.toLowerCase()) || m);
      if (out !== raw) {
        setNodeValue(node, out);
        return true;
      }
    }

    // 全部沒命中 → 收進未翻譯收集器(Alt+點按鈕匯出),供白名單流程消化。
    // 過濾:CSS/標記類字串、品牌名、保留英文的名稱(整行或片段)、
    // 玩家帳號(含 #/_/@)、純羅馬數字(II/III 武器組編號)。
    if (
      misses.size < MISS_CAP && trimmed.length <= 160 && /[A-Za-z]{2,}/.test(trimmed) &&
      !/[{}<>;]/.test(trimmed) && !/^[.#]/.test(trimmed) && !/[#_@]/.test(trimmed) &&
      !/^[IVXLCDM]+$/.test(trimmed) && !KEEP_ENGLISH.has(trimmed) &&
      !keepNames.has(trimmed) && !isKept()
    ) {
      misses.add(trimmed);
    }
    return false;
  }

  // 區塊級標籤:用來判斷「這個元素是不是單獨一行詞綴」(行容器內只會有 inline 子元素)
  const BLOCK_SEL = 'div,p,ul,ol,li,table,thead,tbody,tr,td,th,section,article,header,footer,nav,h1,h2,h3,h4,h5,h6,hr,form,button';

  function depth(el) {
    let d = 0;
    for (let p = el.parentElement; p; p = p.parentElement) d++;
    return d;
  }

  // 收集元素子樹內所有文字節點(整行合併用)。
  // 排除媒體元素(svg/canvas/picture/video)內部的文字(svg <style>/<text> 等),
  // 讓「圖示 + 詞綴」同行時仍可安全合併(只動行文字,不碰圖示內部)。
  function lineTextNodes(el) {
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const out = [];
    let n;
    while ((n = tw.nextNode())) {
      let inMedia = false;
      for (let p = n.parentElement; p && p !== el; p = p.parentElement) {
        const tag = p.tagName.toUpperCase();
        if (tag === 'SVG' || tag === 'CANVAS' || tag === 'PICTURE' || tag === 'VIDEO') { inMedia = true; break; }
      }
      if (!inMedia) out.push(n);
    }
    return out;
  }

  // 互動元素:hover 會出 lore 彈窗 / 可點擊。整行合併時必須讓它們保有自己的文字,
  // 否則觸發元素被清空 → 彈窗無從觸發(poe.ninja 的觸發器是 span[data-tooltip-trigger])。
  const INTERACTIVE_SEL = 'a,button,[data-tooltip-trigger]';

  // 詞語層級查中文(供分配演算法翻觸發詞):精確名 → UI 詞 → 單複數變化 → 整行規則
  function lookupTerm(en) {
    let zh = (nameMap && nameMap.get(en)) || (uiMap && uiMap.get(en.toLowerCase()));
    if (zh) return zh;
    const sing = en.replace(/ies$/i, 'y').replace(/s$/i, '');
    if (sing !== en) {
      zh = (nameMap && nameMap.get(sing)) || (uiMap && uiMap.get(sing.toLowerCase()));
      if (zh) return zh;
    }
    return translateLine(en);
  }

  // 多觸發詞行的「分配」:整行中文已知,把各觸發詞的中文定位於整行中文內,分段寫回。
  // 例:「All <t>Mage's Legacies</t> have 48% … <t>Mage's Legacy</t> you have」
  //  → 「你每擁有一個重複的<t>魔遺</t>，即增加 48% 所有<t>魔遺</t>效果」(hover lore 保留)。
  // 任一觸發詞無法定位(非組合式譯名)→ 回傳 false,改走其他模式。
  function distributeLine(nodes, zh, triggerEls) {
    const tset = new Set(triggerEls);
    const ownerOf = (n) => {
      for (let p = n.parentElement; p; p = p.parentElement) if (tset.has(p)) return p;
      return null;
    };
    // 依文件順序把文字節點分組:同一觸發元素一組、連續的非觸發節點一組
    const groups = [];
    for (const n of nodes) {
      const o = ownerOf(n);
      const last = groups[groups.length - 1];
      if (last && last.trigger === o) last.nodes.push(n);
      else groups.push({ trigger: o, nodes: [n], text: null, start: -1, end: -1 });
    }
    // 觸發詞由左至右定位(同詞多次出現依序配對)
    let pos = 0;
    for (const g of groups) {
      if (!g.trigger) continue;
      const en = g.nodes.map((n) => n.nodeValue).join('').replace(/\s+/g, ' ').trim();
      if (!en) { g.text = ''; g.start = g.end = pos; continue; }
      const term = lookupTerm(en);
      if (!term) return false;
      const idx = zh.indexOf(term, pos);
      if (idx === -1) return false;
      g.text = term; g.start = idx; g.end = idx + term.length;
      pos = g.end;
    }
    // 非觸發段 = 觸發詞之間的中文;觸發詞前若有未認領的字,掛到前一段
    let cursor = 0;
    let prev = null;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (g.trigger) {
        const gap = zh.slice(cursor, g.start);
        if (gap) { if (prev) prev.text += gap; else g.text = gap + g.text; }
        cursor = g.end;
      } else {
        let next = zh.length;
        for (let j = i + 1; j < groups.length; j++) if (groups[j].trigger) { next = groups[j].start; break; }
        g.text = zh.slice(cursor, next);
        cursor = next;
      }
      prev = g;
    }
    if (cursor < zh.length && prev) prev.text += zh.slice(cursor);
    // 寫回:每段第一個文字節點承載文字,其餘清空
    for (const g of groups) {
      let first = true;
      for (const n of g.nodes) {
        if (first) { setNodeValue(n, g.text); first = false; }
        else if (n.nodeValue && n.nodeValue.trim()) setNodeValue(n, '');
        processed.add(n);
      }
    }
    return true;
  }

  // 整行譯文寫進單一節點(target 未指定 → 第一個有字的節點),其餘清空
  function writeWhole(nodes, zh, target) {
    if (!target) {
      for (const n of nodes) if (n.nodeValue && n.nodeValue.trim()) { target = n; break; }
    }
    if (!target) return false;
    setNodeValue(target, zh);
    processed.add(target);
    for (const n of nodes) {
      if (n === target) continue;
      if (n.nodeValue && n.nodeValue.trim()) setNodeValue(n, '');
      processed.add(n);
    }
    return true;
  }

  // shadow DOM:open shadow root 也要翻(TreeWalker 不會自己進去)。
  const shadowRoots = new Set();
  function adoptShadow(el) {
    const sr = el.shadowRoot;
    if (!sr || shadowRoots.has(sr)) return;
    shadowRoots.add(sr);
    if (observer) observer.observe(sr, OBS_OPTS);
    walk(sr);
  }

  // 詞綴整行:poe.ninja 會把一行詞綴拆成多個節點(關鍵字是獨立 span)。
  // 這裡在「整行容器元素」層級取英文全文比對模板,命中就把完整中文寫進該行
  // 第一個有字的文字節點、其餘文字節點清空 — 元素骨架(span/a/img)原地保留,
  // 不增刪元素 → React 重繪不會崩潰、行內連結與圖示不消失。
  function statLinePass(root) {
    if (!statTemplates) return;
    const els = [];
    if (root.nodeType === 1 && !SKIP_TAGS.has(root.tagName.toUpperCase())) els.push(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(el) {
        if (el.__pobTx) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(el.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
        if (el.classList) for (const c of SKIP_CLASS) if (el.classList.contains(c)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let e;
    while ((e = walker.nextNode())) els.push(e);
    for (const el of els) adoptShadow(el);
    els.sort((a, b) => depth(b) - depth(a)); // 最深(最內層的行)優先
    for (const el of els) {
      if (el.__pobTx || !el.isConnected) continue;    // 已處理 / 已被上層替換而脫離
      if (el.childElementCount === 0) continue;       // 單一文字節點的行 → 交給 translateTextNode
      if (el.querySelector(BLOCK_SEL)) continue;       // 含區塊子元素 → 不是單行
      // 行文字 = 排除媒體內部後的文字節點串接(行內 svg 圖示不會擋住合併)
      const nodes = lineTextNodes(el);
      const norm = nodes.map((n) => n.nodeValue).join('').replace(/\s+/g, ' ').trim();
      if (!norm || !/[A-Za-z]/.test(norm)) continue;
      // 整行比對:描述/詞綴模板 → 名稱/UI 詞(poe.ninja 會把名稱拆成多節點,如「Legacy of <a>…</a>」)
      const zh = translateLine(norm) || (nameMap && nameMap.get(norm)) ||
                 (uiMap && uiMap.get(norm.toLowerCase())) || null;
      if (zh) {
        const triggers = el.querySelectorAll(INTERACTIVE_SEL);
        let done = false;
        // ① 行內有互動元素(tooltip 觸發詞/連結)→ 先試「分配」:各觸發詞保有自己的中文
        if (triggers.length) done = distributeLine(nodes, zh, triggers);
        // ② 分配不了且為短名稱行 + 單一觸發元素(如魔遺「Legacy of <t>Diamond</t>」=寶鑽之遺,
        //    非組合式譯名)→ 整行譯文寫進觸發元素內,hover lore 與樣式保留
        if (!done && triggers.length === 1 && norm.length <= 40) {
          let target = null;
          for (const n of nodes) {
            if (n.nodeValue && n.nodeValue.trim() && triggers[0].contains(n)) { target = n; break; }
          }
          if (target) done = writeWhole(nodes, zh, target);
        }
        // ③ 一般行:寫進第一個有字的文字節點
        if (!done) done = writeWhole(nodes, zh, null);
        if (!done) continue;
        el.__pobTx = true;
      }
    }
  }

  // ---- 顯示屬性翻譯(title 滑鼠提示 / placeholder 搜尋框 / aria-label / alt)----
  // 與文字節點同樣可逆:原值存 el.__pobAttrOrig[attr]、回音標記存 el.__pobAttrSet[attr]。
  const ATTR_LIST = ['title', 'placeholder', 'aria-label', 'alt'];
  const ATTR_SEL = '[title],[placeholder],[aria-label],[alt]';
  function translateElAttrs(el) {
    if (el.closest && el.closest('.' + SKIP_CLASS[0])) return;
    for (const a of ATTR_LIST) {
      const v = el.getAttribute(a);
      if (!v || !/[A-Za-z]/.test(v)) continue;
      // 已翻譯過(持有原文快照)就跳過;__pobAttrSet 只作 observer 回音辨識,
      // 不能在這裡當判斷(切英文還原後它是原文,會誤擋重新翻譯)。
      if (el.__pobAttrOrig && a in el.__pobAttrOrig) continue;
      const t = v.replace(/\s+/g, ' ').trim();
      const zh = uiMap.get(t.toLowerCase()) || nameMap.get(t) || translateLine(t);
      if (zh && zh !== v) {
        if (!el.__pobAttrOrig) el.__pobAttrOrig = {};
        if (!(a in el.__pobAttrOrig)) el.__pobAttrOrig[a] = v;
        el.setAttribute(a, zh);
        if (!el.__pobAttrSet) el.__pobAttrSet = {};
        el.__pobAttrSet[a] = zh;
      }
    }
  }
  function translateAttrs(root) {
    if (!root.querySelectorAll) return;
    if (root.nodeType === 1 && root.matches && root.matches(ATTR_SEL)) translateElAttrs(root);
    for (const el of root.querySelectorAll(ATTR_SEL)) translateElAttrs(el);
  }

  function walk(root) {
    if (!uiMap) return;
    ensureButton();
    if (!enabled) return; // 英文模式:不翻譯(按鈕仍保留)
    root = root || document.body;
    if (!root) return;
    statLinePass(root);
    translateAttrs(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (processed.has(node)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        if (shouldSkip(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const node of nodes) {
      translateTextNode(node);
      processed.add(node);
    }
  }

  // poe.ninja 是 SPA,內容會動態載入 → MutationObserver + debounce 重掃。
  // 只重掃變動的子樹(pendingRoots);太多或含 body 才整頁掃。
  const pendingRoots = new Set();
  let scheduled = false;
  function schedule(target) {
    pendingRoots.add(target || document.body);
    if (scheduled) return;
    scheduled = true;
    const run = () => {
      scheduled = false;
      let roots = Array.from(pendingRoots);
      pendingRoots.clear();
      if (!document.body) return;
      if (roots.length > 24 || roots.indexOf(document.body) !== -1) {
        walk(document.body);
        return;
      }
      roots = roots.filter((r) => r && r.isConnected);
      // 去掉被其他 root 包含的(走訪外層就涵蓋了)
      roots = roots.filter((r) => !roots.some((o) => o !== r && o.contains && o.contains(r)));
      for (const r of roots) walk(r);
    };
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 500 });
    else setTimeout(run, 100);
  }

  // 由變動節點往上找到最近的整行合併容器,清旗標讓它能重新合併
  function resetTxAncestor(node) {
    for (let a = node && node.parentElement; a; a = a.parentElement) {
      if (a.__pobTx) { a.__pobTx = false; return; }
    }
    if (node && node.nodeType === 1 && node.__pobTx) node.__pobTx = false;
  }

  let observer = null;
  const OBS_OPTS = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTR_LIST,
  };
  function startObserver() {
    observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData') {
          const n = m.target;
          // 自我寫入回音(值仍是我們寫的)→ 忽略,避免自我循環重掃
          if (n.__pobSet !== undefined && n.nodeValue === n.__pobSet) continue;
          // 網站更新了這個節點(React 重繪/即時資料)→ 原文快照已過期,重置後重翻
          n.__pobOrig = undefined;
          n.__pobSet = undefined;
          processed.delete(n);
          resetTxAncestor(n);
          schedule(n.parentElement || n.parentNode);
        } else if (m.type === 'attributes') {
          const el = m.target;
          const a = m.attributeName;
          if (el.__pobAttrSet && el.__pobAttrSet[a] === el.getAttribute(a)) continue; // 回音
          if (el.__pobAttrOrig && a in el.__pobAttrOrig) delete el.__pobAttrOrig[a]; // 原值過期
          if (el.__pobAttrSet) delete el.__pobAttrSet[a];
          schedule(el);
        } else if (m.addedNodes.length) {
          // 自己注入的切換按鈕 → 忽略
          if (m.addedNodes.length === 1 && m.addedNodes[0] === toggleBtn) continue;
          if (m.target && m.target.__pobTx) m.target.__pobTx = false;
          resetTxAncestor(m.target);
          schedule(m.target);
        }
      }
    });
    observer.observe(document.body, OBS_OPTS);
    for (const sr of shadowRoots) observer.observe(sr, OBS_OPTS);
  }

  function loadJson(file) {
    return fetch(chrome.runtime.getURL(file)).then((r) => r.json()).catch(() => null);
  }

  // 名稱字典與詞綴模板:若 background 下載的快取 build 比內建新,才採用快取,避免倒退。
  async function loadData() {
    const bundledVer = await loadJson('data/version.json');
    const bundledBuild = (bundledVer && bundledVer.build) || 0;
    try {
      const cache = await chrome.storage.local.get(['dictData', 'statData', 'dataBuild']);
      if (cache && cache.dataBuild > bundledBuild && cache.dictData && cache.dictData.names) {
        return { dict: cache.dictData, stats: cache.statData || (await loadJson('data/stat-templates.json')) };
      }
    } catch (_) {
      /* storage 不可用就用內建 */
    }
    const [dict, stats] = await Promise.all([
      loadJson('data/dict.json'),
      loadJson('data/stat-templates.json'),
    ]);
    return { dict, stats };
  }

  async function loadDicts() {
    const [{ dict, stats }, ui] = await Promise.all([loadData(), loadJson('data/ui-labels.json')]);
    return { dict, ui, stats };
  }

  // ---- 中英切換按鈕 ----
  const PREF_KEY = 'pobShowZh';
  function persistPref(v) {
    try { chrome.storage.local.set({ [PREF_KEY]: v }); } catch (_) { /* ignore */ }
    try { localStorage.setItem(PREF_KEY, v ? '1' : '0'); } catch (_) { /* ignore */ }
  }
  async function loadPref() {
    try {
      const r = await chrome.storage.local.get(PREF_KEY);
      if (r && typeof r[PREF_KEY] === 'boolean') return r[PREF_KEY];
    } catch (_) { /* ignore */ }
    try {
      const l = localStorage.getItem(PREF_KEY);
      if (l !== null) return l === '1';
    } catch (_) { /* ignore */ }
    return true; // 預設顯示中文
  }

  // 未翻譯收集器匯出:console 印出 + 盡量複製進剪貼簿
  function dumpMisses() {
    const arr = Array.from(misses).sort();
    const json = JSON.stringify(arr, null, 2);
    console.log('[PoB Translator] 未翻譯字串 ' + arr.length + ' 筆:\n' + json);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(json);
    } catch (_) { /* ignore */ }
  }

  let toggleBtn = null;
  function updateButton() {
    if (!toggleBtn) return;
    toggleBtn.textContent = enabled ? 'EN' : '中';
    toggleBtn.title = (enabled ? '切換為英文(顯示原文)' : '切換為中文') + '；Alt+點擊:匯出未翻譯字串';
    toggleBtn.setAttribute('aria-label', enabled ? '切換為英文' : '切換為中文');
  }
  function ensureButton() {
    if (!document.body) return;
    if (toggleBtn && toggleBtn.isConnected) return;
    if (!toggleBtn) {
      toggleBtn = document.createElement('div');
      toggleBtn.className = 'pob-zh-toggle';
      toggleBtn.setAttribute('role', 'button');
      toggleBtn.setAttribute('tabindex', '0');
      toggleBtn.style.cssText = [
        'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
        'min-width:40px', 'height:40px', 'padding:0 12px', 'box-sizing:border-box',
        'display:flex', 'align-items:center', 'justify-content:center',
        'font:600 15px/1 system-ui,sans-serif', 'color:#fff', 'cursor:pointer',
        'background:#b8860b', 'border:1px solid #e0c060', 'border-radius:20px',
        'box-shadow:0 2px 8px rgba(0,0,0,.5)', 'user-select:none', 'opacity:0.9',
      ].join(';');
      toggleBtn.addEventListener('mouseenter', () => { toggleBtn.style.opacity = '1'; });
      toggleBtn.addEventListener('mouseleave', () => { toggleBtn.style.opacity = '0.9'; });
      toggleBtn.addEventListener('click', (e) => {
        if (e.altKey) { dumpMisses(); return; }
        onToggle();
      });
      toggleBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); }
      });
      updateButton();
    }
    document.body.appendChild(toggleBtn);
  }

  // 切回英文:走訪「即時 DOM」還原所有帶原文快照的節點/屬性。
  // 不另外持有節點集合 → 已脫離 DOM 的節點自然被 GC(SPA 長時間瀏覽不洩漏),
  // 且脫離的節點本來就不需要還原。
  function restoreEnglish() {
    const roots = [document.body];
    for (const sr of shadowRoots) if (sr.host && sr.host.isConnected) roots.push(sr);
    for (const root of roots) {
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = tw.nextNode())) {
        if (n.__pobOrig !== undefined) {
          n.nodeValue = n.__pobOrig;
          n.__pobSet = n.__pobOrig; // 還原也是自我寫入,留回音標記
          n.__pobOrig = undefined;
          processed.delete(n); // 之後切回中文時可重新翻譯
        }
      }
      const ew = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let el;
      while ((el = ew.nextNode())) {
        if (el.__pobTx) el.__pobTx = false;
        if (el.__pobAttrOrig) {
          for (const a of Object.keys(el.__pobAttrOrig)) {
            el.setAttribute(a, el.__pobAttrOrig[a]);
            if (el.__pobAttrSet) el.__pobAttrSet[a] = el.__pobAttrOrig[a];
          }
          el.__pobAttrOrig = undefined;
        }
      }
    }
  }

  function onToggle() {
    enabled = !enabled;
    persistPref(enabled);
    updateButton();
    if (enabled) {
      walk(document.body); // 切回中文:重新翻譯整頁
      for (const sr of shadowRoots) if (sr.host && sr.host.isConnected) walk(sr);
    } else {
      restoreEnglish();    // 切到英文:還原原文
    }
  }

  async function init() {
    try {
      // 供 MAIN world 的 search-inject.js 取用擴充資源 URL(讀 React fiber 需在
      // main world;它自 fetch 本擴充內建字典來翻譯/過濾搜尋清單)
      try { document.documentElement.setAttribute('data-pob-base', chrome.runtime.getURL('')); } catch (_) { /* ignore */ }
      enabled = await loadPref();
      const { dict, ui, stats } = await loadDicts();
      buildIndexes(dict, ui, stats);
      walk(document.body);
      startObserver();
      console.log(
        '[PoB Translator] 已載入:名稱 ' + Object.keys(dict.names || {}).length +
        ' 筆、UI ' + Object.keys((ui && ui.labels) || {}).length +
        ' 筆、詞綴模板 ' + ((stats && stats.count) || 0) + ' 筆'
      );
    } catch (e) {
      console.error('[PoB Translator] 初始化失敗:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
