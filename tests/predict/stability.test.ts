import { describe, it, expect } from 'vitest';
import { pickClips, stabilityLine } from '../../src/predict/stability.ts';

describe('label stability', () => {
  it('picks round-robin across labels so rare labels are included', () => {
    const p = (label: string, i: number) => ({ session: 's', id: `${label}${i}`, label });
    const byLabel = new Map([['confused', [0, 1, 2, 3, 4].map(i => p('confused', i))], ['delighted', [p('delighted', 0)]], ['bored', [0, 1].map(i => p('bored', i))]]);
    expect(pickClips(byLabel, 5).map(x => x.id)).toEqual(['confused0', 'bored0', 'delighted0', 'confused1', 'bored1']);
    expect(pickClips(byLabel, 50)).toHaveLength(8);
  });

  it('reports agreement and per-label repeats', () => {
    expect(stabilityLine({ n: 0, kappa: null, agreement: null, secondary_agreement: null, per_label: {}, pairs: [] })).toMatch(/not measured/);
    const line = stabilityLine({ n: 4, kappa: 0.5, agreement: 0.75, secondary_agreement: 1, per_label: { confused: { n: 3, same: 3 }, bored: { n: 1, same: 0 } }, pairs: [] });
    expect(line).toContain('agreed 75%');
    expect(line).toContain('confused 3/3, bored 0/1');
  });
});
