import { describe, it, expect } from 'vitest';
import { clean, matchStage } from '../../src/predict/predict.ts';
import type { StageSummary } from '../../src/predict/predict.ts';

const st = (stage: string): StageSummary => ({ stage, startMs: 0, endMs: 1, kinds: {}, types: { swap: 2 }, screen: [] });
const stages = [st('start'), st('level w1-01-one-short'), st('level w1-1'), st('season 1 rush')];

describe('matchStage', () => {
  it('finds the stage when Muse copies the whole line it was shown', () => {
    expect(matchStage('start (00:00 to 00:02)', stages)?.stage).toBe('start');
    expect(matchStage('stage level w1-01-one-short (00:02 to 00:40)', stages)?.stage).toBe('level w1-01-one-short');
    expect(matchStage('season 1 rush', stages)?.stage).toBe('season 1 rush');
    expect(matchStage('level w1-1', stages)?.stage).toBe('level w1-1');
    expect(matchStage('level w9-9', stages)).toBeUndefined();
  });

  it('keeps items whose stage carries a time range', () => {
    const kept = clean([{ stage: 'start (00:00 to 00:02)', event_type: 'swap', label: 'engaged', p: 0.6, why: 'x' }], stages);
    expect(kept).toHaveLength(1);
    expect(kept[0].stage).toBe('start');
  });
});
