/**
 * get-patch.mjs — 問 GGG patch 伺服器目前 PoE1 的 CDN patch 版本(3.x.x.x.x)
 * 預設只印出版本字串(給 CI 擷取)。加 --verbose 看細節。
 * (PoE1 fork:patch server = patch.pathofexile.com:12995,已實測回 3.28.x)
 */
import net from 'node:net';

function probe(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    sock.setTimeout(6000);
    const chunks = [];
    const finish = () => {
      try { sock.destroy(); } catch {}
      const buf = Buffer.concat(chunks);
      for (const start of [0, 1]) {
        const text = buf.subarray(start).toString('utf16le');
        const m = text.match(/https?:\/\/[\w./-]*poecdn\.com\/([\d.]+)\//);
        if (m) return resolve(m[1]);
      }
      resolve(null);
    };
    sock.on('connect', () => sock.write(Buffer.from([1, 7])));
    sock.on('data', (d) => { chunks.push(d); setTimeout(finish, 400); });
    sock.on('timeout', finish);
    sock.on('error', () => resolve(null));
  });
}

const version = await probe('patch.pathofexile.com', 12995);
if (!version) { console.error('無法取得 PoE1 patch 版本'); process.exit(1); }
console.log(version);
