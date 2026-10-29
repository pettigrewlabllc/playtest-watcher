// Serves a Godot web build over HTTPS so it runs on the iPad (Godot needs a secure context, and a LAN IP over plain
// http isn't one). POST /events/* is passed through to the watcher, so the game posts to its own origin and the
// https page never makes a mixed-content call. Self-signed cert, made once into .certs/ (gitignored).
//   node scripts/https-game.ts <build dir> [port=3062] [watcher=http://localhost:3060]
import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFileSync, existsSync, mkdirSync, createReadStream, statSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { join, extname, resolve, normalize } from 'node:path';

const [dir, portArg, watcherArg] = process.argv.slice(2);
if (!dir) throw new Error('usage: node scripts/https-game.ts <build dir> [port] [watcher url]');
const root = resolve(dir);
const port = Number(portArg ?? 3062);
const watcher = new URL(watcherArg ?? 'http://localhost:3060');

const ips = Object.values(networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a!.address);
const certDir = resolve(import.meta.dirname, '..', '.certs');
const key = join(certDir, 'key.pem'), cert = join(certDir, 'cert.pem');
const sanFile = join(certDir, 'san.txt');
const san = ['DNS:localhost', 'IP:127.0.0.1', ...ips.map(ip => `IP:${ip}`)].join(',');
if (!existsSync(cert) || !existsSync(sanFile) || readFileSync(sanFile, 'utf8') !== san) {
  mkdirSync(certDir, { recursive: true });
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '365', '-keyout', key, '-out', cert,
    '-subj', '/CN=playtest-watcher', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
  execFileSync('sh', ['-c', `printf '%s' '${san}' > '${sanFile}'`]);
}

const types: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.pck': 'application/octet-stream',
  '.png': 'image/png', '.json': 'application/json',
};

const recordings = resolve(import.meta.dirname, '..', 'recordings');
function latestSession(): string | undefined {
  const fresh = readdirSync(recordings)
    .filter(d => /^[a-z0-9-]+-current-cut-[a-z]+$/.test(d) && existsSync(join(recordings, d, 'session.json')))
    .map(d => ({ d, at: statSync(join(recordings, d, 'session.json')).mtimeMs }))
    .filter(s => Date.now() - s.at < 30 * 60_000)
    .sort((a, b) => b.at - a.at);
  return fresh[0]?.d;
}

createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
  if (!/\.(wasm|pck|png|js)$/.test(path)) console.log(new Date().toISOString(), req.socket.remoteAddress, req.method, req.url);
  if (path.startsWith('/events/')) {
    const up = httpRequest({ hostname: watcher.hostname, port: watcher.port, path: req.url, method: req.method, headers: req.headers }, r => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    up.on('error', e => { res.writeHead(502); res.end(`watcher unreachable: ${e.message}`); });
    req.pipe(up);
    return;
  }
  // Safari can drop the query when it reloads past the certificate warning, which leaves the logger off. A bare page
  // load goes to the newest Current Cut session started in the last 30 minutes instead.
  if ((path === '/' || path === '/index.html') && !/[?&]playtest=/.test(req.url ?? '')) {
    const session = latestSession();
    if (session) {
      const pw = `https://${req.headers.host}`;
      res.writeHead(302, { location: `/index.html?playtest=${session}&pw=${encodeURIComponent(pw)}`, 'cache-control': 'no-store' });
      res.end();
      return;
    }
  }
  const file = normalize(join(root, path === '/' ? 'index.html' : path));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {
    'content-type': types[extname(file)] ?? 'application/octet-stream',
    'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp', 'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}).listen(port, '0.0.0.0', () => console.log(`https game on ${['localhost', ...ips].map(h => `https://${h}:${port}`).join('  ')} (events -> ${watcher.origin})`));
