import { describe, it, expect } from 'vitest';
import { reactionFor, AGE_NORMS, AGE_NORMS_SOURCE } from '../src/persona/realtime.ts';
import { shouldAsk, summarizeRt, cleanPlan, HANDS_ONLY_PLAN, THINGS, ACTS } from '../src/agent/realtime.ts';

describe('reaction model', () => {
  it('slows and spreads with youth, from the age table, and says it is assumed', () => {
    expect(reactionFor(8)).toEqual({ rtMs: 450, timingSdMs: 90 });
    expect(reactionFor(14)).toEqual({ rtMs: 310, timingSdMs: 55 });
    expect(reactionFor(11)).toEqual({ rtMs: 370, timingSdMs: 70 });   // between 10 and 12
    expect(reactionFor(3).rtMs).toBe(AGE_NORMS[0][1]);
    expect(reactionFor(40).rtMs).toBe(AGE_NORMS.at(-1)![1]);
    expect(reactionFor(null)).toEqual(reactionFor(10));
    const ages = [6, 8, 10, 12, 14, 18].map(a => reactionFor(a));
    for (let i = 1; i < ages.length; i++) { expect(ages[i].rtMs).toBeLessThan(ages[i - 1].rtMs); expect(ages[i].timingSdMs).toBeLessThan(ages[i - 1].timingSdMs); }
    expect(AGE_NORMS_SOURCE).toMatch(/^assumed/);
    expect(AGE_NORMS_SOURCE).toMatch(/not measured from these kids/);
  });
});

describe('when to ask', () => {
  const base = { thingsNow: ['log'], askedAbout: new Set(['log']), happened: 0, sinceAskMs: 0, recheckMs: 2500, first: false };
  it('asks at the start of a run, after something happened, for a new kind of thing, and on the recheck', () => {
    expect(shouldAsk({ ...base, first: true })).toBe('run start');
    expect(shouldAsk({ ...base, happened: 1 })).toBe('something happened');
    expect(shouldAsk({ ...base, thingsNow: ['log', 'gap'] })).toBe('new on screen: gap');
    expect(shouldAsk({ ...base, sinceAskMs: 2500 })).toBe('recheck');
  });
  it('lets the plan run on its own otherwise', () => {
    expect(shouldAsk(base)).toBeNull();
    expect(shouldAsk({ ...base, sinceAskMs: 2400 })).toBeNull();
  });
});

describe('plan', () => {
  it('keeps one do per kind (the first) and drops words outside the vocabulary', () => {
    expect(cleanPlan([{ when: 'gap', do: 'jump' }, { when: 'gap', do: 'walk' }, { when: 'food', do: 'eat' }, { when: 'tree', do: 'jump' }, { when: 'log', do: 'fly' }]))
      .toEqual([{ when: 'gap', do: 'jump' }, { when: 'food', do: 'eat' }]);
  });
});

describe('real-time run summary', () => {
  it('counts runs, slips by kind, presses and how many waited on the kid\'s reaction', () => {
    const step = (n: number, label: string) => ({ n, t: n, kind: 'play', scene: 's', things: [], action: 'play', target: '', intended: null, missed: false, now: 'none', hold_ms: 0, plan: [], label, forced: false, why: 'w', say: '', would_quit: false, happened: [], fails_in_row: 0 });
    const out = summarizeRt({
      steps: [step(1, 'focused'), step(2, 'confused')] as never, calls: 2, gameS: 61.4,
      actions: [{ type: 'press', late_ms: 0 }, { type: 'press', late_ms: 120 }, { type: 'slip' }],
      ended: [{ run: 1, first_run: true, summary: { over: 'home', miles: 20, t: 190, herd: 3, stretch: 'town' }, slips: [{ type: 'bump' }, { type: 'bump' }, { type: 'zap' }] }],
    });
    expect(out).toMatchObject({ calls: 2, game_s: 61, presses: 2, late_presses: 1, slips_drawn: 1, labels: { focused: 1, confused: 1 } });
    expect(out.runs[0]).toMatchObject({ over: 'home', miles: 20, slips: { bump: 2, zap: 1 } });
    expect(out.negative.map(n => n.label)).toEqual(['confused']);
  });
  it('the hands-only plan only uses the plan vocabulary', () => {
    for (const p of HANDS_ONLY_PLAN) { expect(THINGS).toContain(p.when); expect(ACTS).toContain(p.do); }
  });
});
