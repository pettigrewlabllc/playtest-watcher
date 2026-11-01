import { describe, it, expect } from 'vitest';
import { reflexDefaults, schedule } from '../src/agent/action.ts';
import { rng } from '../src/agent/play.ts';

const rx = { reactionMs: 400, timingSdMs: 100, missRate: 0, sources: [] };
const mv = (at_ms: number, kind: 'press' | 'hold' = 'press') => ({ kind, key: 'Space', button: 0, at_ms, for_ms: 500 });

describe('action-mode timing', () => {
  it('never fires a move before the kid could react, and spreads it by their timing error', () => {
    const r = rng(1);
    const fired = Array.from({ length: 500 }, () => schedule([mv(0)], rx, r)[0].fire_ms!);
    expect(Math.min(...fired)).toBeGreaterThanOrEqual(280);   // floor: 0.7 x reaction
    const mean = fired.reduce((a, b) => a + b, 0) / fired.length;
    expect(mean).toBeGreaterThan(370); expect(mean).toBeLessThan(440);
  });

  it('keeps a planned time later than the reaction time, in order', () => {
    const out = schedule([mv(900), mv(100)], { ...rx, timingSdMs: 0 }, rng(2));
    expect(out.map(m => m.fire_ms)).toEqual([400, 900]);
  });

  it('drops moves at the kid\'s miss rate', () => {
    const r = rng(3);
    const n = Array.from({ length: 2000 }, () => schedule([mv(500)], { ...rx, missRate: 0.1 }, r)[0]).filter(m => m.skipped).length;
    expect(n).toBeGreaterThan(150); expect(n).toBeLessThan(250);
  });

  it('defaults are slower for younger kids and say they are not measured', () => {
    expect(reflexDefaults(8).reactionMs).toBeGreaterThan(reflexDefaults(14).reactionMs);
    expect(reflexDefaults(null).note).toMatch(/not measured/);
  });
});
