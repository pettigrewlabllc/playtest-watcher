import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listViewable, mediaPath, viewData } from '../src/server/view.ts';

const ID = '20261030-021044-c-current-cut-learn';

async function root() {
  const r = await mkdtemp(join(tmpdir(), 'pw-view-'));
  const d = join(r, ID);
  await mkdir(d);
  await writeFile(join(d, 'session.json'), JSON.stringify({ kid: 'c', game: 'current-cut', round: 'learn' }));
  await writeFile(join(d, 'aligned.json'), JSON.stringify({ durationMs: 60000, tracks: { face: { offsetMs: 120 }, screen: { offsetMs: 0 } }, events: [] }));
  await writeFile(join(d, 'moments.json'), JSON.stringify([
    { id: 'c001', startMs: 1000, endMs: 9000, peak_s: 2, label: 'confused', secondary_label: 'stuck', confidence: 0.7, quote: 'what is this', game_context: 'x', evidence: { face: 'f' }, status: 'ok' },
    { id: 'c002', startMs: 1000, endMs: 9000, label: 'none', status: 'unanalyzed' },
  ]));
  await writeFile(join(d, 'face.mp4'), 'raw');
  await writeFile(join(d, 'face-blur.mp4'), 'blurred');
  return r;
}

describe('viewer data', () => {
  it('never serves the unblurred face, or anything outside the allowlist', async () => {
    const r = await root();
    for (const bad of ['face', 'mic', '../x', 'clips/c001']) expect(() => mediaPath(r, ID, bad)).toThrow(/not found/);
    expect(() => mediaPath(r, '../etc', 'screen')).toThrow();
    expect(mediaPath(r, ID, 'face-blur')).toBe(join(r, ID, 'face-blur.mp4'));
  });

  it('lists analyzed sessions and gives ok moments with the face offset under face-blur', async () => {
    const r = await root();
    expect(await listViewable(r)).toEqual([{ id: ID, kid: 'C', game: 'current-cut', round: 'learn', moments: 1, blurred: true }]);
    const d = await viewData(r, ID);
    expect(d.moments.map(m => [m.id, m.peakMs])).toEqual([['c001', 3000]]);
    expect(d.tracks['face-blur']).toEqual({ offsetMs: 120, available: true });
    expect(d.tracks.hands.available).toBe(false);
  });
});
