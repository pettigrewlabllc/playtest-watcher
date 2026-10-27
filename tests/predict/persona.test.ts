import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildPersona, renderPersonaMd } from '../../src/predict/persona.ts';
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
    expect((text.match(/\[a-g1-learn:m\d+\]/g) ?? []).length).toBe(40);
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
