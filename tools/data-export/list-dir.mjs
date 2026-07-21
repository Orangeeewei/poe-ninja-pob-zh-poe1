import * as loaders from './node_modules/pathofexile-dat/dist/cli/bundle-loaders.js';
import { readIndexBundle } from './node_modules/pathofexile-dat/dist/bundles/index-bundle.js';
import { getDirContent, getRootDirs } from './node_modules/pathofexile-dat/dist/bundles/index-paths.js';
import { decompressSliceInBundle, decompressedBundleSize } from './node_modules/pathofexile-dat/dist/bundles/bundle.js';
import path from 'node:path';

const cdn = await loaders.CdnBundleLoader.create(path.join(process.cwd(), '.cache'), '4.5.0.3.4');
const indexBin = await cdn.fetchFile('_.index.bin');
const indexBundle = new Uint8Array(decompressedBundleSize(indexBin));
decompressSliceInBundle(indexBin, 0, indexBundle);
const idx = readIndexBundle(indexBundle);

// pathReps 本身是壓縮 bundle，要再解壓
const pathReps = new Uint8Array(decompressedBundleSize(idx.pathRepsBundle));
decompressSliceInBundle(idx.pathRepsBundle, 0, pathReps);

const target = process.argv[2] || 'metadata/statdescriptions';
for (const dp of [target, target.replace(/\b\w/g, (c) => c.toUpperCase())]) {
  try {
    const content = getDirContent(dp, pathReps, idx.dirsInfo);
    console.log(`\n# dir "${dp}"  files=${content.files.length} dirs=${content.directories?.length ?? 0}`);
    console.log(content.files.slice(0, 60).join('\n'));
    break;
  } catch (e) {
    console.log(`(dir "${dp}" -> ${e.message})`);
  }
}
