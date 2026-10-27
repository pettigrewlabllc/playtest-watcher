import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sessionFingerprint, playerFingerprint, averageFingerprints, NUMERIC_FIELDS } from '../../src/predict/fingerprint.ts';
import { ev, moment, tempRoot, writeSession } from './helpers.ts';

function known() {
  return [
    ev(0, 'attempt'), ev(1000, 'fail'), ev(3000, 'attempt'),     // recovery 2
    ev(4000, 'fail'), ev(5000, 'fail'), ev(9000, 'attempt'),     // recoveries 5 and 4
    ev(10000, 'text_shown', { id: 't1', chars: 150 }),
    ev(10500, 'text_shown', { id: 't2', chars: 300 }),
    ev(12500, 'text_closed', { id: 't2' }),                       // 2 s for 300 chars: skimmed
    ev(20000, 'text_closed', { id: 't1' }),                       // 10 s for 150 chars: read
    ev(21000, 'help'),
    ev(22000, 'explore'), ev(23000, 'explore'),
    ev(30000, 'new_thing'), ev(32000, 'attempt'),                 // hesitation 2
    ev(40000, 'new_thing'), ev(44000, 'explore'),                 // hesitation 4
    ev(50000, 'first_touch', { target: 'main-btn' }), ev(60000, 'first_touch', { target: 'menu' }),
  ];
}

describe('sessionFingerprint', () => {
  it('computes every field on a session with known answers', async () => {
    const root = await tempRoot();
    const turns = ['kid', 'kid', 'kid', 'kid', 'adult'].map((who, i) => ({ startMs: i * 1000, endMs: i * 1000 + 500, speaker: '0:A', text: 'x', who: who as 'kid' | 'adult' }));
    const dir = await writeSession(root, 's1', {
      events: known(), durationMs: 120000,
      moments: [
        moment('m1', 4000, 9000, 'frustrated', 0.9), moment('m2', 20000, 22000, 'delighted', 0.8),
        moment('m3', 30000, 31000, 'delighted', 0.7), moment('m4', 40000, 41000, 'none', 0.9), moment('m5', 50000, 51000, 'confused', 0.3),
      ],
      transcript: { turns, kidSpeaker: '0:A' },
    });
    const fp = await sessionFingerprint(dir);
    expect(fp.fail_streak_before_negative).toBe(3);
    expect(fp.recovery_s).toBe(4);
    expect(fp.explore_share).toBeCloseTo(3 / known().length);
    expect(fp.read_share).toBe(0.5);
    expect(fp.read_dwell_per_100).toBeCloseTo((6.6667 + 0.6667) / 2, 3);
    expect(fp.attempts_per_min).toBe(2);
    expect(fp.hesitation_new_s).toBe(3);
    expect(fp.help_per_fail).toBeCloseTo(1 / 3);
    expect(fp.first_touch_main_share).toBe(0.5);
    expect(fp.talk_per_min).toBe(2);
    expect(fp.reaction_mix.frustrated).toBeCloseTo(1 / 3);
    expect(fp.reaction_mix.delighted).toBeCloseTo(2 / 3);
    expect(fp.reaction_mix.none).toBeUndefined();
  });

  it('gives nulls, not NaN, for an events-only session with little in it', async () => {
    const root = await tempRoot();
    const dir = await writeSession(root, 's2', { events: [ev(0, 'attempt'), ev(1000, 'success')], durationMs: 0 });
    const fp = await sessionFingerprint(dir);
    for (const f of NUMERIC_FIELDS) expect(Number.isNaN(fp[f])).toBe(false);
    expect(fp.fail_streak_before_negative).toBeNull();
    expect(fp.recovery_s).toBeNull();
    expect(fp.read_share).toBeNull();
    expect(fp.read_dwell_per_100).toBeNull();
    expect(fp.hesitation_new_s).toBeNull();
    expect(fp.help_per_fail).toBeNull();
    expect(fp.first_touch_main_share).toBeNull();
    expect(fp.talk_per_min).toBeNull();
    expect(fp.explore_share).toBe(0);
    expect(fp.attempts_per_min).toBeGreaterThanOrEqual(0);
    expect(fp.reaction_mix).toEqual({});
  });

  it('uses the weak-label streak when moments.json is missing', async () => {
    const root = await tempRoot();
    const dir = await writeSession(root, 's3', { events: [ev(0, 'fail'), ev(1000, 'fail'), ev(2000, 'fail'), ev(3000, 'fail')], durationMs: 10000 });
    expect((await sessionFingerprint(dir)).fail_streak_before_negative).toBe(3);
  });
});

describe('averageFingerprints', () => {
  it('averages fields ignoring nulls', () => {
    const base = { fail_streak_before_negative: null, recovery_s: 2, explore_share: 0.1, read_share: null, read_dwell_per_100: null, attempts_per_min: 10, hesitation_new_s: null, help_per_fail: null, first_touch_main_share: null, talk_per_min: null, reaction_mix: { stuck: 1 } };
    const m = averageFingerprints([base, { ...base, recovery_s: 4, explore_share: 0.3, reaction_mix: {} }]);
    expect(m.recovery_s).toBe(3);
    expect(m.explore_share).toBeCloseTo(0.2);
    expect(m.fail_streak_before_negative).toBeNull();
    expect(m.reaction_mix).toEqual({ stuck: 1 });
  });
});

describe('playerFingerprint', () => {
  it('averages per player and per game, and finds said-vs-did gaps', async () => {
    const root = await tempRoot();
    // A player who says they explore (-1) but never does, and says they read (-1) but skims everything.
    const skim = [ev(0, 'text_shown', { id: 'a', chars: 300 }), ev(1000, 'text_closed', { id: 'a' }), ev(2000, 'attempt'), ev(3000, 'attempt')];
    const d1 = await writeSession(root, 'a-g1-1', { kid: 'a', game: 'g1', events: skim, durationMs: 60000 });
    const d2 = await writeSession(root, 'a-g2-1', { kid: 'a', game: 'g2', events: skim, durationMs: 60000 });
    await mkdir(join(root, 'kids', 'a'), { recursive: true });
    await writeFile(join(root, 'kids', 'a', 'questionnaire.json'), JSON.stringify({ kid: 'a', answers: {}, scores: { explore: -1, read: -1, challenge: 1, persist: null } }));

    const pf = await playerFingerprint('A', [d1, d2]);
    expect(pf.sessions).toEqual(['a-g1-1', 'a-g2-1']);
    expect(Object.keys(pf.perGame).sort()).toEqual(['g1', 'g2']);
    expect(pf.mean.read_share).toBe(0);
    expect(pf.said.explore).toBe(-1);
    expect(pf.said.persist).toBeNull();
    expect(pf.did.read).toBe(1);
    expect(pf.did.challenge).toBeNull();
    expect(pf.did.look).toBeNull();
    const axes = pf.gaps.map(g => g.axis);
    expect(axes).toContain('read');
    expect(axes).toContain('explore');
    expect(axes).not.toContain('challenge');
    expect(pf.gaps.find(g => g.axis === 'read')!.note).toContain('says they');
  });

  it('works without a questionnaire', async () => {
    const root = await tempRoot();
    const d = await writeSession(root, 'b-g1-1', { kid: 'b', events: [ev(0, 'attempt')], durationMs: 60000 });
    const pf = await playerFingerprint('B', [d]);
    expect(Object.values(pf.said).every(v => v === null)).toBe(true);
    expect(pf.gaps).toEqual([]);
  });

  it('recognises the main targets the four games actually log', async () => {
    const { MAIN_TARGETS } = await import('../../src/predict/fingerprint.ts');
    const isMain = (t: string) => MAIN_TARGETS.some(r => r.test(t));
    for (const t of ['playfield', 'board', 'Control.Board', 'seal:storm', 'chip:sum', 'play', 'main-action']) expect(isMain(t)).toBe(true);
    for (const t of ['compendium', 'menu_high_scores', 'stir', 'buy:pad', 'settings']) expect(isMain(t)).toBe(false);
  });
});
