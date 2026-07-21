/**
 * pack-extension.mjs — 打包成可上傳 Chrome Web Store 的 zip(只含擴充必要檔)。
 *
 * 產出:dist/poe-ninja-pob-zh-<version>.zip,內容物在 zip 根目錄(manifest.json 在最上層)。
 * 只含:manifest.json、background.js、translator.js、search-inject.js、data/*.json、icons/*.png。
 * 不含:tools/、.github/、README、docs、CLAUDE.md、HANDOFF、node_modules、.git…
 *
 * 自帶 ZIP 寫入器(deflate + 正斜線路徑),不依賴外部 zip/PowerShell → 跨平台、
 * 且避免 PowerShell Compress-Archive 反斜線路徑被 Chrome 商店拒收的問題。
 *
 * 用法:node tools/pack-extension.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const version = manifest.version;
const distDir = path.join(root, 'dist');
const zipName = `poe-ninja-pob-zh-${version}.zip`;

// 收集要打包的檔(zip 內路徑一律正斜線、相對根目錄)
const files = [];
const addFile = (zipPath, absPath) => files.push({ zipPath, data: readFileSync(absPath) });
for (const f of ['manifest.json', 'background.js', 'translator.js', 'search-inject.js']) addFile(f, path.join(root, f));
for (const f of readdirSync(path.join(root, 'data')).sort()) {
  if (f.endsWith('.json')) addFile(`data/${f}`, path.join(root, 'data', f));
}
for (const f of ['icon16.png', 'icon48.png', 'icon128.png']) {
  const abs = path.join(root, 'icons', f);
  if (existsSync(abs)) addFile(`icons/${f}`, abs);
}

// --- CRC32(自備表,不依賴 Node 版本)---
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- 最小 ZIP 寫入器(deflate)---
const DOS_TIME = 0, DOS_DATE = 0x21; // 固定 1980-01-01 → 打包結果可重現
const localParts = [];
const central = [];
let offset = 0;

for (const { zipPath, data } of files) {
  const name = Buffer.from(zipPath, 'utf8');
  const crc = crc32(data);
  const comp = deflateRawSync(data, { level: 9 });
  const useStore = comp.length >= data.length;      // 壓不贏就用 store(method 0)
  const method = useStore ? 0 : 8;
  const body = useStore ? data : comp;

  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50, 0);
  lh.writeUInt16LE(20, 4);        // version needed
  lh.writeUInt16LE(0, 6);         // flags
  lh.writeUInt16LE(method, 8);
  lh.writeUInt16LE(DOS_TIME, 10);
  lh.writeUInt16LE(DOS_DATE, 12);
  lh.writeUInt32LE(crc, 14);
  lh.writeUInt32LE(body.length, 18);
  lh.writeUInt32LE(data.length, 22);
  lh.writeUInt16LE(name.length, 26);
  lh.writeUInt16LE(0, 28);        // extra length
  localParts.push(lh, name, body);

  const ch = Buffer.alloc(46);
  ch.writeUInt32LE(0x02014b50, 0);
  ch.writeUInt16LE(20, 4);        // version made by
  ch.writeUInt16LE(20, 6);        // version needed
  ch.writeUInt16LE(0, 8);         // flags
  ch.writeUInt16LE(method, 10);
  ch.writeUInt16LE(DOS_TIME, 12);
  ch.writeUInt16LE(DOS_DATE, 14);
  ch.writeUInt32LE(crc, 16);
  ch.writeUInt32LE(body.length, 20);
  ch.writeUInt32LE(data.length, 24);
  ch.writeUInt16LE(name.length, 28);
  ch.writeUInt32LE(0, 42);        // local header offset
  central.push(Buffer.concat([ch, name]));
  // 補上 local header offset(上一行 alloc 時還不知道)
  central[central.length - 1].writeUInt32LE(offset, 42);

  offset += lh.length + name.length + body.length;
}

const cd = Buffer.concat(central);
const cdOffset = offset;
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(files.length, 8);   // entries this disk
eocd.writeUInt16LE(files.length, 10);  // total entries
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(cdOffset, 16);

const zip = Buffer.concat([...localParts, cd, eocd]);
mkdirSync(distDir, { recursive: true });
writeFileSync(path.join(distDir, zipName), zip);

console.log(`✅ 打包完成 -> dist/${zipName}(${files.length} 檔,${(zip.length / 1048576).toFixed(2)} MB)`);
for (const f of files) console.log('   - ' + f.zipPath);
console.log('上傳到 https://chrome.google.com/webstore/devconsole(文案見 docs/STORE-LISTING.md)');
