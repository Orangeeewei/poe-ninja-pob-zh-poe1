// fetch-trade-stats.mjs — 抓「詞綴文字 → 官方 trade stat id」對照表 → gamedata/trade-stats.ndjson。
// 官方 /trade/api/data/stats 有 Cloudflare 擋非瀏覽器 → 改用 Awakened PoE Trade 維護的鏡像
// (該工具本身就靠這份組交易查詢,隨遊戲版本更新)。
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const URL = 'https://raw.githubusercontent.com/SnosMe/awakened-poe-trade/master/renderer/public/data/en/stats.ndjson';

const r = await fetch(URL);
if (!r.ok) { console.error(`fetch-trade-stats:HTTP ${r.status}`); process.exit(1); }
const text = await r.text();
const n = text.trim().split('\n').length;
if (n < 1000) { console.error(`fetch-trade-stats:僅 ${n} 行,疑似壞檔,不覆寫`); process.exit(1); }
const outDir = join(repo, 'gamedata');
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'trade-stats.ndjson'), text, 'utf8');
console.log(`✅ trade-stats.ndjson:${n} 條詞綴對照`);
