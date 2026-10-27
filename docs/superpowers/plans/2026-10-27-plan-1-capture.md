# Playtest Watcher Plan 1: Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record a 10-minute playtest session (face camera, hands camera, mic, screen, game events) onto one clock, on Joel's laptop, ready for the analysis pipeline.

**Architecture:** One Node server on port 3058 (plain `node:http`, TypeScript run directly by Node 26's type stripping, no build step) serves static pages from `public/`, receives recording chunks and game events, and writes them to `recordings/<session>/`. The recorder is a single static page using `getUserMedia`, `getDisplayMedia` and one `MediaRecorder` per track. Games post events to the server, which stamps arrival time with its own clock.

**Tech Stack:** Node 26 (`node --experimental-strip-types` not needed; type stripping is on by default), TypeScript types only, Vitest for tests, plain HTML/JS for pages, Chrome on macOS.

Spec: `docs/superpowers/specs/2026-10-27-playtest-watcher-design.md`. Plans 2 (analysis pipeline) and 3 (personas, scoring, viewer) follow.

## Global Constraints

- Port **3058**. Add it to the workspace `CLAUDE.md` port table and `.claude/launch.json` (entry `playtest-watcher`).
- `recordings/` is gitignored, and so is every `*.webm`, `*.mp4`, `*.mov`, `*.wav`, `*.m4a`. Nothing recorded is ever committed. The repo will be public.
- Kids are `A`, `B`, `C`, `D` in every file name, id and log line. Names never appear in the repo.
- Session ids match `^[a-z0-9-]{1,80}$`. The server rejects anything else (path traversal guard).
- Event shape: `{ t: number /* epoch ms from the game's clock */, type: string, data?: object }`. The server adds `serverT` (its epoch ms) on arrival.
- Game event logging is off unless the game's URL has `?playtest=<sessionId>` (or the Godot command-line flag `--playtest=<sessionId>`). No store build changes behaviour.
- Changes inside game repos (factor-slicer, bond-swap, hoard-keeper, current-cut) go on a branch in that repo with its own PR. Never commit to their `main`.
- User-facing strings in the recorder are operator-only (Joel), so plain labels are fine; anything shown to kids or in the demo goes through `joel-voice` later.

## File structure

```
playtest-watcher/
  package.json              scripts: start, test
  tsconfig.json             editor types only (noEmit)
  src/server/
    main.ts                 starts the server on 3058
    app.ts                  request router: createApp(rootDir) -> http.Server
    store.ts                filesystem layer: sessions, chunks, manifest, events, reports
    ids.ts                  session id validation and creation
  public/
    spike.html              Task 1: two-camera + mic + screen soak test
    record.html             Task 3: the real recorder
    recorder.js             shared capture helpers used by both pages
    playtest-log.js         Task 4: the snippet games load
  tests/
    ids.test.ts
    store.test.ts
    app.test.ts
  godot/playtest_log.gd     Task 5: autoload copied into current-cut
```

---

### Task 1: Server skeleton and the camera spike

The first deliverable answers one question: can this laptop record both cameras, the mic and a screen share for 10 minutes without dropping frames?

**Files:**
- Create: `package.json`, `tsconfig.json`, `src/server/ids.ts`, `src/server/store.ts`, `src/server/app.ts`, `src/server/main.ts`, `public/recorder.js`, `public/spike.html`
- Test: `tests/ids.test.ts`, `tests/store.test.ts`, `tests/app.test.ts`

**Interfaces:**
- Produces:
  - `isValidSessionId(id: string): boolean`, `newSessionId(parts: string[], now?: Date): string`
  - `createStore(root: string)` returning `{ createSession(meta: SessionMeta): Promise<string>; appendChunk(id, track, seq, buf: Buffer): Promise<void>; writeJson(id, name: 'manifest'|'report'|'session', obj): Promise<void>; appendEvents(id, events: GameEvent[], serverT: number): Promise<number>; dir(id): string }`
  - `createApp(root: string): http.Server`
  - HTTP: `POST /api/sessions` → `{id}`; `POST /api/sessions/:id/chunk?track=&seq=` (raw body); `POST /api/sessions/:id/json/:name`; `POST /events/:id` (one event or an array, CORS open) → `{stored}`; `GET /*` static from `public/`.
  - Browser: `window.PW` with `listDevices()`, `openCamera(deviceId, {width,height,fps})`, `openMic(deviceId)`, `openScreen()`, `startTrackRecorder(sessionId, trackName, stream)` → `{stop(): Promise<void>, stats(): {chunks, bytes}}`, `frameCounter(videoEl)` → `{fps(): number, total(): number}`.

- [ ] **Step 1: package.json, tsconfig.json, install Vitest**

```json
{
  "name": "playtest-watcher",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/server/main.ts",
    "test": "vitest run"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "vitest": "^3.2.0"
  }
}
```

```json
{
  "compilerOptions": {
    "target": "es2023", "module": "nodenext", "moduleResolution": "nodenext",
    "allowImportingTsExtensions": true, "noEmit": true, "strict": true,
    "erasableSyntaxOnly": true, "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

Run: `npm install`

- [ ] **Step 2: Write failing tests for ids**

`tests/ids.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isValidSessionId, newSessionId } from '../src/server/ids.ts';

describe('session ids', () => {
  it('accepts lowercase, digits and dashes', () => {
    expect(isValidSessionId('2026-10-29-a-factor-slicer-learn')).toBe(true);
  });
  it('rejects traversal, slashes, uppercase and empty', () => {
    for (const bad of ['', '../x', 'a/b', 'A', 'a b', 'x'.repeat(81)]) {
      expect(isValidSessionId(bad)).toBe(false);
    }
  });
  it('builds an id from parts and a timestamp', () => {
    const id = newSessionId(['A', 'Factor Slicer', 'learn'], new Date('2026-10-29T15:04:05Z'));
    expect(id).toBe('20261029-150405-a-factor-slicer-learn');
    expect(isValidSessionId(id)).toBe(true);
  });
});
```

Run: `npx vitest run tests/ids.test.ts` — Expected: FAIL, cannot find module.

- [ ] **Step 3: Implement ids.ts**

```ts
const ID = /^[a-z0-9-]{1,80}$/;

export function isValidSessionId(id: string): boolean {
  return ID.test(id);
}

export function newSessionId(parts: string[], now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const slug = parts.map(p => p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean);
  return [stamp, ...slug].join('-').slice(0, 80);
}
```

Run: `npx vitest run tests/ids.test.ts` — Expected: PASS.

- [ ] **Step 4: Write failing tests for the store**

`tests/store.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/server/store.ts';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'pw-')); });

describe('store', () => {
  it('creates a session folder with session.json', async () => {
    const s = createStore(root);
    const id = await s.createSession({ kid: 'A', game: 'bond-swap', round: 'learn' });
    const meta = JSON.parse(await readFile(join(root, id, 'session.json'), 'utf8'));
    expect(meta).toMatchObject({ id, kid: 'A', game: 'bond-swap', round: 'learn' });
    expect(typeof meta.createdAt).toBe('number');
  });

  it('appends chunks in order to <track>.webm', async () => {
    const s = createStore(root);
    const id = await s.createSession({ kid: 'A', game: 'g', round: 'learn' });
    await s.appendChunk(id, 'face', 0, Buffer.from('ab'));
    await s.appendChunk(id, 'face', 1, Buffer.from('cd'));
    expect(await readFile(join(root, id, 'face.webm'), 'utf8')).toBe('abcd');
  });

  it('rejects an out-of-order chunk', async () => {
    const s = createStore(root);
    const id = await s.createSession({ kid: 'A', game: 'g', round: 'learn' });
    await expect(s.appendChunk(id, 'face', 1, Buffer.from('x'))).rejects.toThrow(/expected seq 0/);
  });

  it('rejects bad ids and track names', async () => {
    const s = createStore(root);
    await expect(s.appendChunk('../x', 'face', 0, Buffer.from(''))).rejects.toThrow();
    const id = await s.createSession({ kid: 'A', game: 'g', round: 'learn' });
    await expect(s.appendChunk(id, '../face', 0, Buffer.from(''))).rejects.toThrow();
  });

  it('appends events as JSONL with serverT', async () => {
    const s = createStore(root);
    const id = await s.createSession({ kid: 'A', game: 'g', round: 'learn' });
    const n = await s.appendEvents(id, [{ t: 1, type: 'start' }, { t: 2, type: 'miss', data: { x: 1 } }], 99);
    expect(n).toBe(2);
    const lines = (await readFile(join(root, id, 'events.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l));
    expect(lines).toEqual([{ t: 1, type: 'start', serverT: 99 }, { t: 2, type: 'miss', data: { x: 1 }, serverT: 99 }]);
  });

  it('drops events without a numeric t or string type', async () => {
    const s = createStore(root);
    const id = await s.createSession({ kid: 'A', game: 'g', round: 'learn' });
    expect(await s.appendEvents(id, [{ t: 'x', type: 'a' } as any, { t: 1 } as any], 5)).toBe(0);
  });
});
```

Run: `npx vitest run tests/store.test.ts` — Expected: FAIL, cannot find module.

- [ ] **Step 5: Implement store.ts**

```ts
import { mkdir, appendFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidSessionId, newSessionId } from './ids.ts';

export type SessionMeta = { kid: string; game: string; round: string; device?: string };
export type GameEvent = { t: number; type: string; data?: unknown };

const TRACK = /^[a-z]{1,16}$/;
const JSON_NAMES = new Set(['manifest', 'report', 'session']);

export function createStore(root: string) {
  const nextSeq = new Map<string, number>();

  function dir(id: string): string {
    if (!isValidSessionId(id)) throw new Error(`bad session id: ${id}`);
    return join(root, id);
  }

  return {
    dir,

    async createSession(meta: SessionMeta): Promise<string> {
      const id = newSessionId([meta.kid, meta.game, meta.round]);
      await mkdir(dir(id), { recursive: true });
      await writeFile(join(dir(id), 'session.json'), JSON.stringify({ id, ...meta, createdAt: Date.now() }, null, 2));
      return id;
    },

    async appendChunk(id: string, track: string, seq: number, buf: Buffer): Promise<void> {
      const d = dir(id);
      if (!TRACK.test(track)) throw new Error(`bad track: ${track}`);
      const key = `${id}/${track}`;
      const expected = nextSeq.get(key) ?? 0;
      if (seq !== expected) throw new Error(`expected seq ${expected}, got ${seq}`);
      await mkdir(d, { recursive: true });
      await appendFile(join(d, `${track}.webm`), buf);
      nextSeq.set(key, expected + 1);
    },

    async writeJson(id: string, name: string, obj: unknown): Promise<void> {
      if (!JSON_NAMES.has(name)) throw new Error(`bad json name: ${name}`);
      await mkdir(dir(id), { recursive: true });
      await writeFile(join(dir(id), `${name}.json`), JSON.stringify(obj, null, 2));
    },

    async appendEvents(id: string, events: GameEvent[], serverT: number): Promise<number> {
      const ok = events.filter(e => e && typeof e.t === 'number' && typeof e.type === 'string');
      if (ok.length === 0) return 0;
      await mkdir(dir(id), { recursive: true });
      await appendFile(join(dir(id), 'events.jsonl'), ok.map(e => JSON.stringify({ ...e, serverT })).join('\n') + '\n');
      return ok.length;
    },
  };
}
```

Run: `npx vitest run tests/store.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 6: Write failing tests for the HTTP app**

`tests/app.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/server/app.ts';

let root: string, base: string, server: ReturnType<typeof createApp>;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pw-app-'));
  server = createApp(root);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const post = (path: string, body: BodyInit, type = 'application/json') =>
  fetch(base + path, { method: 'POST', body, headers: { 'content-type': type } });

describe('app', () => {
  it('creates a session, takes chunks and json', async () => {
    const { id } = await (await post('/api/sessions', JSON.stringify({ kid: 'B', game: 'hoard-keeper', round: 'check' }))).json();
    expect(id).toMatch(/-b-hoard-keeper-check$/);
    expect((await post(`/api/sessions/${id}/chunk?track=screen&seq=0`, new Uint8Array([1, 2]), 'application/octet-stream')).status).toBe(204);
    expect((await post(`/api/sessions/${id}/json/manifest`, JSON.stringify({ tracks: {} }))).status).toBe(204);
    expect([...await readFile(join(root, id, 'screen.webm'))]).toEqual([1, 2]);
  });

  it('accepts events cross-origin and answers preflight', async () => {
    const { id } = await (await post('/api/sessions', JSON.stringify({ kid: 'C', game: 'g', round: 'learn' }))).json();
    const pre = await fetch(`${base}/events/${id}`, { method: 'OPTIONS' });
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
    const res = await post(`/events/${id}`, JSON.stringify([{ t: 1, type: 'start' }]));
    expect(await res.json()).toEqual({ stored: 1 });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('rejects a bad session id with 400', async () => {
    expect((await post('/events/..%2Fx', JSON.stringify({ t: 1, type: 'a' }))).status).toBe(400);
  });

  it('returns 404 for unknown routes', async () => {
    expect((await fetch(base + '/nope.html')).status).toBe(404);
  });
});
```

Run: `npx vitest run tests/app.test.ts` — Expected: FAIL, cannot find module.

- [ ] **Step 7: Implement app.ts and main.ts**

`src/server/app.ts`:
```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from './store.ts';

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
      const status = err.status ?? (/bad |expected seq|JSON/.test(String(err.message)) ? 400 : 500);
      send(res, status, { error: String(err.message) }, path.startsWith('/events') ? CORS : {});
    }
  });
}
```

`src/server/main.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';

const PORT = Number(process.env.PORT ?? 3058);
const root = fileURLToPath(new URL('../../recordings/', import.meta.url));
createApp(root).listen(PORT, '0.0.0.0', () => console.log(`playtest-watcher on http://localhost:${PORT}`));
```

Listening on `0.0.0.0` is deliberate: the iPad posts game events over home Wi-Fi.

Run: `npm test` — Expected: PASS, all three files.

- [ ] **Step 8: public/recorder.js (shared capture helpers)**

```js
// Capture helpers shared by spike.html and record.html. Exposes window.PW.
(() => {
  const MIME = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
  const AUDIO_MIME = ['audio/webm;codecs=opus', 'audio/webm'].find(m => MediaRecorder.isTypeSupported(m));

  async function listDevices() {
    // Labels are empty until the page has had camera and mic permission once.
    const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    probe.getTracks().forEach(t => t.stop());
    const all = await navigator.mediaDevices.enumerateDevices();
    return { cameras: all.filter(d => d.kind === 'videoinput'), mics: all.filter(d => d.kind === 'audioinput') };
  }

  const openCamera = (deviceId, { width, height, fps }) => navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: deviceId }, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps } },
    audio: false,
  });

  const openMic = deviceId => navigator.mediaDevices.getUserMedia({
    audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    video: false,
  });

  const openScreen = () => navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });

  function startTrackRecorder(sessionId, trackName, stream) {
    const audioOnly = stream.getVideoTracks().length === 0;
    const rec = new MediaRecorder(stream, { mimeType: audioOnly ? AUDIO_MIME : MIME });
    let seq = 0, bytes = 0, chain = Promise.resolve(), failed = null;
    const startedAt = Date.now();
    rec.ondataavailable = e => {
      if (!e.data.size) return;
      const n = seq++;
      bytes += e.data.size;
      // Chunks must arrive in order, so uploads are chained.
      chain = chain.then(() => fetch(`/api/sessions/${sessionId}/chunk?track=${trackName}&seq=${n}`, {
        method: 'POST', body: e.data, headers: { 'content-type': 'application/octet-stream' },
      })).then(r => { if (!r.ok) throw new Error(`${trackName} chunk ${n}: ${r.status}`); })
        .catch(err => { failed = failed ?? err; });
    };
    rec.start(1000);
    return {
      startedAt,
      mimeType: rec.mimeType,
      stats: () => ({ chunks: seq, bytes, error: failed && String(failed.message) }),
      stop: () => new Promise(resolve => {
        rec.onstop = () => chain.then(resolve);
        rec.stop();
      }),
    };
  }

  function frameCounter(video) {
    // Counts frames actually presented, to catch a camera that silently stalls.
    let total = 0, windowFrames = 0, last = performance.now(), fps = 0;
    const tick = () => {
      total++; windowFrames++;
      const now = performance.now();
      if (now - last >= 1000) { fps = windowFrames * 1000 / (now - last); windowFrames = 0; last = now; }
      video.requestVideoFrameCallback(tick);
    };
    video.requestVideoFrameCallback(tick);
    return { fps: () => fps, total: () => total };
  }

  window.PW = { listDevices, openCamera, openMic, openScreen, startTrackRecorder, frameCounter, MIME, AUDIO_MIME };
})();
```

- [ ] **Step 9: public/spike.html**

A page with two camera selects, a mic select, a duration box (default 10 minutes) and Start. While running it shows four previews with live fps per camera and screen, plus each track's `MediaStreamTrack.stats` (`deliveredFrames`, `discardedFrames`, `totalFrames`) where Chrome provides it. Every 10 seconds it samples the numbers. At the end it stops every recorder, posts `report.json` (settings each track actually got from `getSettings()`, samples, min/avg fps, discarded frames, bytes, chunk upload errors) and prints a PASS/FAIL verdict:

- PASS when every video track averaged at least 90% of its requested fps, no camera sat below 50% of its requested fps for more than 5 seconds, discarded frames were under 1% of total, and no chunk upload failed.

Code: see `public/spike.html` in the repo (written in this task; about 150 lines).

- [ ] **Step 10: Verify in the browser and commit**

Run: `npm start`, open `http://localhost:3058/spike.html` in Chrome, pick the MacBook camera as face, the Anker C200 as hands, the Anker mic, share the full screen, run 1 minute first, then the full 10.
Expected: PASS verdict, `recordings/spike-*/` holds `face.webm`, `hands.webm`, `mic.webm`, `screen.webm`, `report.json`, and `ffprobe` reads every file.

```bash
git add package.json package-lock.json tsconfig.json src tests public
git commit -m "Capture: server skeleton and two-camera spike"
```

If the spike fails: try the hands camera at 640x480@15, then move cameras to different USB ports, then fall back to OBS (spec section 4). Record the outcome in `docs/superpowers/spikes/2026-10-27-cameras.md`.

---

### Task 2: Recorder page (`record.html`)

**Files:**
- Create: `public/record.html`
- Modify: nothing on the server (the API from Task 1 covers it)

**Interfaces:**
- Consumes: `window.PW` from Task 1; `POST /api/sessions`, `/chunk`, `/json/manifest`.
- Produces: per session, `recordings/<id>/{session.json, face.webm, hands.webm, mic.webm, screen.webm, manifest.json}`. `manifest.json` is `{ id, startedAt, stoppedAt, tracks: { [name]: { startedAt, mimeType, settings, bytes, chunks } }, game: { url } }`. Plan 2's align stage reads it.

- [ ] **Step 1:** The setup panel: Kid (A–D buttons), Game (factor-slicer, bond-swap, hoard-keeper, current-cut), Round (learn or check), Device (ipad or laptop), camera and mic selects remembered in `localStorage`. "Get ready" creates the session (`POST /api/sessions`) and opens all four sources with the spike's proven settings.
- [ ] **Step 2:** Show the session id and the game link to open on the iPad, with `?playtest=<id>&pw=http://<laptop-ip>:3058` filled in, plus a QR code so it's quick to open on the iPad (use `https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js`). The laptop IP comes from a new `GET /api/info` returning `{ lanIps: string[] }` (add it to `app.ts` with a test in `tests/app.test.ts` that asserts `lanIps` is an array).
- [ ] **Step 3:** Start starts all four recorders within the same tick and records each `startedAt`. A 10:00 countdown shows; at zero it beeps but keeps recording until Stop, so a kid mid-level isn't cut off.
- [ ] **Step 4:** Stop stops all recorders, waits for uploads, posts `manifest.json`, then shows a summary: duration, bytes per track, events received (from a new `GET /api/sessions/:id/summary` returning `{ eventCount, files: {name: bytes} }`, also tested in `tests/app.test.ts`).
- [ ] **Step 5:** Verify in Chrome with a 2-minute dry session, and check `ffprobe` on each file and that `manifest.json` start times are within 200 ms of each other. Commit: `git commit -m "Capture: recorder page"`.

---

### Task 3: `playtest-log.js` and the three web games

**Files:**
- Create: `public/playtest-log.js` (canonical copy)
- In each game repo, on branch `playtest-log`: copy the snippet, load it from the game's HTML, and call `PlaytestLog.log(type, data)` at the game's key moments.

**Interfaces:**
- Produces: `window.PlaytestLog = { enabled: boolean, log(type: string, data?: object): void }`. A no-op unless the page URL has `playtest` and `pw` parameters. Batches events every 500 ms and on `pagehide` (using `fetch(..., { keepalive: true })`), posting to `${pw}/events/${playtest}`.

- [ ] **Step 1:** Write the snippet with a test page `public/playtest-log-test.html` that logs three events, and an app test proving the batch lands in `events.jsonl` in order with each event's own `t`.
- [ ] **Step 2: Factor Slicer** (`factor-slicer/www/`): log `run_start`, `wave_start {blade}`, `slice {n, correct}`, `miss {n}`, `wrong_cut {n}`, `life_lost`, `fusion`, `run_end {score, waves}`. Its core already has hook points in `factor-slicer-core.js`; wire the calls there.
- [ ] **Step 3: Bond Swap**: log `level_start {level}`, `swap {valid}`, `bond {molecule}`, `stir`, `stuck {seconds}` (no valid swap made for 8 s), `level_end {result, moves}`, `compendium_open`.
- [ ] **Step 4: Hoard Keeper** (`hoard-keeper/src/game.js`): log `rush_start`, `file_item {bin, correct}`, `rush_end {score}`, `audit_start {question}`, `query_step {kind}`, `audit_answer {correct}`, `upgrade {name}`.
- [ ] **Step 5:** For each game: run its own `npm test` and build, open it with `?playtest=<test id>&pw=http://localhost:3058`, play 1 minute, confirm events arrive, commit on the `playtest-log` branch, push the branch, and open a PR in that repo (no merge without Joel).

---

### Task 4: Current Cut event autoload (Godot)

**Files:**
- Create: `godot/playtest_log.gd` (canonical copy)
- In `current-cut` on branch `playtest-log`: add `game/scripts/playtest_log.gd` and register it as an autoload in `game/project.godot`.

**Interfaces:**
- Produces: autoload `PlaytestLog` with `log_event(type: String, data := {})`. Active only when `OS.get_cmdline_user_args()` contains `--playtest=<id>` and `--pw=<url>`. Uses `Time.get_unix_time_from_system() * 1000.0` for `t`, batches every 0.5 s through one `HTTPRequest` node at a time.

- [ ] **Step 1:** Write the autoload and a headless test scene `game/tests/test_playtest_log.gd` that checks it stays disabled with no args and builds the right payload when enabled.
- [ ] **Step 2:** Wire `level_start {level}`, `cut {wire}`, `short_circuit`, `undo`, `hint`, `level_end {result, cuts}`.
- [ ] **Step 3:** Run `cd tools && npm test` and `godot --headless --path game -s tests/test_parity.gd` (repo rule), plus the new test. Run `godot --path game -- --playtest=<id> --pw=http://localhost:3058`, play a level, confirm events arrive. Commit on the branch, push, open the PR.

---

### Task 5: Session-day checklist and launch entry

**Files:**
- Create: `docs/session-day.md`
- Modify: workspace `CLAUDE.md` port table (add `playtest-watcher | 3058`), workspace `.claude/launch.json` (add `playtest-watcher`, `npm start`, port 3058)

- [ ] **Step 1:** Write the one-page checklist Joel follows each session: plug in iPad, QuickTime mirror, open `/record.html`, pick kid/game/round, scan the QR on the iPad, check the events counter ticks, Start, play 10 minutes, Stop, confirm the summary.
- [ ] **Step 2:** Run `node scripts/check-ports.mjs` at the workspace root. Expected: no drift.
- [ ] **Step 3:** Commit (`playtest-watcher` repo for the checklist; the workspace files are untracked config).
