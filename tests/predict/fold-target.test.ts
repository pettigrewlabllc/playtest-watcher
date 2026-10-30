import { describe, it, expect } from 'vitest';
import { foldTarget } from '../../src/predict/score.ts';

const s = (id: string, kid: string, round: string) => ({ id, kid, round, game: 'cc', dir: `/x/${id}` }) as never;

describe('foldTarget', () => {
  const all = [s('ref', 'ref', 'reference'), s('b1', 'b', 'learn'), s('c1', 'c', 'learn'), s('a1', 'a', 'learn')];

  it('takes the reference when no overlap is given, else another kid', () => {
    expect((foldTarget(all, 'a', 'cc') as any).id).toBe('ref');
    expect((foldTarget(all.slice(1), 'a', 'cc') as any).id).toBe('b1');
  });

  it('skips a reference that shares no levels with the held-out play', () => {
    expect((foldTarget(all, 'a', 'cc', new Map([['ref', 0], ['b1', 0], ['c1', 5]])) as any).id).toBe('c1');
    expect((foldTarget(all, 'a', 'cc', new Map([['ref', 2], ['c1', 5]])) as any).id).toBe('ref');
    expect((foldTarget(all, 'a', 'cc', new Map()) as any).id).toBe('ref');
  });
});
