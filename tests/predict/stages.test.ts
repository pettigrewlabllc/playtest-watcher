import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stageInfoOf, stagesOf } from '../../src/predict/stages.ts';
import type { AlignedEvent } from '../../src/predict/inputs.ts';

// Shared with analysis/tests/test_stages.py so the two stage maps stay identical.
const CASES = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'stages.json'), 'utf8')) as
  { game: string; events: AlignedEvent[]; stages: string[]; runs?: number[] }[];

describe('stagesOf: game content, never screen names', () => {
  for (const [n, c] of CASES.entries()) {
    it(`${c.game} #${n}`, () => {
      expect(stagesOf(c.events, c.game)).toEqual(c.stages);
      if (c.runs) expect(stageInfoOf(c.events, c.game).map(s => s.run)).toEqual(c.runs);
    });
  }

  it('a screen event never starts or changes a stage', () => {
    const screen = (ms: number, name: string): AlignedEvent => ({ ms, type: 'screen', kind: 'progress', data: { kind: 'progress', name } });
    const ev = [{ ms: 0, type: 'level_start', kind: 'progress', data: { level: 4 } }, screen(1, 'title'), screen(2, '7')];
    expect(stagesOf(ev, 'bond-swap')).toEqual(['level 4', 'level 4', 'level 4']);
    expect(stagesOf(ev, 'unknown')).toEqual(['4', '4', '4']);
  });
});
