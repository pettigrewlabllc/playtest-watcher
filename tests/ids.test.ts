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

import { claimSessionDir } from '../src/server/ids.ts';
import { mkdtemp as mkdtempIds } from 'node:fs/promises';
import { tmpdir as tmpdirIds } from 'node:os';
import { join as joinIds } from 'node:path';
describe('claimSessionDir', () => {
  it('never hands two runs the same folder, even in the same second', async () => {
    const root = await mkdtempIds(joinIds(tmpdirIds(), 'ids-'));
    const ids = await Promise.all([1, 2, 3].map(() => claimSessionDir(root, '20261101-231939-p-hoard-keeper-agent')));
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain('20261101-231939-p-hoard-keeper-agent-2');
  });
});
