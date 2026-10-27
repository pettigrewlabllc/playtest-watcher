import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { align } from '../../src/watch/align.ts';
import { probeDurationMs } from '../../src/watch/ffmpeg.ts';
import { fakeSession, tmp, T0 } from './helpers.ts';

describe('align', () => {
  it('writes aligned.json with offsets, proxies, wav chunk and events', async () => {
    const dir = await tmp();
    await fakeSession(dir, {
      events: [
        { t: T0 - 300, type: 'level_start', data: { kind: 'progress' }, serverT: T0 + 1000 },
        'not json',
        { t: T0 - 300, type: 'swap', data: {}, serverT: T0 + 500 },
      ],
    });
    const a = await align(dir);
    expect(JSON.parse(await readFile(join(dir, 'aligned.json'), 'utf8'))).toEqual(a);
    expect(a.t0).toBe(T0);
    expect(a.durationMs).toBe(3000);
    expect(a.tracks.face?.offsetMs).toBe(120);
    expect(a.tracks.screen?.offsetMs).toBe(0);
    expect(a.tracks.hands).toBeUndefined();
    expect(a.tracks.face?.height).toBe(480);
    expect(Math.abs((await probeDurationMs(join(dir, a.tracks.face!.mp4))) - 3000)).toBeLessThan(300);
    expect(a.audio?.wavChunks).toHaveLength(1);
    expect(a.audio?.wavChunks[0].startMs).toBe(0);
    expect(a.audio?.offsetMs).toBe(50);
    expect(a.events).toEqual([
      { ms: 500, type: 'swap', kind: 'other', data: {} },
      { ms: 1000, type: 'level_start', kind: 'progress', data: { kind: 'progress' } },
    ]);
    expect(a.gameClockSkewMs).toBe(-1050);
  }, 20000);

  it('degrades when media and events are missing', async () => {
    const dir = await tmp();
    await fakeSession(dir, { mic: false });
    const a = await align(dir);
    expect(a.audio).toBeUndefined();
    expect(a.events).toEqual([]);
    expect(existsSync(join(dir, 'face.mp4'))).toBe(true);
  }, 20000);
});
