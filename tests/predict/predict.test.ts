import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { predictSession, PREDICTORS } from '../../src/predict/predict.ts';
import { trainPlayer, venvAvailable } from '../../src/predict/model.ts';
import { buildPersona } from '../../src/predict/persona.ts';
import { ev, failStream, moment, recordingClient, tempRoot, writeSession } from './helpers.ts';

// Stage 1 is calm; stage 2 plants a long fail streak.
function target() {
  const events = [ev(0, 'progress', { level: 1 })];
  let ms = 1000;
  for (let k = 0; k < 6; k++) { events.push(ev(ms, 'attempt', {}, 'slice')); ms += 1000; events.push(ev(ms, 'success', {}, 'slice')); ms += 1000; }
  events.push(ev(ms, 'progress', { level: 2 })); ms += 1000;
  for (let k = 0; k < 8; k++) { events.push(ev(ms, 'attempt', {}, 'slice')); ms += 500; events.push(ev(ms, 'fail', {}, 'miss')); ms += 500; }
  events.push(ev(ms, 'success', {}, 'slice'));
  return events;
}

async function world() {
  const root = await tempRoot();
  const trainDirs = [];
  for (const [i, g] of ['g1', 'g2', 'g3'].entries()) {
    const { events, moments } = failStream(i);
    trainDirs.push(await writeSession(root, `a-${g}-learn`, { game: g, events, moments }));
  }
  await mkdir(join(root, 'kids', 'A'), { recursive: true });
  await writeFile(join(root, 'kids', 'A', 'questionnaire.json'), JSON.stringify({ kid: 'A', answers: { 1: 'a', 6: 'b' }, scores: {} }));
  return { root, trainDirs };
}

describe('predictSession (prompted predictors)', () => {
  it('runs baseline, questionnaire and persona with their own inputs and cleans the output', async () => {
    const { root, trainDirs } = await world();
    const client = recordingClient();
    await buildPersona('A', trainDirs, client, { root });
    const tdir = await writeSession(root, 'ref-g4', { kid: 'ref', game: 'g4', round: 'reference', events: target() });
    client.calls.length = 0;
    const canned = recordingClient({ prediction: { items: [
      { stage: '2', event_type: 'miss', label: 'frustrated', p: 0.9, why: 'streak' },
      { stage: '2', event_type: 'miss', label: 'stuck', p: 0.5, why: 'x' },
      { stage: '2', event_type: 'miss', label: 'bored', p: 0.2, why: 'x' },
      { stage: '9', event_type: 'miss', label: 'frustrated', p: 0.9, why: 'no such stage' },
      { stage: '1', event_type: 'slice', label: 'none', p: 0.9, why: 'none is not a reaction' },
    ] } });
    const res = await predictSession('A', tdir, canned, ['baseline', 'questionnaire', 'persona'], { root });
    expect(Object.keys(res)).toEqual(['baseline', 'questionnaire', 'persona']);
    const [b, q, p] = canned.calls;
    expect(b.text).toMatch(/aged 8 to 14/);
    expect(b.text).not.toContain('You start a new game');
    expect(q.text).toContain('You start a new game. What do you do first?');
    expect(q.text).toContain('Poke around');
    expect(p.text).toContain('fake: a steady player');
    expect(b.text).toContain('stage 2');
    for (const name of ['baseline', 'questionnaire', 'persona'] as const) {
      const items = res[name].items;
      expect(res[name]).toMatchObject({ predictor: name, target: 'ref-g4' });
      expect(items.map(i => i.label)).toEqual(['frustrated', 'stuck']);   // max 2 per stage, best p first; bad stage and none dropped
      expect(items.every(i => i.stage === '2')).toBe(true);
    }
    expect(PREDICTORS).toEqual(['null', 'baseline', 'questionnaire', 'persona', 'model']);
  });

  it('tells the prompted predictors the kid\'s age from kids.json, and nothing else from it', async () => {
    const { root } = await world();
    await writeFile(join(root, 'kids.json'), JSON.stringify({ A: { name: 'Zebedee', learn: ['g1'], check: 'g4', age: 11 } }));
    const tdir = await writeSession(root, 'ref-g4', { kid: 'ref', game: 'g4', round: 'reference', events: target() });
    const client = recordingClient();
    await predictSession('A', tdir, client, ['baseline', 'questionnaire'], { root });
    const [b, q] = client.calls;
    expect(b.text).toContain('WHO THEY ARE: a child aged 11. Nothing else is known.');
    expect(q.text).toContain('a child aged 11.');
    for (const c of client.calls) { expect(c.text).not.toContain('Zebedee'); expect(c.text).not.toContain('8 to 14'); }
  });

  it('null predicts every label at every stage under the same 2-per-stage cap, without a model call', async () => {
    const { root } = await world();
    const tdir = await writeSession(root, 'ref-g4', { kid: 'ref', game: 'g4', round: 'reference', events: target() });
    const client = recordingClient();
    const res = await predictSession('A', tdir, client, ['null'], { root });
    expect(client.calls).toHaveLength(0);
    const items = res.null.items;
    expect([...new Set(items.map(i => i.stage))]).toEqual(['1', '2']);
    for (const st of ['1', '2']) expect(items.filter(i => i.stage === st)).toHaveLength(2);
    expect(new Set(items.map(i => i.p))).toEqual(new Set([1 / 7]));   // one over the seven non-none reactions
  });

  it('never reads the player\'s own moments from the target, only another session\'s screen notes', async () => {
    const { root, trainDirs } = await world();
    const mine = { ...moment('s1', 0, 1000, 'stuck', 0.9), game_context: 'SENTINEL_OWN', evidence: { face: 'SENTINEL_OWN', voice: '', hands: '', screen: 'SENTINEL_OWN' } };
    const theirs = { ...moment('s2', 0, 1000, 'stuck', 0.9), evidence: { face: 'FACE_OTHER', voice: '', hands: '', screen: 'SCREEN_OTHER' } };
    const own = await writeSession(root, 'a-g5-check', { kid: 'A', game: 'g5', round: 'check', events: target(), moments: [mine] });
    const other = await writeSession(root, 'b-g5-learn', { kid: 'B', game: 'g5', events: target(), moments: [theirs] });
    const client = recordingClient();
    await buildPersona('A', trainDirs, client, { root });
    client.calls.length = 0;
    await predictSession('A', own, client, ['baseline', 'questionnaire', 'persona'], { root });
    expect(client.calls.map(c => c.text).join('\n')).not.toContain('SENTINEL_OWN');
    client.calls.length = 0;
    await predictSession('A', other, client, ['baseline'], { root });
    expect(client.calls[0].text).toContain('SCREEN_OTHER');
    expect(client.calls[0].text).not.toContain('FACE_OTHER');
    expect(client.calls[0].text).not.toMatch(/\bstuck\b.*0\.9/);
  });
});

describe.skipIf(!venvAvailable())('model predictor (needs analysis/.venv)', () => {
  it('ranks frustrated first at the stage with the planted fail streak, on the 2-per-stage budget', async () => {
    const { root, trainDirs } = await world();
    await trainPlayer('A', trainDirs, { root });
    const tdir = await writeSession(root, 'ref-g4', { kid: 'ref', game: 'g4', round: 'reference', events: target() });
    const res = await predictSession('A', tdir, recordingClient(), ['model'], { root });
    const items = res.model.items;
    const at = (st: string) => items.filter(i => i.stage === st);
    expect(at('2')[0].label).toBe('frustrated');
    for (const st of ['1', '2']) expect(at(st).length).toBeLessThanOrEqual(2);
    expect(at('2')[0].p).toBeGreaterThan(Math.max(0, ...at('1').filter(i => i.label === 'frustrated').map(i => i.p)));
  }, 120_000);
});
