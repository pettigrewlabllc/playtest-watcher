import { describe, it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { venvAvailable } from '../../src/predict/model.ts';
import { buildGroupModel } from '../../src/predict/traits.ts';
import { fitReaction } from '../../src/predict/reaction.ts';
import { predictSession, writePredictions, MODEL_VARIANTS } from '../../src/predict/predict.ts';
import { scorePrediction } from '../../src/predict/score.ts';
import { ev, failStream, moment, recordingClient, tempRoot, writeSession } from './helpers.ts';

// learn sessions where an attempt precedes every outcome, so the AFM has successes and fails to pair
function learn(seed: number) {
  const { events, moments } = failStream(seed);
  return { events: [ev(0, 'progress', {}, 'run_start'), ...events.flatMap(e => (e.kind === 'success' ? [ev(e.ms - 1, 'attempt'), e] : [e]))], moments };
}

describe.skipIf(!venvAvailable())('simulated-playthrough predictors (needs analysis/.venv)', () => {
  it('writes model-traits and model-kid predictions in the Prediction shape, never reading the target moments', async () => {
    const root = await tempRoot();
    for (const [i, kid] of ['A', 'B'].entries()) for (const [j, g] of ['g1', 'g2'].entries()) {
      const { events, moments } = learn(i * 2 + j);
      await writeSession(root, `${kid.toLowerCase()}-${g}-learn`, { kid, game: g, events, moments });
    }
    const tEvents = [ev(0, 'progress', { level: 1 })];
    let ms = 500;
    for (let k = 0; k < 12; k++) { tEvents.push(ev(ms, 'attempt', {}, 'slice')); tEvents.push(ev(ms + 100, 'fail', {}, 'miss')); ms += 1000; }
    const target = await writeSession(root, 'ref-g3', { kid: 'ref', game: 'g3', round: 'reference', events: tEvents,
      moments: [{ ...moment('x', 0, 99999, 'delighted', 0.99), game_context: 'SENTINEL' }] });
    await writeFile(join(root, 'kids.json'), '{}');
    await buildGroupModel({ root, boot: 10 });
    await fitReaction({ root });

    const preds = await predictSession('A', target, recordingClient(), MODEL_VARIANTS, { root, sims: 20 });
    for (const v of MODEL_VARIANTS) {
      expect(preds[v]!.predictor).toBe(v);
      expect(preds[v]!.target).toBe('ref-g3');
      for (const it of preds[v]!.items) expect(it.label).not.toBe('none');
    }
    const files = await writePredictions(join(root, 'predictions', 'x'), preds);
    expect(files.map(f => f.split('/').pop()).sort()).toEqual(['model-kid.json', 'model-traits.json']);
    const score = await scorePrediction(preds['model-traits']!, target);
    expect(score.real).toBe(1);
    const sim = await readFile(join(root, 'players', 'A', 'sim-ref-g3', 'simulation.json'), 'utf8');
    expect(sim).not.toContain('SENTINEL');
  }, 120_000);
});
