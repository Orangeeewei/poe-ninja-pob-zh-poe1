// grep-csd.mjs — 在所有 .csd 中尋找含關鍵字的 description 區塊(調查用)
import * as loaders from './node_modules/pathofexile-dat/dist/cli/bundle-loaders.js';
import { readIndexBundle } from './node_modules/pathofexile-dat/dist/bundles/index-bundle.js';
import { getDirContent } from './node_modules/pathofexile-dat/dist/bundles/index-paths.js';
import { decompressSliceInBundle, decompressedBundleSize } from './node_modules/pathofexile-dat/dist/bundles/bundle.js';
import path from 'node:path';

const PATCH = process.env.POE2_PATCH || '4.5.1.1.2';
const STAT_DIR = 'data/statdescriptions';
const NEEDLE = process.argv[2] || 'Allocates';

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
    for (const f of c.files) if (f.endsWith('.csd')) out.push(f);
    for (const d of c.dirs) visit(d);
  };
  visit(STAT_DIR);
  return out.sort();
}

const cdn = await loaders.CdnBundleLoader.create(path.join(process.cwd(), '.cache'), PATCH);
const loader = await loaders.FileLoader.create(cdn);
const files = await listCsdFiles(cdn);
for (const f of files) {
  const data = await loader.tryGetFileContents(f);
  if (!data) continue;
  const text = Buffer.from(data).toString('utf16le');
  if (!text.includes(NEEDLE)) continue;
  const lines = text.split(/\r?\n/);
  // 找出含 needle 的行,印出所屬 description 區塊(往上找 'description',往下印到下一個 'description')
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(NEEDLE)) continue;
    let start = i;
    while (start > 0 && lines[start].trim() !== 'description') start--;
    let end = i;
    while (end < lines.length - 1 && lines[end + 1].trim() !== 'description') end++;
    if (end - start > 80) { start = i - 2; end = i + 2; }
    console.log(`\n=== ${f} (line ${i}) ===`);
    for (let k = start; k <= end; k++) console.log(lines[k]);
    i = end;
  }
}
