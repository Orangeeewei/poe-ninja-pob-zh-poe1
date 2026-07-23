// update-poe1.mjs — PoE1 資料一鍵更新(MCP 開機自檢每日背景跑,亦可手動 `node update-poe1.mjs`)。
// 流程:偵測 patch → (新版才)重建遊戲匯出 → 刷新 poedb/RePoE/傳奇/樹/交易詞綴/命運卡/掉落 → 前瞻。
// log 寫入 update.log。用 Node 而非 PowerShell:避 PS5.1 讀 UTF-8/CJK 腳本的編碼坑。
// ★ 進度標記:每步輸出「[進度 i/N] 標籤」——MCP 端(lib-autoupdate.updateProgress)靠這個
//   算百分比,畫即時進度條。改動步驟時只要維持這個格式即可。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(fileURLToPath(import.meta.url));
const de = join(repo, 'tools', 'data-export');
const logFile = join(repo, 'update.log');
const log = (m) => { const line = `${new Date().toISOString()}  ${m}`; console.log(line); try { appendFileSync(logFile, line + '\n'); } catch {} };
const node = (args, cwd, env = {}) => execFileSync(process.execPath, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
const nodeOut = (args, cwd, env = {}) => execFileSync(process.execPath, args, { cwd, env: { ...process.env, ...env } }).toString().trim();

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
      ['匯出全部遊戲表', () => node(['gen-config.mjs', '--all'], de, envP)],
      ['解包遊戲資料(最耗時)', () => node(['node_modules/pathofexile-dat/dist/cli/run.js'], de, envP)],
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
    try { fn(); } catch (e) {
      if (opt?.soft) log(`⚠️ ${label} 失敗(略過):${e.message}`);
      else throw e;
    }
  }

  log('完成 ✅');
} catch (e) {
  log(`錯誤 ✗ ${e.message}`);
  process.exit(1);
}
