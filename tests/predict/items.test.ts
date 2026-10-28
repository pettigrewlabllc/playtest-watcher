import { describe, it, expect } from 'vitest';
import { itemsFromProbs } from '../../src/predict/predict.ts';
import type { RowProbs } from '../../src/predict/model.ts';

const row = (i: number, stage: string, p: Partial<Record<string, number>>): RowProbs => {
  const base = { confused: 0, stuck: 0, bored: 0, frustrated: 0, delighted: 0, none: 0, ...p };
  return { i, stage, p: base as RowProbs['p'] };
};

describe('itemsFromProbs: the same top-2-per-stage budget as every other predictor', () => {
  it('ranks labels per stage by mean probability, ignoring absolute thresholds and none', () => {
    const probs = [
      row(0, 'level 1', { none: 0.9, bored: 0.06, delighted: 0.03, stuck: 0.01 }),
      row(1, 'level 1', { none: 0.9, bored: 0.02, delighted: 0.05, stuck: 0.03 }),
      row(2, 'level 2', { frustrated: 0.95, confused: 0.03, none: 0.02 }),
      row(3, 'level 2', { frustrated: 0.2, confused: 0.1, stuck: 0.05, none: 0.65 }),
    ];
    const types = ['swap', 'bond', 'swap', 'stuck'];
    const items = itemsFromProbs(probs, i => types[i]);
    const at = (s: string) => items.filter(x => x.stage === s);
    expect(at('level 1').map(x => x.label)).toEqual(['bored', 'delighted']);   // low but ranked: same budget as the rest
    expect(at('level 2').map(x => x.label)).toEqual(['frustrated', 'confused']);
    expect(at('level 2')[0]).toMatchObject({ event_type: 'swap', p: (0.95 + 0.2) / 2 });   // event type: the row where the label peaks
    expect(items.some(x => x.label === 'none')).toBe(false);
  });

  it('skips labels with no probability anywhere in the stage', () => {
    const items = itemsFromProbs([row(0, 'start', { none: 0.99, stuck: 0.01 })], () => 'idle');
    expect(items.map(x => x.label)).toEqual(['stuck']);
  });
});
