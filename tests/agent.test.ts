import { describe, it, expect } from 'vitest';
import { rng, jitter, missTarget, summarize } from '../src/agent/play.ts';
import { compile, rulesText } from '../src/persona/compile.ts';

const persona = (over: Record<string, unknown> = {}) => ({
  schema: 'persona/1', letter: 'A', age: 9, target_game: 'hoard-keeper', built: '',
  observer: { kid_checked_clips: 5, kid_vs_muse_kappa: 0.05, muse_self_agreement: 0.83, note: '' },
  dimensions: {
    skill: { value: -0.7, lo: -1.1, hi: -0.1, n: 30, sources: ['play'], distinguishable: true },
    pace: { value: -0.5, lo: -3, hi: 1.8, n: 30, sources: ['play'], distinguishable: false },
  },
  distinguishable: '1 of 2',
  limits: {
    first_tap_s: { value: 7, ratio: 1.5, lo: 1, hi: 2, from: [] }, action_gap_s: { value: 1.3, ratio: 1, lo: 1, hi: 1, from: [] },
    read_share: { value: 1.4, ratio: 1, lo: 1, hi: 1, from: [] }, read_ms_per_char: { value: null, ratio: null, lo: null, hi: null, from: [] },
    error_rate: { value: 0.14, ratio: 1, lo: 1, hi: 1, from: [] }, idle_per_min: { value: 2, ratio: 1, lo: 1, hi: 1, from: [] },
    sour_after_fails: { value: 2.6, ratio: null, lo: null, hi: null, from: [] },
  },
  drives: [{ drive: 'creativity', pull: 0.9, evidence: '' }, { drive: 'mastery', pull: -1, evidence: '' }, { drive: 'story', pull: 0.2, evidence: '' }],
  card: { plays_for: '', keeps_going: '', quits_when: 'when lost' }, ...over,
}) as never;

describe('compiler', () => {
  it('writes rules only for clearly different dimensions and strong drives, and clamps the harness', () => {
    const c = compile(persona());
    expect(c.rules.map(r => r.from)).toEqual(['skill', 'drive:creativity', 'drive:mastery', 'interview']);
    expect(c.harness).toMatchObject({ firstTapS: 7, actionGapS: 1.3, readShare: 1, readMsPerChar: 67, errorRate: 0.14, sourAfterFails: 3 });
    const text = rulesText(c, 'A', 8);
    expect(text).toMatch(/Player A, a child aged 9/);
    expect(text).toMatch(/You read about 100% of instructions/);
    expect(text).not.toMatch(/pace|Move fast|Take your time/);
  });
});

describe('harness', () => {
  it('is repeatable for a seed and spreads timing around the median', () => {
    const a = rng(7), b = rng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const r = rng(1);
    const xs = Array.from({ length: 2000 }, () => jitter(2, r)).sort((x, y) => x - y);
    expect(xs[1000]).toBeGreaterThan(1.7); expect(xs[1000]).toBeLessThan(2.3);
    expect(xs.every(x => x > 0.6 && x < 7)).toBe(true);
  });

  it('sends a missed tap to a neighbouring button', () => {
    const r = rng(3);
    expect(missTarget(0, 5, r)).toBe(1);
    expect(missTarget(4, 5, r)).toBe(3);
    expect([1, 3]).toContain(missTarget(2, 5, r));
    expect(missTarget(0, 1, r)).toBe(0);
  });

  it('summarizes a run', () => {
    const s = (n: number, label: string, extra = {}) => ({ n, t: n * 2, screen: '', action: 'tap', target: '', intended: null, missed: false, read: ['a'], skipped: [], label, forced: false, why: '', say: '', would_quit: false, fails_in_row: 0, ...extra });
    const out = summarize([s(1, 'focused'), s(2, 'confused', { missed: true, skipped: ['x'] }), s(3, 'frustrated', { forced: true, action: 'quit' })] as never);
    expect(out).toMatchObject({ steps: 3, game_s: 6, missed: 1, forced: 1, skipped_texts: 1, read_texts: 1, quit: true, labels: { focused: 1, confused: 1, frustrated: 1 } });
  });
});
