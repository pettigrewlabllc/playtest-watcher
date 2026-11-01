import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBlend, pickMember, type Blend } from '../src/persona/blend.ts';

describe('group personas', () => {
  it('shows the middle and spread of the members, counting each member once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'blend-'));
    await mkdir(join(root, 'group'), { recursive: true });
    await writeFile(join(root, 'group', 'limits.json'), JSON.stringify({ per_game: {
      A: { g: { first_tap_s: 2, read_share: 0.2 } }, B: { g: { first_tap_s: 6, read_share: 1 } }, C: { g: { first_tap_s: 4 } } } }));
    for (const [k, pull] of [['a', 0.8], ['b', -0.2], ['c', 0.4]] as const) {
      await mkdir(join(root, 'kids', k), { recursive: true });
      await writeFile(join(root, 'kids', k, 'interview.json'), JSON.stringify({ motivation: { drives: [{ drive: 'story', pull }] } }));
    }
    const b = await buildBlend(root, 'Test group', 'test', ['A', 'B', 'C'].map(id => ({ id, kind: 'kid' as const, label: id })));
    expect(b.card.g.first_tap_s).toEqual({ median: 4, lo: 2, hi: 6, n: 3 });
    expect(b.card.g.read_share.n).toBe(2);
    expect(b.drives.story).toEqual({ median: 0.4, n: 3 });
    expect(b.shareable).toBe(false);
  });

  it('picks a whole member per run, the same one for the same seed', () => {
    const b = { members: [1, 2, 3, 4, 5].map(i => ({ id: String(i), kind: 'kid', label: String(i) })) } as unknown as Blend;
    expect(pickMember(b, 3)).toBe(pickMember(b, 3));
    const seen = new Set(Array.from({ length: 40 }, (_, s) => pickMember(b, s)));
    expect(seen.size).toBe(5);
  });
});
