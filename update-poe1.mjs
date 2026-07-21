// update-poe1.mjs — PoE1 資料一鍵更新(供 Windows 排程每日 `node update-poe1.mjs`)。
// 流程:偵測 patch → (新版才)重建遊戲匯出 → 刷新 poedb 名稱 → 重算版本 → 更新 RePoE gamedata。
// log 寫入 update.log。用 Node 而非 PowerShell:避免 PS5.1 讀 UTF-8/CJK 腳本的編碼坑。
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

  if (patch !== last) {
    log(`新 patch(舊=${last || '無'})→ 完整重建遊戲匯出(--all 全表,供 §12 自動偵測)`);
    // §12 自我擴充:改版日用 --all 匯出全部表 → detect-new 偵測新結構(寫 auto-relevance,
    // 標 unvalidated)→ build-* 讀 relevance(ROUTED + auto)自動涵蓋新表。
    node(['gen-config.mjs', '--all'], de, envP);
    node(['node_modules/pathofexile-dat/dist/cli/run.js'], de, envP);
    node(['detect-new.mjs'], de, envP);
    node(['build-names.mjs'], de, envP);
    node(['build-descriptions.mjs'], de, envP);
    node(['build-ui.mjs'], de, envP);
    node(['build-stats.mjs'], de, envP);
    node(['gen-config.mjs'], de, envP);  // config.json 復原 relevance 模式(--all 只供稽核/偵測)
    writeFileSync(lastFile, patch, 'utf8');
  } else {
    log('patch 未變 → 略過遊戲匯出(RePoE/poedb/傳奇仍更新)');
  }

  // poedb 名稱(技能/支援/傳奇)每次刷新
  node([join(repo, 'tools', 'build-dict.mjs')], de, envP);
  node([join(repo, 'tools', 'build-version.mjs')], de, envP);

  // RePoE gamedata 獨立於 patch,每次刷(§12:索引頁自動發現新資料檔,標 unvalidated)
  node([join(repo, 'tools', 'fetch-repoe.mjs')], repo);
  // PoB 傳奇資料(跟 PoB master 走,獨立於 patch)每次刷
  node([join(repo, 'tools', 'fetch-pob-uniques.mjs')], repo);

  log('完成 ✅');
} catch (e) {
  log(`錯誤 ✗ ${e.message}`);
  process.exit(1);
}
