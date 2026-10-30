import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { createStore } from './store.ts';
import { QUESTIONS, scoreAnswers } from './questionnaire.ts';
import { pendingQueue, setLabel, clipPath } from '../label/queue.ts';
import { listViewable, mediaPath, viewData } from './view.ts';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const MAX_BODY = 64 * 1024 * 1024;

async function body(req: IncomingMessage): Promise<Buffer> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
    parts.push(c);
  }
  return Buffer.concat(parts);
}

function send(res: ServerResponse, status: number, obj?: unknown, extra: Record<string, string> = {}) {
  if (obj === undefined) { res.writeHead(status, extra).end(); return; }
  res.writeHead(status, { 'content-type': 'application/json', ...extra }).end(JSON.stringify(obj));
}

// Range requests, so the browser can seek and replay a clip.
async function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string) {
  let size: number;
  try { size = (await stat(file)).size; } catch { return send(res, 404, { error: 'not found' }); }
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (!m || (!m[1] && !m[2])) {
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
    createReadStream(file).pipe(res);
    return;
  }
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (start > end) { res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return; }
  res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' });
  createReadStream(file, { start, end }).pipe(res);
}

export function createApp(root: string) {
  const store = createStore(root);

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = decodeURIComponent(url.pathname);
    // Split before decoding so an encoded slash stays inside one segment and fails id validation.
    const seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    try {
      if (seg[0] === 'events') {
        if (req.method === 'OPTIONS') return send(res, 204, undefined, CORS);
        if (req.method !== 'POST' || seg.length !== 2) return send(res, 404, { error: 'not found' }, CORS);
        const parsed = JSON.parse((await body(req)).toString('utf8'));
        const stored = await store.appendEvents(seg[1], Array.isArray(parsed) ? parsed : [parsed], Date.now());
        return send(res, 200, { stored }, CORS);
      }

      if (req.method === 'GET' && path === '/api/info') {
        const lanIps = Object.values(networkInterfaces()).flat()
          .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n!.address);
        return send(res, 200, { lanIps });
      }

      if (req.method === 'GET' && path === '/api/questions') return send(res, 200, QUESTIONS);

      if (req.method === 'POST' && seg[0] === 'api' && seg[1] === 'kids' && seg.length === 4 && seg[3] === 'questionnaire') {
        const { answers } = JSON.parse((await body(req)).toString('utf8'));
        const scores = scoreAnswers(answers ?? {});
        await store.writeKidJson(seg[2], 'questionnaire', { kid: seg[2], answeredAt: Date.now(), answers, scores });
        return send(res, 200, { ok: true });
      }

      if (req.method === 'GET' && seg[0] === 'api' && seg[1] === 'sessions' && seg.length === 4 && seg[3] === 'summary') {
        return send(res, 200, await store.summary(seg[2]));
      }

      if (req.method === 'GET' && path === '/api/label-queue') return send(res, 200, await pendingQueue(root));

      if (req.method === 'GET' && path === '/api/view') return send(res, 200, await listViewable(root));
      if (req.method === 'GET' && seg[0] === 'api' && seg[1] === 'view' && seg.length === 3) return send(res, 200, await viewData(root, seg[2]));
      if (req.method === 'GET' && seg[0] === 'media' && seg.length === 3 && seg[2].endsWith('.mp4')) {
        return sendFile(req, res, mediaPath(root, seg[1], seg[2].slice(0, -4)), 'video/mp4');
      }

      if (req.method === 'GET' && seg[0] === 'clips' && seg.length === 3 && seg[2].endsWith('.mp4')) {
        return sendFile(req, res, clipPath(root, seg[1], seg[2].slice(0, -4)), 'video/mp4');
      }

      if (seg[0] === 'api' && seg[1] === 'sessions' && req.method === 'POST') {
        if (seg.length === 4 && seg[3] === 'labels') {
          const { moment, label } = JSON.parse((await body(req)).toString('utf8'));
          await setLabel(root, seg[2], String(moment ?? ''), label ?? null);
          return send(res, 204);
        }
        if (seg.length === 2) {
          const meta = JSON.parse((await body(req)).toString('utf8'));
          return send(res, 200, { id: await store.createSession(meta) });
        }
        if (seg.length === 4 && seg[3] === 'chunk') {
          await store.appendChunk(seg[2], url.searchParams.get('track') ?? '', Number(url.searchParams.get('seq')), await body(req));
          return send(res, 204);
        }
        if (seg.length === 5 && seg[3] === 'json') {
          await store.writeJson(seg[2], seg[4], JSON.parse((await body(req)).toString('utf8')));
          return send(res, 204);
        }
      }

      if (req.method === 'GET') {
        const rel = normalize(path === '/' ? '/record.html' : path).replace(/^(\.\.[/\\])+/, '');
        const file = join(PUBLIC, rel);
        if (!file.startsWith(PUBLIC)) return send(res, 404, { error: 'not found' });
        try {
          const buf = await readFile(file);
          res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(buf);
        } catch { send(res, 404, { error: 'not found' }); }
        return;
      }

      send(res, 404, { error: 'not found' });
    } catch (err: any) {
      const status = err.status ?? (/bad |expected seq|JSON|ENOENT/.test(String(err.message)) ? 400 : 500);
      send(res, status, { error: String(err.message) }, path.startsWith('/events') ? CORS : {});
    }
  });
}
