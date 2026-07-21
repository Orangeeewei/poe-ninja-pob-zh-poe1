/**
 * build-version.mjs — 由 dict.json + stat-templates.json 算出 data/version.json
 *   { version: <內容雜湊>, build: <遞增整數,毫秒>, names, stats }
 * version 用來判斷「有沒有變」;build 用來判斷「誰比較新」(擴充端只在更新的 build 比內建新時才採用快取)。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const dict = JSON.parse(readFileSync(join(dataDir, 'dict.json'), 'utf8'));
const stats = JSON.parse(readFileSync(join(dataDir, 'stat-templates.json'), 'utf8'));

const names = Object.keys(dict.names || {}).length;
const descs = Object.keys(dict.descriptions || {}).length;
const uiAuto = Object.keys(dict.uiAuto || {}).length;
const statCount = stats.count || Object.keys(stats.templates || {}).length;
const version = createHash('sha256')
  .update(
    JSON.stringify(dict.names) + '|' + JSON.stringify(dict.descriptions) +
    '|' + JSON.stringify(dict.uiAuto) + '|' + JSON.stringify(stats.templates) +
    // textTemplates 必須入雜湊:否則只改文字佔位符模板時 version 不變,
    // background 會判定「已是最新」而不下載,用戶端永遠拿不到更新。
    '|' + JSON.stringify(stats.textTemplates || [])
  )
  .digest('hex')
  .slice(0, 16);

const build = Number(process.env.BUILD_EPOCH) || Date.now();

writeFileSync(
  join(dataDir, 'version.json'),
  JSON.stringify({ version, build, names, descriptions: descs, uiAuto, stats: statCount }, null, 2) + '\n',
  'utf8'
);
console.log(`version.json: version=${version} build=${build} names=${names} desc=${descs} uiAuto=${uiAuto} stats=${statCount}`);
