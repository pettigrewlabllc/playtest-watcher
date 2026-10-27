import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { createStore } from './store.ts';
import { QUESTIONS, scoreAnswers } from './questionnaire.ts';

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

      if (seg[0] === 'api' && seg[1] === 'sessions' && req.method === 'POST') {
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
