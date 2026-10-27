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

  it('refuses events for a session the recorder never created', async () => {
    const s = createStore(root);
    await expect(s.appendEvents('20261027-000000-d-old-test', [{ t: 1, type: 'page_hide' }], 5)).rejects.toThrow(/no such session/);
  });
});
