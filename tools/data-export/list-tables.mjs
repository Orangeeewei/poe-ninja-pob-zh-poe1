/**
 * list-tables.mjs — 列舉當前 patch 的 bundle 裡實際存在的 .datc64 表(遞迴 data/)。
 * 輸出每個檔案路徑;供 gen-config 與這支腳本判斷「哪些 schema 表真的有資料檔」。
 */
import * as loaders from './node_modules/pathofexile-dat/dist/cli/bundle-loaders.js';
import { readIndexBundle } from './node_modules/pathofexile-dat/dist/bundles/index-bundle.js';
import { getDirContent } from './node_modules/pathofexile-dat/dist/bundles/index-paths.js';
import { decompressSliceInBundle, decompressedBundleSize } from './node_modules/pathofexile-dat/dist/bundles/bundle.js';
import path from 'node:path';

const PATCH = process.env.POE2_PATCH || process.env.PATCH || '4.5.1.1.2';

export async function listDatTables(cdn) {
  const indexBin = await cdn.fetchFile('_.index.bin');
  const ib = new Uint8Array(decompressedBundleSize(indexBin));
  decompressSliceInBundle(indexBin, 0, ib);
  const idx = readIndexBundle(ib);
  const pr = new Uint8Array(decompressedBundleSize(idx.pathRepsBundle));
  decompressSliceInBundle(idx.pathRepsBundle, 0, pr);

  const names = new Set();
  const visit = (dir) => {
    let c;
    try { c = getDirContent(dir, pr, idx.dirsInfo); } catch { return; }
    for (const f of c.files) {
      const m = f.match(/([^/]+)\.datc64$/i);
      if (m) names.add(m[1]);
    }
    for (const d of c.dirs) visit(d);
  };
  visit('data');
  return names;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cdn = await loaders.CdnBundleLoader.create(path.join(process.cwd(), '.cache'), PATCH);
  const names = await listDatTables(cdn);
  console.log(`實際存在的 .datc64 表:${names.size}`);
  console.log([...names].sort().join('\n'));
}
