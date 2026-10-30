import { describe, it, expect } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPersona, proseProblems, renderPersonaMd } from '../../src/predict/persona.ts';
import { ev, failStream, moment, recordingClient, tempRoot, writeSession } from './helpers.ts';

async function setup() {
  const root = await tempRoot();
  const { events, moments } = failStream(1, 12);
  const a = await writeSession(root, 'a-g1-learn', { game: 'g1', events, moments: moments.map(m => ({ ...m, game_context: 'the boss level' })) });
  const b = await writeSession(root, 'a-g2-learn', { game: 'g2', events: [ev(0, 'attempt'), ev(500, 'fail')], moments: [moment('x1', 0, 1000, 'confused', 0.7)] });
  return { root, dirs: [a, b], firstId: `a-g1-learn:${moments[0].id}` };
}

const lensWith = (ids: string[]) => ({ observations: [
  { claim: 'good one', evidence: [ids[0], 'explore_share'] },
  { claim: 'made up', evidence: ['nope:m99'] },
  { claim: 'no evidence', evidence: [] },
] });

describe('buildPersona', () => {
  it('makes three lens calls then a synthesis call, in order', async () => {
    const { root, dirs } = await setup();
    const client = recordingClient();
    const p = await buildPersona('A', dirs, client, { root });
    expect(client.calls.map(c => c.schema)).toEqual(['lens', 'lens', 'lens', 'persona']);
    expect(client.calls[0].text).toMatch(/game designer/i);
    expect(client.calls[1].text).toMatch(/learning scientist/i);
    expect(client.calls[2].text).toMatch(/UX researcher/i);
    expect(client.calls[3].text).toContain('observations');
    expect(Object.keys(p.lenses)).toEqual(['game designer', 'learning scientist', 'UX researcher']);
    const json = JSON.parse(await readFile(join(root, 'players', 'A', 'persona.json'), 'utf8'));
    expect(json.letter).toBe('A');
    expect(json.tolerances).toBeDefined();
  });

  it('drops observations whose evidence ids do not exist and counts them', async () => {
    const { root, dirs, firstId } = await setup();
    const logs: string[] = [];
    const client = recordingClient({ lens: () => lensWith([firstId]) });
    const p = await buildPersona('A', dirs, client, { root, log: l => logs.push(l) });
    for (const obs of Object.values(p.lenses)) {
      expect(obs).toHaveLength(1);
      expect(obs[0].claim).toBe('good one');
    }
    expect(p.dropped_observations).toBe(6);
    expect(logs.join('\n')).toMatch(/dropped 6/);
    // the synthesis call only sees surviving observations
    expect(client.calls[3].text).not.toContain('made up');
  });

  it('gives each lens the fingerprint, gaps and at most 40 labelled moments, highest confidence first', async () => {
    const root = await tempRoot();
    const ms = Array.from({ length: 60 }, (_, i) => moment(`m${i}`, i * 1000, i * 1000 + 500, 'stuck', 0.5 + (i % 50) / 100));
    const dir = await writeSession(root, 'a-g1-learn', { game: 'g1', events: [ev(0, 'attempt'), ev(70000, 'fail')], moments: ms });
    const client = recordingClient();
    await buildPersona('A', [dir], client, { root });
    const text = client.calls[0].text;
    expect(text).toContain('explore_share');
    expect((text.match(/\[M\d+\]/g) ?? []).length).toBe(40);
    expect(text).toContain('[M1] game=g1 stuck (confidence 0.99)');
  });

  it('maps short refs like M1 (bracketed or not) back to full moment refs', async () => {
    const { root, dirs } = await setup();
    const client = recordingClient({ lens: () => ({ observations: [{ claim: 'short ref', evidence: ['[M1]', 'm2'] }] }) });
    const p = await buildPersona('A', dirs, client, { root });
    const obs = p.lenses['game designer'];
    expect(obs).toHaveLength(1);
    expect(obs[0].evidence.every(e => /^a-g[12]-learn:/.test(e))).toBe(true);
    expect(p.dropped_observations).toBe(0);
  });

  it('rejects identifier soup and empty tells, retries synthesis once, then throws', async () => {
    const good = { summary: 'Plays fast and retries quickly.', tolerances: { fail_streak: 3, recovery_s: 2, idle_before_bored_s: 15 }, reads: 'skims', explores: 'a little', delights: [], confuses: [], tells: { stuck: 'goes quiet', bored: 'looks away', delighted: 'laughs' }, said_vs_did: [], predictions_guidance: 'Expect quick retries.' };
    const soup = { ...good, predictions_guidance: 'Do not expect the said_V foo_confuses_V pattern', tells: { ...good.tells, stuck: '' } };
    expect(proseProblems(good)).toEqual([]);
    expect(proseProblems(soup).join(' ')).toMatch(/tells.stuck is empty.*predictions_guidance uses internal names \(said_V, foo_confuses_V\)|predictions_guidance uses internal names.*tells.stuck is empty/);
    expect(proseProblems({ ...good, tolerances: { fail_streak: 0.33, recovery_s: 2, idle_before_bored_s: 15 } })).toHaveLength(1);

    const { root, dirs } = await setup();
    let n = 0;
    const client = recordingClient({ persona: () => (n++ === 0 ? soup : good) });
    const p = await buildPersona('A', dirs, client, { root, log: () => {} });
    expect(p.predictions_guidance).toBe('Expect quick retries.');
    expect(client.calls[4].text).toMatch(/rejected: .*said_V/);

    const bad = recordingClient({ persona: soup });
    await expect(buildPersona('A', dirs, bad, { root, log: () => {} })).rejects.toThrow(/prose check twice/);
  });

  it('renders markdown that never says personality', async () => {
    const { root, dirs } = await setup();
    const client = recordingClient({ persona: { summary: 'A fun personality to watch', tolerances: { fail_streak: 4, recovery_s: 2, idle_before_bored_s: 20 }, reads: 'skims', explores: 'a lot', delights: ['combos'], confuses: ['menus'], tells: { stuck: 'goes quiet', bored: 'sighs', delighted: 'laughs' }, said_vs_did: [], predictions_guidance: 'expect quick quits' } });
    const p = await buildPersona('A', dirs, client, { root });
    const md = await readFile(join(root, 'players', 'A', 'persona.md'), 'utf8');
    expect(md).toContain('# Player A');
    expect(md).toContain('combos');
    expect(md).not.toMatch(/personalit/i);
    expect(JSON.stringify(p)).not.toMatch(/personalit/i);
    expect(renderPersonaMd(p)).toBe(md);
  });
});

describe('buildPersona with the player model', () => {
  const t = (value: number | null, lo: number | null, hi: number | null, extra = {}) => ({ value, lo, hi, n: 30, games: ['g1'], adjusted: true, source: 's', ...extra });
  const traits = {
    k: 5, level: 0.9, traits: {},
    kids: { A: {
      letter: 'A', age: 9, sessions: ['a-g1-learn'], games: ['g1'], said: {}, gaps: [{ axis: 'persist', trait: 'persistence', said: 1, did: 0.3, lo: 0.1, hi: 0.5, note: 'said less persist than most; plays with more persistence' }],
      intents: [{ session: 'a-g1-learn', type: 'compendium_open', intent: 'accidental' }],
      traits: {
        recovery: { ...t(-0.6, -0.9, -0.2), per_game: { g1: t(1.2, 1.0, 1.5, { raw: 1.1, group_mean: 1.8 }) } },
        pace: { ...t(0.4, -1.0, 1.9), per_game: { g1: t(20, 18, 23, { raw: 20, group_mean: 19 }) } },
        stamina: { ...t(null, null, null), per_game: {} },
      },
    } },
  };

  it('gives the lenses traits with ranges and the spans rule, the kid\'s own words, mood taps and intent corrections; trait names count as evidence', async () => {
    const root = await tempRoot();
    const { events, moments } = failStream(1, 12);
    const dir = await writeSession(root, 'a-g1-learn', { game: 'g1', events: [ev(0, 'operator_mood', { mood: 'sleepy' }, 'operator_mood'), ...events], moments });
    await mkdir(join(root, 'kids', 'a'), { recursive: true });
    await writeFile(join(root, 'kids', 'a', 'debriefs.json'), JSON.stringify([
      { game: 'g1', session: 'a-g1-learn', answers: [{ q: 'How fun?', a: '4', fun: 4 }, { q: 'The Compendium?', a: 'I hit that accidentally.', intent: 'accidental' }] },
      { game: 'g9', session: 'a-g9-learn', answers: [{ q: 'How fun?', a: 'HELD-OUT GAME WORDS' }] },
    ]));
    const client = recordingClient({ lens: () => ({ observations: [{ claim: 'quick to retry', evidence: ['recovery'] }, { claim: 'bogus', evidence: ['not_a_trait'] }] }) });
    const p = await buildPersona('A', [dir], client, { root, traits: traits as never });
    const text = client.calls[0].text;
    expect(text).toContain('TRAITS');
    expect(text).toMatch(/recovery: -0\.60 \[-0\.90, -0\.20\]/);
    expect(text).toMatch(/g1 1\.20 \[1\.00, 1\.50\]/);
    expect(text).toMatch(/range spans the group mean/);
    expect(text).toMatch(/stamina: no data/);
    expect(text).toContain('"I hit that accidentally."');
    expect(text).toMatch(/SAID/);
    expect(text).not.toContain('HELD-OUT GAME WORDS');
    expect(text).toMatch(/g1: sleepy/);
    expect(text).toMatch(/compendium_open .*accidental/);
    expect(text).toContain('said less persist than most');
    expect(p.lenses['game designer']).toEqual([{ claim: 'quick to retry', evidence: ['recovery'] }]);
    const q = recordingClient({ lens: () => ({ observations: [{ claim: 'real quote', evidence: ["they said: 'I hit that accidentally"] }, { claim: 'fake quote', evidence: ["they said: 'I loved every level of it"] }] }) });
    const p2 = await buildPersona('A', [dir], q, { root, traits: traits as never, log: () => {} });
    expect(p2.lenses['game designer'].map(o => o.claim)).toEqual(['real quote']);
    expect(client.calls[3].text).toContain('TRAITS');
    expect(client.calls[3].text).toMatch(/said/i);
  });

  it('still works with no traits file at all', async () => {
    const { root, dirs } = await setup();
    const client = recordingClient();
    await buildPersona('A', dirs, client, { root, traits: null });
    expect(client.calls[0].text).toMatch(/TRAITS[^\n]*\n\(not computed yet/);
  });
});
