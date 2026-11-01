import { describe, it, expect } from 'vitest';
import { NORMS, reactionMs, timingSdMs, tapMiss, readingWpm, msPerChar } from '../src/persona/norms.ts';
import { compile } from '../src/persona/compile.ts';

describe('published norms', () => {
  it('match the sources they cite', () => {
    expect(reactionMs(14).ms).toBe(288);                  // Rutter 2020: fastest at 14
    expect(reactionMs(10).ms - reactionMs(14).ms).toBeCloseTo(23, -1); // 5.7 ms a year, 10 to 14
    expect(timingSdMs(17.8)).toBeLessThan(timingSdMs(10));
    expect(tapMiss(9).rate).toBe(0.12);                   // Anthony 2019, 9.5 mm, ages 7-10
    expect(tapMiss(40).rate).toBe(0.03);
    expect(readingWpm(null).wpm).toBe(238);               // Brysbaert 2019
    expect(readingWpm(12).wpm).toBe(185);                 // grade 6, Taylor 1965
    expect(Math.round(msPerChar(238))).toBe(42);
  });

  it('every norm names at least one source with a link', () => {
    for (const n of NORMS) {
      expect(n.sources.length, n.id).toBeGreaterThan(0);
      for (const s of n.sources) expect(s.url, n.id).toMatch(/^(https:\/\/|results\/)/);
    }
  });

  it("fill a persona's gaps by age, and never override a measured number", () => {
    const empty = { first_tap_s: { value: null }, action_gap_s: { value: null }, read_share: { value: null }, read_ms_per_char: { value: null }, error_rate: { value: null }, sour_after_fails: { value: null } };
    const kid = compile({ age: 9, dimensions: {}, drives: [], limits: empty } as any).harness;
    const adult = compile({ age: null, adult: true, dimensions: {}, drives: [], limits: empty } as any).harness;
    expect(kid.errorRate).toBe(0.12);
    expect(adult.errorRate).toBe(0.03);
    expect(kid.readMsPerChar).toBeGreaterThan(adult.readMsPerChar);
    const measured = compile({ age: 9, dimensions: {}, drives: [], limits: { ...empty, error_rate: { value: 0.3 } } } as any).harness;
    expect(measured.errorRate).toBe(0.3);
  });
});
