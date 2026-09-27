// grep-csd.mjs — 在所有詞綴描述檔中尋找含關鍵字的 description 區塊(調查用)
// PoE1:metadata/statdescriptions/**/*.txt(UTF-16LE)。
// 用法:node grep-csd.mjs <關鍵字…>   patch 取 PATCH 環境變數,否則讀 config.json
import * as loaders from './node_modules/pathofexile-dat/dist/cli/bundle-loaders.js';
import { readIndexBundle } from './node_modules/pathofexile-dat/dist/bundles/index-bundle.js';
import { getDirContent } from './node_modules/pathofexile-dat/dist/bundles/index-paths.js';
import { decompressSliceInBundle, decompressedBundleSize } from './node_modules/pathofexile-dat/dist/bundles/bundle.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PATCH = process.env.PATCH || JSON.parse(readFileSync(path.join(here, 'config.json'), 'utf8')).patch;
const STAT_DIR = 'metadata/statdescriptions';
const STAT_EXT = '.txt';
const NEEDLES = process.argv.slice(2).map((s) => s.toLowerCase());
if (!NEEDLES.length) { console.error('用法:node grep-csd.mjs <關鍵字…>'); process.exit(1); }

async function listCsdFiles(cdn) {
  const indexBin = await cdn.fetchFile('_.index.bin');
  const ib = new Uint8Array(decompressedBundleSize(indexBin));
  decompressSliceInBundle(indexBin, 0, ib);
  const idx = readIndexBundle(ib);
  const pr = new Uint8Array(decompressedBundleSize(idx.pathRepsBundle));
  decompressSliceInBundle(idx.pathRepsBundle, 0, pr);
  const out = [];
  const visit = (dir) => {
    let c;
    try { c = getDirContent(dir, pr, idx.dirsInfo); } catch { return; }
    for (const f of c.files) if (f.endsWith(STAT_EXT)) out.push(f);
    for (const d of c.dirs) visit(d);
  };
  visit(STAT_DIR);
  return out.sort();
}

const origLog = console.log;
console.log = (...a) => { if (!/^Loading/.test(String(a[0]))) origLog(...a); };
const cdn = await loaders.CdnBundleLoader.create(path.join(here, '.cache'), PATCH);
const loader = await loaders.FileLoader.create(cdn);
const files = await listCsdFiles(cdn);
console.log(`patch ${PATCH}:${files.length} 個描述檔`);
for (const f of files) {
  const data = await loader.tryGetFileContents(f);
  if (!data) continue;
  const lines = Buffer.from(data).toString('utf16le').split(/\r?\n/);
  lines.forEach((l, i) => {
    const low = l.toLowerCase();
    if (NEEDLES.some((n) => low.includes(n))) console.log(`${f.replace(STAT_DIR + '/', '')}:${i + 1}: ${l.trim().slice(0, 200)}`);
  });
}
