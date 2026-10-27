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

  it('reports LAN ips and the question list', async () => {
    expect(Array.isArray((await (await fetch(base + '/api/info')).json()).lanIps)).toBe(true);
    expect(await (await fetch(base + '/api/questions')).json()).toHaveLength(12);
  });

  it('saves a scored questionnaire per kid and rejects other kids', async () => {
    expect((await post('/api/kids/b/questionnaire', JSON.stringify({ answers: { 3: 'a', 4: 'a' } }))).status).toBe(200);
    const saved = JSON.parse(await readFile(join(root, 'kids', 'b', 'questionnaire.json'), 'utf8'));
    expect(saved.scores.read).toBe(-1);
    expect((await post('/api/kids/e/questionnaire', JSON.stringify({ answers: {} }))).status).toBe(400);
  });

  it('summarises a session', async () => {
    const { id } = await (await post('/api/sessions', JSON.stringify({ kid: 'D', game: 'g', round: 'learn' }))).json();
    await post(`/events/${id}`, JSON.stringify([{ t: 1, type: 'a' }, { t: 2, type: 'b' }]));
    const s = await (await fetch(`${base}/api/sessions/${id}/summary`)).json();
    expect(s.eventCount).toBe(2);
    expect(s.files['session.json']).toBeGreaterThan(0);
  });
});
