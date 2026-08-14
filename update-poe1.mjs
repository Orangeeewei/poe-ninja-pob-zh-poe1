// update-poe1.mjs — PoE1 資料一鍵更新(MCP 開機自檢每日背景跑,亦可手動 `node update-poe1.mjs`)。
// 流程:偵測 patch → (新版才)重建遊戲匯出 → 刷新 poedb/RePoE/傳奇/樹/交易詞綴/命運卡/掉落 → 前瞻。
// log 寫入 update.log。用 Node 而非 PowerShell:避 PS5.1 讀 UTF-8/CJK 腳本的編碼坑。
// ★ 進度標記:每步輸出「[進度 i/N] 標籤」——MCP 端(lib-autoupdate.updateProgress)靠這個
//   算百分比,畫即時進度條。改動步驟時只要維持這個格式即可。
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(fileURLToPath(import.meta.url));
const de = join(repo, 'tools', 'data-export');
const logFile = join(repo, 'update.log');
const log = (m) => { const line = `${new Date().toISOString()}  ${m}`; console.log(line); try { appendFileSync(logFile, line + '\n'); } catch {} };
// stdout 照舊 inherit(進 update.log,保留「Exporting table …」等即時脈絡);
// stderr 改用 pipe 捕捉 —— 子行程 console.error + process.exit(1) 在「stderr 被重導向到檔案」
// 時訊息會整個消失(MCP 背景更新正是這情況),導致 log 只剩一句無用的 Command failed。
const node = (args, cwd, env = {}) => {
  try {
    return execFileSync(process.execPath, args, { cwd, stdio: ['ignore', 'inherit', 'pipe'], env: { ...process.env, ...env } });
  } catch (e) {
    const err = (e.stderr?.toString() || '').trim();
    if (err) e.message += `\n--- stderr(尾端)---\n${err.split('\n').slice(-15).join('\n')}`;
    throw e;
  }
};
const nodeOut = (args, cwd, env = {}) => execFileSync(process.execPath, args, { cwd, env: { ...process.env, ...env } }).toString().trim();

// —— 匯出看門狗:自動跳過「讀取卡死」的表 ——
// pathofexile-dat 讀某些表(社群 schema 與現行遊戲資料欄位對不上)會讀到垃圾陣列長度 →
// 陷入無窮配置:不當機、不報錯、CPU 燒滿、永遠不結束(2026-08 改版的 AlternateTreeArt)。
// 改版後中招的可能是任何一張表,故不寫死清單:偵測到「久無輸出」就殺掉本輪,把卡住的表名
// 記進 skip-tables.json(gen-config 會據此排除),重新產生 config 再跑。bundle 已快取,重跑很快。
const STALL_SEC = Math.max(30, Number(process.env.POE_EXPORT_STALL_SEC) || 150);
const MAX_SKIP = Math.max(1, Number(process.env.POE_EXPORT_MAX_SKIP) || 8);
const skipFile = join(de, 'skip-tables.json');

function runExportOnce(envP) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['node_modules/pathofexile-dat/dist/cli/run.js'],
      { cwd: de, env: { ...process.env, ...envP } });
    let lastTable = null, errBuf = '', timer = null, settled = false;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        settled = true;
        child.kill();
        log(`⚠️ 匯出停滯 ${STALL_SEC}s(卡在「${lastTable || '?'}」)→ 中止本輪`);
        resolve({ stalled: lastTable });
      }, STALL_SEC * 1000);
    };
    child.stdout.on('data', (b) => {
      const s = b.toString();
      process.stdout.write(s);   // 保留「Exporting table …」即時脈絡進 update.log
      const m = [...s.matchAll(/Exporting table "(?:.*\/)?([^"/]+)"/g)].pop();
      if (m) lastTable = m[1];
      arm();
    });
    child.stderr.on('data', (b) => { errBuf += b.toString(); arm(); });
    child.on('error', (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } });
    child.on('close', (code, signal) => {
      if (settled) return;       // 已由看門狗處理
      settled = true;
      clearTimeout(timer);
      if (code === 0) return resolve({ ok: true });
      const tail = errBuf.trim().split('\n').slice(-15).join('\n');
      reject(new Error(`匯出失敗(exit ${code ?? signal})${tail ? `\n--- stderr(尾端)---\n${tail}` : ''}`));
    });
    arm();
  });
}

async function exportWithWatchdog(envP) {
  const skippedThisRun = [];
  for (;;) {
    const r = await runExportOnce(envP);
    if (r.ok) {
      if (skippedThisRun.length) {
        log(`⚠️ 本次跳過 ${skippedThisRun.length} 張讀取卡死的表:${skippedThisRun.join(', ')}` +
            `(已記入 skip-tables.json;社群 schema 修好後清空該檔即恢復)`);
      }
      return;
    }
    if (!r.stalled) throw new Error('匯出停滯但抓不到卡住的表名 —— 請看 update.log');
    const cur = existsSync(skipFile) ? JSON.parse(readFileSync(skipFile, 'utf8')) : [];
    if (cur.includes(r.stalled)) throw new Error(`「${r.stalled}」已在 skip-tables.json 卻仍停滯,停止重試`);
    if (cur.length >= MAX_SKIP) throw new Error(`已跳過 ${cur.length} 張表仍無法完成匯出,停止重試(疑似 schema 大規模失準)`);
    cur.push(r.stalled);
    writeFileSync(skipFile, JSON.stringify(cur, null, 2), 'utf8');
    skippedThisRun.push(r.stalled);
    log(`↻ 已將「${r.stalled}」加入 skip-tables.json,重新產生 config 後重跑匯出`);
    node(['gen-config.mjs', '--all'], de, envP);   // schema 本輪已重抓,不必再下載
  }
}

try {
  const patch = nodeOut(['get-patch.mjs'], de);
  if (!patch) { log('取不到 patch,中止'); process.exit(1); }
  const envP = { PATCH: patch };
  log(`偵測 patch = ${patch}`);

  const lastFile = join(repo, '.last-patch');
  const last = existsSync(lastFile) ? readFileSync(lastFile, 'utf8').trim() : '';
  const rebuild = patch !== last;
  if (rebuild) log(`新 patch(舊=${last || '無'})→ 完整重建遊戲匯出(--all 全表,供 §12 自動偵測)`);
  else log('patch 未變 → 略過遊戲匯出(RePoE/poedb/傳奇/樹/卡仍更新)');

  // —— 步驟表(依當日情況組裝;soft=失敗不中斷整體)——
  const steps = [];
  if (rebuild) {
    // §12 自我擴充:改版日用 --all 匯出全部表 → detect-new 偵測新結構 → build-* 自動涵蓋新表
    steps.push(
      // ★ --refresh-schema 必要:pathofexile-dat CLI 每次都抓「線上最新」schema,
      //   gen-config 卻預設吃本機 cache。改版後欄位變動會讓 config 列出新 schema 沒有的欄
      //   → CLI 報「doesn't have a column named X」直接 exit(1)。改版日一律重抓 schema。
      ['匯出全部遊戲表', () => node(['gen-config.mjs', '--all', '--refresh-schema'], de, envP)],
      ['解包遊戲資料(最耗時)', () => exportWithWatchdog(envP)],
      ['偵測新資料結構', () => node(['detect-new.mjs'], de, envP)],
      ['重建名稱對照', () => node(['build-names.mjs'], de, envP)],
      ['重建描述對照', () => node(['build-descriptions.mjs'], de, envP)],
      ['重建 UI 詞條', () => node(['build-ui.mjs'], de, envP)],
      ['重建詞綴模板', () => node(['build-stats.mjs'], de, envP)],
      ['復原匯出設定', () => { node(['gen-config.mjs'], de, envP); writeFileSync(lastFile, patch, 'utf8'); }],
    );
  }
  steps.push(
    ['刷新 poedb 名稱', () => node([join(repo, 'tools', 'build-dict.mjs')], de, envP)],
    ['重算資料版本', () => node([join(repo, 'tools', 'build-version.mjs')], de, envP)],
    ['更新 RePoE 遊戲數值', () => node([join(repo, 'tools', 'fetch-repoe.mjs')], repo)],
    ['更新 PoB 傳奇資料', () => node([join(repo, 'tools', 'fetch-pob-uniques.mjs')], repo)],
    ['季前前瞻偵測', () => node([join(repo, 'tools', 'fetch-poedb-preview.mjs')], repo)],
    // 來源獨立的資料集:壞一個不該拖垮每日更新
    ['抽取天賦樹(本機 PoB)', () => node([join(repo, 'tools', 'extract-tree.mjs')], repo), { soft: true }],
    ['更新交易詞綴對照', () => node([join(repo, 'tools', 'fetch-trade-stats.mjs')], repo), { soft: true }],
    ['更新命運卡資料', () => node([join(repo, 'tools', 'fetch-divcards.mjs')], repo), { soft: true }],
    ['更新傳奇掉落來源', () => node([join(repo, 'tools', 'fetch-unique-drops.mjs')], repo), { soft: true }],
  );

  const N = steps.length;
  for (let i = 0; i < N; i++) {
    const [label, fn, opt] = steps[i];
    log(`[進度 ${i + 1}/${N}] ${label}`);
    try { await fn(); } catch (e) {   // 匯出步驟是 async(看門狗);其餘 sync 步驟 await 無害
      if (opt?.soft) log(`⚠️ ${label} 失敗(略過):${e.message}`);
      else throw e;
    }
  }

  log('完成 ✅');
} catch (e) {
  log(`錯誤 ✗ ${e.message}`);
  process.exit(1);
}
