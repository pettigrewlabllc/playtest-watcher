import { describe, it, expect } from 'vitest';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scorePrediction, replayCeiling, logo, scoreboard } from '../../src/predict/score.ts';
import { PREDICTORS, writePredictions } from '../../src/predict/predict.ts';
import type { Prediction } from '../../src/predict/predict.ts';
import { saveStudy, sha256File } from '../../src/predict/study.ts';
import { venvAvailable } from '../../src/predict/model.ts';
import { ev, failStream, moment, recordingClient, tempRoot, writeSession } from './helpers.ts';

const events = [
  ev(0, 'progress', { level: 1 }), ev(2000, 'attempt', {}, 'slice'), ev(3000, 'fail', {}, 'miss'),
  ev(10000, 'progress', { level: 2 }), ev(11000, 'fail', {}, 'miss'), ev(12000, 'fail', {}, 'miss'),
  ev(20000, 'progress', { level: 3 }), ev(21000, 'success', {}, 'slice'),
];
const moments = [
  moment('m1', 2500, 3500, 'stuck'), moment('m2', 11000, 12000, 'frustrated'), moment('m3', 20500, 21500, 'delighted'),
  { ...moment('weak', 0, 500, 'bored', 0.3) },
];
const pred = (items: Prediction['items']): Prediction => ({ predictor: 'persona', target: 't', items });
const item = (stage: string, event_type: string, label: string) => ({ stage, event_type, label, p: 0.6, why: '' });

describe('scorePrediction', () => {
  it('gives exact recall, precision and label-mix similarity', async () => {
    const root = await tempRoot();
    const dir = await writeSession(root, 'real', { events, moments });
    const s = await scorePrediction(pred([item('1', 'miss', 'stuck'), item('2', 'miss', 'frustrated'), item('3', 'slice', 'bored')]), dir);
    expect(s).toMatchObject({ real: 3, predicted: 3, hits: 2, matched: 2 });
    expect(s.recall).toBeCloseTo(2 / 3);
    expect(s.precision).toBeCloseTo(2 / 3);
    expect(s.mix_similarity).toBeCloseTo(2 / 3);
    expect(s.mix_distance).toBeCloseTo(1 / 3);
    expect(s.kappa).toBeCloseTo(4 / 7);                 // stage-level: stuck, frustrated, bored vs stuck, frustrated, delighted
    expect(s.auc).toEqual({ stuck: 1, frustrated: 1, delighted: 0.5 });
  });

  it('counts the same label at an adjacent stage only with the same event type', async () => {
    const root = await tempRoot();
    const dir = await writeSession(root, 'real', { events, moments });
    const same = await scorePrediction(pred([item('2', 'slice', 'delighted')]), dir);
    expect(same.hits).toBe(1);
    const otherType = await scorePrediction(pred([item('2', 'miss', 'delighted')]), dir);
    expect(otherType.hits).toBe(0);
    const farStage = await scorePrediction(pred([item('1', 'slice', 'delighted')]), dir);
    expect(farStage.hits).toBe(0);
    const wrongLabel = await scorePrediction(pred([item('3', 'slice', 'frustrated')]), dir);
    expect(wrongLabel.hits).toBe(0);
  });

  it('returns null rates instead of NaN when there is nothing to divide', async () => {
    const root = await tempRoot();
    const dir = await writeSession(root, 'real', { events, moments: [] });
    const s = await scorePrediction(pred([]), dir);
    expect(s.recall).toBeNull(); expect(s.precision).toBeNull(); expect(s.mix_similarity).toBeNull();
    expect(s.kappa).toBeNull(); expect(s.auc).toEqual({}); expect(s.mix_distance).toBeNull();
  });
});

describe('replayCeiling', () => {
  it('scores the first play\'s real moments as predictions for the replay', async () => {
    const root = await tempRoot();
    const a = await writeSession(root, 'a', { events, moments });
    const b = await writeSession(root, 'b', { events, moments: [moments[0], moments[1]] });
    const c = await replayCeiling(a, b);
    expect(c.recall).toBe(1);
    expect(c.precision).toBeCloseTo(2 / 3);
  });
});

async function world(root: string) {
  const dirs: string[] = [];
  for (const [i, g] of ['g1', 'g2', 'g3'].entries()) {
    const { events: e, moments: m } = failStream(i);
    dirs.push(await writeSession(root, `a-${g}-learn`, { kid: 'A', game: g, events: e, moments: m }));
    await writeSession(root, `ref-${g}`, { kid: 'ref', game: g, round: 'reference', events: failStream(i + 4).events });
  }
  return dirs;
}

describe.skipIf(!venvAvailable())('logo (needs analysis/.venv)', () => {
  it('rebuilds fingerprint, rows and persona without the held-out game', async () => {
    const root = await tempRoot();
    await world(root);
    const client = recordingClient();
    const rep = await logo('A', client, { root, log: () => {} });
    expect(rep.folds.map(f => f.game)).toEqual(['g1', 'g2', 'g3']);
    for (const p of PREDICTORS) expect(rep.folds[0].scores[p]).toBeDefined();
    expect(rep.folds.map(f => f.target)).toEqual(['ref-g1', 'ref-g2', 'ref-g3']);
    expect(rep.mean.persona?.recall).not.toBeUndefined();

    // fold 2 (g2 held out): calls 7..13 are lens x3, persona synthesis, then three prompted predictors
    const perFold = 7;
    const personaCalls = client.calls.slice(perFold, perFold + 4);
    expect(personaCalls.map(c => c.schema)).toEqual(['lens', 'lens', 'lens', 'persona']);
    for (const c of personaCalls) { expect(c.text).not.toContain('a-g2-learn'); expect(c.text).not.toContain('"g2"'); expect(c.text).toContain('a-g1-learn'); }
    const logoDir = join(root, 'players', 'A', 'logo');
    const fold = (await readdir(logoDir)).find(n => n.startsWith('g2-'))!;
    const csv = await readFile(join(logoDir, fold, 'rows.csv'), 'utf8');
    expect(csv).not.toContain('a-g2-learn');
    expect(csv).toContain('a-g1-learn');
    // the real player dir was never overwritten by a fold
    expect((await readdir(join(root, 'players', 'A'))).includes('model')).toBe(false);
  }, 180_000);

  it('caches folds by key: a second run trains and builds no persona', async () => {
    const root = await tempRoot();
    await world(root);
    await logo('A', recordingClient(), { root, log: () => {} });
    const again = recordingClient();
    await logo('A', again, { root, log: () => {} });
    expect(again.calls.filter(c => c.schema === 'lens' || c.schema === 'persona')).toHaveLength(0);
  }, 180_000);
});

describe('scoreboard', () => {
  async function frozenWorld() {
    const root = await tempRoot();
    await world(root);
    const check = await writeSession(root, 'a-g4-check', { kid: 'A', game: 'g4', round: 'check', events, moments });
    const replay = await writeSession(root, 'a-g1-replay', { kid: 'A', game: 'g1', round: 'replay', events: failStream(0).events, moments: failStream(0).moments });
    const preds: Partial<Record<(typeof PREDICTORS)[number], Prediction>> = {};
    for (const p of PREDICTORS) preds[p] = { predictor: p, target: 'ref-g4', items: [item('1', 'miss', 'stuck'), item('2', 'miss', 'frustrated')] };
    const dir = join(root, 'predictions', 'A-g4');
    const files = await writePredictions(dir, preds);
    const frozen = Object.fromEntries(await Promise.all(files.map(async f => [f.split('/').pop()!.replace('.json', ''), await sha256File(f)])));
    const study = { players: { A: { learn: ['g1', 'g2', 'g3'], check: 'g4', replay: 'g1' } }, frozen: { 'A-g4': frozen }, checks: { 'A-g4': { letter: 'A', game: 'g4' } } };
    await saveStudy(root, study);
    return { root, study, dir, check, replay };
  }

  it('refuses to score when a frozen prediction file was changed', async () => {
    const { root, study, dir } = await frozenWorld();
    const f = join(dir, 'persona.json');
    await writeFile(f, (await readFile(f, 'utf8')).replace('0.6', '0.9'));
    await expect(scoreboard(study, { root, client: recordingClient() })).rejects.toThrow(/frozen.*persona/i);
  });

  it('refuses a check round that was never frozen', async () => {
    const { root, study } = await frozenWorld();
    study.frozen = {};
    await expect(scoreboard(study, { root, client: recordingClient() })).rejects.toThrow(/not frozen/i);
  });

  it.skipIf(!venvAvailable())('scores check and LOGO per predictor and normalizes by the replay ceiling', async () => {
    const { root, study } = await frozenWorld();
    const sb = await scoreboard(study, { root, client: recordingClient(), log: () => {} });
    const a = sb.players.A;
    expect(a.ceiling?.recall).not.toBeNull();
    for (const p of PREDICTORS) {
      const row = a.predictors[p];
      expect(row.check?.recall).toBeCloseTo(2 / 3);
      expect(row.check_normalized).toBeCloseTo((2 / 3) / (a.ceiling!.recall as number));
      expect(row.logo).not.toBeNull();
    }
  }, 240_000);
});

describe.skipIf(!venvAvailable())('player-model variants in leave-one-game-out (needs analysis/.venv)', () => {
  it('scores model-traits and model-kid per fold from a group model that never saw the held-out game, and checks the ranking', async () => {
    const root = await tempRoot();
    for (const [k, kid] of ['A', 'B'].entries()) for (const [i, g] of ['g1', 'g2'].entries()) {
      const { events: e, moments: m } = failStream(i + 3 * k);
      const withAttempts = e.flatMap(x => (x.kind === 'success' ? [ev(x.ms - 1, 'attempt'), x] : [x]));
      await writeSession(root, `${kid.toLowerCase()}-${g}-learn`, { kid, game: g, events: withAttempts, moments: m });
    }
    await mkdir(join(root, 'kids', 'a'), { recursive: true });
    await writeFile(join(root, 'kids', 'a', 'ranking.json'), JSON.stringify({ order: ['g2', 'g1'] }));
    const rep = await logo('A', recordingClient(), { root, log: () => {}, sims: 10 });
    for (const f of rep.folds) {
      expect(f.scores['model-traits']).toBeDefined();
      expect(f.scores['model-kid']).toBeDefined();
      expect(typeof f.enjoyment?.['model-traits']).toBe('number');
      const groups = await readdir(join(root, 'group', 'logo'));
      const dir = groups.find(n => n.startsWith(`${f.game}-`))!;
      const csv = await readFile(join(root, 'group', 'logo', dir, 'all_rows.csv'), 'utf8');
      expect(csv).not.toContain(`a-${f.game}-learn`);
      expect(csv).not.toContain(`b-${f.game}-learn`);   // every kid's rows for the held-out game stay out
    }
    expect(rep.mean['model-kid']).toBeDefined();
    // unseen-kid transfer: the traits variant never sees a row of A; A's traits come from A's other game
    expect(rep.transfer?.folds.map(f => f.game)).toEqual(['g1', 'g2']);
    expect(rep.transfer?.mean?.recall).not.toBeUndefined();
    const tdirs = await readdir(join(root, 'group', 'transfer'));
    expect(tdirs).toHaveLength(2);
    for (const d of tdirs) {
      expect(await readFile(join(root, 'group', 'transfer', d, 'all_rows.csv'), 'utf8')).not.toMatch(/a-g\d-learn/);
      const rj = JSON.parse(await readFile(join(root, 'group', 'transfer', d, 'reaction', 'reaction.json'), 'utf8'));
      expect(rj.kids).not.toContain('A');
      expect(Object.keys(rj.trait_values)).toContain('A');
    }
    const { rankingCheck } = await import('../../src/predict/score.ts');
    const r = await rankingCheck('A', rep, root);
    expect(r?.order).toEqual(['g2', 'g1']);
    expect([1, -1, 0]).toContain(r?.tau['model-traits']);
  }, 240_000);
});

describe('scoreboard lines', () => {
  it('prints reliability above every prediction score', async () => {
    const { scoreboardLines } = await import('../../src/predict/run.ts');
    const sb = {
      reliability: { n: 10, kappa: 0.42, agreement: 0.6, below_gate: true, gate: 0.6, per_label: {}, sessions: [] },
      players: { A: { ceiling: null, paired: { baseline: { hits: 2, misses: 2, vs_null: { both: 1, only_this: 1, only_null: 0, neither: 2 } } }, transfer: { recall: 0.3, precision: 0.2, mix_similarity: 0.4, kappa: 0.15, auc: {} }, ranking: { order: ['g1', 'g2'], tau: { 'model-traits': 1, 'model-kid': -1 }, n: 2 }, predictors: {
        baseline: { logo: { recall: 0.5, precision: 0.5, mix_similarity: 0.5, kappa: 0.1, auc: { frustrated: 0.7 } }, check: { recall: 0.5, precision: 0.5, mix_similarity: 0.5, kappa: 0.33, real: 4, predicted: 4, hits: 2, matched: 2 }, logo_normalized: null, check_normalized: null },
        'model-traits': { logo: { recall: 0.4, precision: 0.3, mix_similarity: 0.6, kappa: 0.2, auc: {} }, check: null, logo_normalized: null, check_normalized: null },
      } } },
    };
    const lines = scoreboardLines(sb as never);
    expect(lines[0]).toMatch(/kappa 0\.42/);
    expect(lines[2]).toMatch(/PRIMARY \(pre-registered\): stage-level kappa .*matched budget/);
    expect(lines[3]).toMatch(/A baseline +kappa  0\.33  hit 2 \/ missed 2  vs null: both 1, only this 1, only null 0, neither 2/);
    expect(lines[1]).toMatch(/WARNING.*below 0\.6/);
    expect(lines.findIndex(l => /baseline/.test(l))).toBeGreaterThan(1);
    expect(lines.join('\n')).toMatch(/model-traits .*kappa  0\.20/);
    expect(lines.join('\n')).toMatch(/frustrated 0\.70/);
    expect(lines.join('\n')).toMatch(/traits transfer .*kappa  0\.15/);
    expect(lines.at(-1)).toMatch(/ranking check .*model-traits  1\.00, model-kid -1\.00/);
  });
});

describe.skipIf(!venvAvailable())('persona traits in leave-one-game-out (needs analysis/.venv)', () => {
  it('gives each fold persona traits computed without the held-out game', async () => {
    const root = await tempRoot();
    for (const [i, g] of ['g1', 'g2'].entries()) {
      const { events: e, moments: m } = failStream(i);
      await writeSession(root, `a-${g}-learn`, { kid: 'A', game: g, events: e, moments: m });
    }
    const client = recordingClient();
    await logo('A', client, { root, log: () => {}, sims: 5 });
    const lensCalls = client.calls.filter(c => c.schema === 'lens');
    expect(lensCalls.length).toBe(6);
    // fold 1 holds out g1: its trait lines name g2 only
    expect(lensCalls[0].text).toMatch(/per game: g2 /);
    expect(lensCalls[0].text).not.toMatch(/per game: g1 /);
    expect(lensCalls[3].text).toMatch(/per game: g1 /);
  }, 240_000);
});
