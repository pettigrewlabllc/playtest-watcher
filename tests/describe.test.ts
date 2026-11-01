import { describe, it, expect } from 'vitest';
import { placeLevel, toPersona } from '../src/persona/describe.ts';
import { compile } from '../src/persona/compile.ts';

const limitsJson = {
  per_game: { J: { g: { first_tap_s: 4, action_gap_s: 1, read_ms_per_char: 60, read_share: 0.5, error_rate: 0.05, idle_per_min: 1.5 } } },
  held_out: Object.fromEntries(['A', 'B', 'C', 'D'].map((k, i) => [k, { g: Object.fromEntries(['first_tap_s', 'action_gap_s', 'read_share', 'error_rate', 'idle_per_min'].map(m => [m, { ratio: [1, 1.2, 1.6, 2][i] }])) }])),
};

describe('described persona', () => {
  it('places the five steps on the real kids\' spread', () => {
    const r = [1, 1.2, 1.6, 2];
    expect(placeLevel(0, r)).toBeCloseTo(1.4);
    expect(placeLevel(-1, r)).toBe(1);
    expect(placeLevel(1, r)).toBe(2);
    expect(placeLevel(2, r)).toBeCloseTo(2.3);
    expect(placeLevel(-2, r)).toBeCloseTo(0.8);
  });

  it('becomes a persona the compiler turns into rules, marked as described not measured', () => {
    const p = toPersona('X', 'g', { age: 9, dims: [{ name: 'reading', level: -2, because: 'skips everything' }, { name: 'pace', level: 0, because: '' }], limits: [{ name: 'read_share', level: -2, because: 'skips' }], patience: 2, drives: [{ drive: 'speed', pull: 0.9, because: 'loves racing' }, { drive: 'bogus', pull: 1, because: '' }], plays_for: 'winning', keeps_going: '', quits_when: 'two fails' } as never, limitsJson, 'a kid who skips everything');
    expect(p.limits.read_share.value).toBeCloseTo(0.5 * 0.8);
    expect(p.limits.first_tap_s.value).toBeCloseTo(4 * 1.4);
    expect(p.limits.sour_after_fails.value).toBe(2);
    expect(p.dimensions.reading).toMatchObject({ value: -1, distinguishable: true, sources: ['description'] });
    expect(p.dimensions.pace.distinguishable).toBe(false);
    expect(p.drives.map(d => d.drive)).toEqual(['speed']);
    expect(p.distinguishable).toMatch(/nothing here was measured/);
    const c = compile(p);
    expect(c.rules.map(r => r.from)).toEqual(['reading', 'drive:speed']);
    expect(c.harness.sourAfterFails).toBe(2);
  });
});

import { toPersona as place } from '../src/persona/describe.ts';
describe('a described limit follows its trait', () => {
  it('lowers read share when the description lowers reading and leaves the limit unrated', () => {
    const L = { per_game: { J: { g: { read_share: 0.6 } } }, held_out: { A: { g: { read_share: { ratio: 0.5 } } }, B: { g: { read_share: { ratio: 1 } } }, C: { g: { read_share: { ratio: 1.5 } } } } };
    const base = { age: 16, limits: [{ name: 'read_share', level: 0, because: 'not mentioned' }], patience: null, drives: [], plays_for: '', keeps_going: '', quits_when: '' };
    const typical = place('T', 'g', { ...base, dims: [] } as any, L, '').limits.read_share.value!;
    const low = place('T', 'g', { ...base, dims: [{ name: 'reading', level: -1, because: 'dislikes reading' }] } as any, L, '').limits.read_share.value!;
    expect(typical).toBeCloseTo(0.6);
    expect(low).toBeCloseTo(0.3);
  });
});
