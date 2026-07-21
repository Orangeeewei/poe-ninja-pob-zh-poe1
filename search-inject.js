/**
 * search-inject.js — 在 MAIN world 執行的「中文搜尋接管」。
 *
 * 為什麼要在 MAIN world:
 *   poe.ninja 的過濾清單是 react-window 虛擬捲動,唯一能拿到「完整項目清單」的
 *   方式是讀 DOM 節點上的 React fiber(__reactFiber$…)。那是頁面(main world)的
 *   JS expando 屬性,content script 的 isolated world 讀不到 → 必須在 main world。
 *
 * 資料:自行 fetch 擴充內建的 data/dict.json + data/ui-labels.json 建名稱對照。
 *   擴充資源的絕對 URL 由 isolated 的 translator.js 寫進
 *   <html data-pob-base="chrome-extension://<id>/">,本腳本輪詢等它出現。
 *
 * 原理:讀 fiber 的 resultItems({key:英文名, percentage}),在原生虛擬清單上覆蓋
 *   一個自繪的中文清單(普通排版 → 天然收合),以字典雙向對照做中/英文過濾;點擊時
 *   把原生虛擬清單捲到該項使其渲染出 cell,再派發合成 pointer 事件複用原生選取。
 */
(() => {
  'use strict';

  const RN_ROW_H = 36;      // react-window 行高(px)
  let nameMap = null;       // 英文名 -> 中文
  let uiMap = null;         // 小寫 UI/類別 -> 中文
  let searchInput = null;   // 我方搜尋 input
  const pobLists = [];      // 已接管的原生 .filter-list

  // ---- 過濾比對 ----
  function zhAliasFor(raw) {
    if (!raw) return '';
    let out = '';
    if (nameMap && nameMap.has(raw)) out += nameMap.get(raw);
    if (/[A-Za-z]/.test(raw)) {
      for (const w of raw.split(/\s+/)) {
        const z = (nameMap && nameMap.get(w)) || (uiMap && uiMap.get(w.toLowerCase()));
        if (z) out += z;
      }
    }
    return out;
  }
  function itemHaystack(en, zh) {
    let hay = (zh || '').replace(/\s+/g, '') + (en || '').replace(/\s+/g, '');
    const alias = zhAliasFor(en);
    if (alias) hay += alias.replace(/\s+/g, '');
    return hay.toLowerCase();
  }
  function normQuery() {
    return searchInput ? searchInput.value.replace(/\s+/g, '').toLowerCase() : '';
  }
  function fmtPct(p) {
    if (typeof p !== 'number' || isNaN(p)) return '';
    return (p >= 1 ? Math.round(p) : Math.round(p * 10) / 10) + '%';
  }

  // ---- fiber 讀取 ----
  function readResultItems(listEl) {
    const cell = listEl.querySelector('.filter-list-cell');
    if (!cell) return null;
    const fk = Object.keys(cell).find((k) => k.startsWith('__reactFiber$'));
    if (!fk) return null;
    let f = cell[fk], depth = 0;
    while (f && depth < 30) {
      for (const src of [f.memoizedProps, f.memoizedState]) {
        if (src && typeof src === 'object') {
          for (const key of Object.keys(src)) {
            const v = src[key];
            if (Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object' && 'key' in v[0] && 'percentage' in v[0]) {
              return v;
            }
          }
        }
      }
      f = f.return; depth++;
    }
    return null;
  }

  // ---- 點擊委派 ----
  function findRenderedCell(listEl, index) {
    for (const li of listEl.children) {
      const tr = (li.style && li.style.transform) || '';
      const m = tr.match(/translateY\(\s*([\d.]+)px/);
      if (m && Math.round(parseFloat(m[1]) / RN_ROW_H) === index) {
        return li.querySelector('.filter-list-cell');
      }
    }
    return null;
  }
  function selectNativeItem(listEl, index) {
    listEl.scrollTop = Math.max(0, index * RN_ROW_H - RN_ROW_H);
    let tries = 0;
    const fire = () => {
      const cell = findRenderedCell(listEl, index);
      if (cell) {
        for (const type of ['pointerdown', 'pointerup']) {
          cell.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse' }));
        }
        return;
      }
      if (tries++ < 6) setTimeout(fire, 40);
    };
    requestAnimationFrame(fire);
  }

  // ---- 稀有度顏色採集 ----
  // resultItems 沒有顏色;原生 cell 的 color 是 hsla(var(--item-rare)…)。趁原生 cell
  // 已渲染(即使被設 opacity:0,computed color 仍在)採集真實色,依 key 建快取,並用稀有
  // 度前綴(Rare/Magic/Normal)與該區預設色(唯一物品/技能)補齊未渲染項。
  function harvestColors(listEl, items) {
    const byKey = listEl.__pobColors || (listEl.__pobColors = {});
    const byPrefix = listEl.__pobPrefix || (listEl.__pobPrefix = {});
    for (const li of listEl.children) {
      const tr = (li.style && li.style.transform) || '';
      const m = tr.match(/translateY\(\s*([\d.]+)px/);
      if (!m) continue;
      const it = items[Math.round(parseFloat(m[1]) / RN_ROW_H)];
      if (!it) continue;
      const cell = li.querySelector('.filter-list-cell');
      if (!cell) continue;
      const c = getComputedStyle(cell).color;
      if (!c) continue;
      byKey[it.key] = c;
      const pm = it.key.match(/^(Rare|Magic|Normal)\b/);
      if (pm) byPrefix[pm[1]] = c; else byPrefix.__default = c;
    }
  }
  function colorFor(listEl, key) {
    const byKey = listEl.__pobColors, byPrefix = listEl.__pobPrefix;
    if (byKey && byKey[key]) return byKey[key];
    if (byPrefix) {
      const pm = key.match(/^(Rare|Magic|Normal)\b/);
      if (pm && byPrefix[pm[1]]) return byPrefix[pm[1]];
      if (byPrefix.__default) return byPrefix.__default;
    }
    return '';
  }

  // ---- 自繪清單 ----
  function renderList(listEl) {
    const overlay = listEl.__pobOverlay;
    if (!overlay) return;
    const items = readResultItems(listEl) || listEl.__pobItems || [];
    listEl.__pobItems = items;
    harvestColors(listEl, items);
    const q = normQuery();
    const frag = document.createDocumentFragment();
    items.forEach((it, idx) => {
      const en = it.key;
      const zh = (nameMap && nameMap.get(en)) || en;
      if (q && !itemHaystack(en, zh).includes(q)) return;
      const row = document.createElement('div');
      row.className = 'pob-zh-row';
      const name = document.createElement('span');
      name.className = 'pob-zh-name';
      name.textContent = zh;
      const pct = document.createElement('span');
      pct.className = 'pob-zh-pct';
      pct.textContent = fmtPct(it.percentage);
      row.appendChild(name);
      row.appendChild(pct);
      const col = colorFor(listEl, en);
      if (col) row.style.color = col;
      row.addEventListener('click', () => selectNativeItem(listEl, idx));
      frag.appendChild(row);
    });
    overlay.replaceChildren(frag);
  }
  function renderAllLists() {
    for (const l of pobLists) if (l.isConnected) renderList(l);
  }

  function takeoverList(listEl) {
    if (listEl.__pobOverlay && listEl.__pobOverlay.isConnected) return;
    try {
      if (!readResultItems(listEl)) return; // 資料未就緒,交給 observer/輪詢重試
      const wrap = listEl.parentElement;
      if (!wrap) return;
      if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
      const overlay = document.createElement('div');
      overlay.className = 'pob-zh-search pob-zh-list';
      wrap.appendChild(overlay);
      listEl.style.opacity = '0';
      listEl.style.pointerEvents = 'none';
      listEl.__pobOverlay = overlay;
      if (!pobLists.includes(listEl)) pobLists.push(listEl);
      renderList(listEl);
    } catch (e) {
      console.warn('[PoB Search] takeoverList 失敗:', e);
    }
  }

  function takeoverSearchInput() {
    if (searchInput && searchInput.isConnected) return;
    const orig = [...document.querySelectorAll('input')].find((el) => {
      if (el.classList.contains('pob-zh-search')) return false;
      return /search\s*filters/i.test(el.placeholder || '');
    });
    if (!orig) return;
    const mine = document.createElement('input');
    mine.type = 'text';
    mine.className = (orig.className || '') + ' pob-zh-search';
    mine.setAttribute('data-size', orig.getAttribute('data-size') || 'base');
    mine.autocomplete = 'off';
    mine.placeholder = '搜尋…(中/英)';
    orig.style.display = 'none';
    orig.insertAdjacentElement('afterend', mine);
    mine.addEventListener('input', renderAllLists);
    mine.addEventListener('keydown', (e) => { if (e.key === 'Escape') { mine.value = ''; renderAllLists(); } });
    searchInput = mine;
  }

  function injectSearchCss() {
    if (document.getElementById('pob-zh-css')) return;
    const s = document.createElement('style');
    s.id = 'pob-zh-css';
    s.textContent =
      '.pob-zh-list{position:absolute;inset:0;overflow-y:auto;z-index:3;scrollbar-width:thin;}' +
      '.pob-zh-row{display:flex;justify-content:space-between;align-items:center;height:' + RN_ROW_H + 'px;' +
      'box-sizing:border-box;padding:0 10px;cursor:pointer;font-size:13px;color:#cfcfcf;' +
      'border-bottom:1px solid rgba(255,255,255,.06);}' +
      '.pob-zh-row:hover{background:rgba(255,255,255,.09);}' +
      '.pob-zh-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.pob-zh-pct{margin-left:8px;opacity:.65;font-variant-numeric:tabular-nums;flex:none;}';
    (document.head || document.documentElement).appendChild(s);
  }

  function ensureTakeover() {
    if (!nameMap) return;
    injectSearchCss();
    takeoverSearchInput();
    const lists = document.querySelectorAll('.filter-list');
    for (const listEl of lists) {
      if (listEl.closest('.class-filter-list')) continue; // 職業列不接管
      takeoverList(listEl);
    }
  }

  let searchObserver = null;
  function observeSearch() {
    if (searchObserver) return;
    const target = document.querySelector('.search-page') || document.body;
    let t = null;
    searchObserver = new MutationObserver((muts) => {
      const real = muts.filter((m) => !(m.target.closest && m.target.closest('.pob-zh-list')));
      if (!real.length) return;
      clearTimeout(t);
      t = setTimeout(() => { ensureTakeover(); renderAllLists(); }, 100);
    });
    searchObserver.observe(target, { childList: true, subtree: true });
  }

  function initSearchTakeover() {
    try { ensureTakeover(); observeSearch(); } catch (_) { /* ignore */ }
    setInterval(() => { try { ensureTakeover(); } catch (_) { /* ignore */ } }, 2000);
  }

  // ---- 載入字典(自 fetch 擴充內建 JSON)----
  async function loadDict(base) {
    const j = (p) => fetch(base + p).then((r) => r.json()).catch(() => null);
    const [dict, ui] = await Promise.all([j('data/dict.json'), j('data/ui-labels.json')]);
    if (!dict || !dict.names) return false;
    nameMap = new Map();
    for (const [en, zh] of Object.entries(dict.names)) nameMap.set(en, zh);
    uiMap = new Map();
    for (const [en, zh] of Object.entries(dict.uiAuto || {})) uiMap.set(en.toLowerCase(), zh);
    if (ui && ui.labels) for (const [en, zh] of Object.entries(ui.labels)) { if (!en.startsWith('_')) uiMap.set(en.toLowerCase(), zh); }
    return true;
  }

  // 等 isolated 的 translator.js 把擴充 base URL 寫進 <html data-pob-base>
  let waited = 0;
  (function waitBase() {
    const base = document.documentElement.getAttribute('data-pob-base');
    if (base) { loadDict(base).then((ok) => { if (ok) initSearchTakeover(); }); return; }
    if (waited++ < 100) setTimeout(waitBase, 50); // 最多等 5 秒
    else console.warn('[PoB Search] 等不到 data-pob-base(isolated 未設定?)');
  })();
})();
