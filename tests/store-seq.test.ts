import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore } from '../src/server/store.ts';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'pw-')); });

describe('store: expected seq survives a server restart', () => {
  it('persists the next seq in <track>.seq and a fresh store on the same dir picks it up', async () => {
    const id = await createStore(root).createSession({ kid: 'A', game: 'g', round: 'learn' });
    const first = createStore(root);
    await first.appendChunk(id, 'face', 0, Buffer.from('ab'));
    await first.appendChunk(id, 'face', 1, Buffer.from('cd'));
    expect((await readFile(join(root, id, 'face.seq'), 'utf8')).trim()).toBe('2');

    const restarted = createStore(root);
    await restarted.appendChunk(id, 'face', 2, Buffer.from('ef'));
    expect(await readFile(join(root, id, 'face.webm'), 'utf8')).toBe('abcdef');
    await expect(restarted.appendChunk(id, 'face', 5, Buffer.from('x'))).rejects.toThrow(/expected seq 3/);
    await restarted.appendChunk(id, 'hands', 0, Buffer.from('h'));   // a new track still starts at 0
  });

  it('accepts a retried chunk it already stored without appending it twice', async () => {
    const s = createStore(root);
    const id = await s.createSession({ kid: 'A', game: 'g', round: 'learn' });
    await s.appendChunk(id, 'face', 0, Buffer.from('ab'));
    await s.appendChunk(id, 'face', 0, Buffer.from('ab'));   // the response was lost; the recorder sends it again
    await s.appendChunk(id, 'face', 1, Buffer.from('cd'));
    expect(await readFile(join(root, id, 'face.webm'), 'utf8')).toBe('abcd');
  });
});
