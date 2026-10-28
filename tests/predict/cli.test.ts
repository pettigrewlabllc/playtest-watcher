import { describe, it, expect } from 'vitest';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { freeze } from '../../src/predict/freeze.ts';
import { forgetPlayer } from '../../src/predict/forget.ts';
import { PREDICTORS } from '../../src/predict/predict.ts';
import { trainPlayer, venvAvailable } from '../../src/predict/model.ts';
import { buildPersona } from '../../src/predict/persona.ts';
import { loadStudy, saveStudy, sha256File } from '../../src/predict/study.ts';
import { ev, failStream, recordingClient, tempRoot, writeSession } from './helpers.ts';

const exists = (p: string) => stat(p).then(() => true, () => false);

describe.skipIf(!venvAvailable())('freeze (needs analysis/.venv)', () => {
  async function world() {
    const root = await tempRoot();
    const dirs: string[] = [];
    for (const [i, g] of ['g1', 'g2', 'g3'].entries()) {
      const { events, moments } = failStream(i);
      dirs.push(await writeSession(root, `c-${g}-learn`, { kid: 'C', game: g, events, moments }));
    }
    await writeSession(root, 'ref-g4', { kid: 'ref', game: 'g4', round: 'reference', events: [ev(0, 'progress', { level: 1 }), ev(500, 'attempt'), ev(900, 'fail')] });
    const client = recordingClient();
    await trainPlayer('C', dirs, { root });
    await buildPersona('C', dirs, client, { root, log: () => {} });
    return { root, client, docFile: join(root, 'frozen.md') };
  }

  it('writes all four predictions, their hashes to the doc and study, and commits only the doc', async () => {
    const { root, client, docFile } = await world();
    const commits: { file: string; message: string }[] = [];
    const res = await freeze('C', 'ref-g4', 'check-1', client, { root, docFile, commit: async (file, message) => { commits.push({ file, message }); }, now: () => new Date('2026-11-01T10:00:00Z') });

    expect(res.hashes).toHaveProperty('model');
    const study = await loadStudy(root);
    expect(Object.keys(study.frozen['check-1']).sort()).toEqual([...PREDICTORS].sort());
    expect(study.checks?.['check-1']).toEqual({ letter: 'C', game: 'g4' });
    for (const p of PREDICTORS) {
      const file = join(root, 'predictions', 'check-1', `${p}.json`);
      const hash = await sha256File(file);   // file content unchanged since it was hashed
      expect(study.frozen['check-1'][p]).toBe(hash);
      expect(await readFile(docFile, 'utf8')).toContain(hash);
    }
    const doc = await readFile(docFile, 'utf8');
    expect(doc).toContain('check-1');
    expect(doc).toContain('Pre-registered analysis');
    expect(doc).toContain('2026-11-01');
    expect(doc).not.toMatch(/\bC\b/);
    expect(doc).not.toMatch(/ref-g4|kids/);
    expect(commits).toEqual([{ file: docFile, message: 'Freeze predictions for check-1' }]);
  }, 120_000);

  it('will not freeze the same label twice, and rejects unsafe labels', async () => {
    const { root, client, docFile } = await world();
    const opts = { root, docFile, commit: async () => {} };
    await freeze('C', 'ref-g4', 'check-1', client, opts);
    await expect(freeze('C', 'ref-g4', 'check-1', client, opts)).rejects.toThrow(/already frozen/);
    await expect(freeze('C', 'ref-g4', '../x', client, opts)).rejects.toThrow(/label/);
  }, 120_000);
});

describe('forget', () => {
  async function world() {
    const root = await tempRoot();
    for (const k of ['A', 'B']) {
      await mkdir(join(root, 'kids', k), { recursive: true });
      await writeFile(join(root, 'kids', k, 'questionnaire.json'), '{}');
      await mkdir(join(root, 'players', k, 'model'), { recursive: true });
      await writeFile(join(root, 'players', k, 'persona.json'), '{}');
    }
    await writeSession(root, 'a-g1-learn', { kid: 'a', events: [ev(0, 'attempt')] });
    await writeSession(root, 'a-g4-check', { kid: 'A', game: 'g4', round: 'check', events: [ev(0, 'attempt')] });
    await writeSession(root, 'b-g1-learn', { kid: 'B', events: [ev(0, 'attempt')] });
    await writeSession(root, 'ref-g1', { kid: 'ref', round: 'reference', events: [ev(0, 'attempt')] });
    await mkdir(join(root, 'predictions', 'A-g4'), { recursive: true });
    await writeFile(join(root, 'predictions', 'A-g4', 'persona.json'), '{}');
    await mkdir(join(root, 'predictions', 'B-g4'), { recursive: true });
    await mkdir(join(root, 'predictions', 'ref-g1__A'), { recursive: true });
    await mkdir(join(root, 'group'), { recursive: true });
    await writeFile(join(root, 'group', 'traits.json'), '{}');
    await saveStudy(root, {
      players: { A: { learn: ['g1'], check: 'g4' }, B: { learn: ['g1'], check: 'g4' } },
      frozen: { 'A-g4': { persona: 'x' }, 'B-g4': { persona: 'y' } },
      checks: { 'A-g4': { letter: 'A', game: 'g4' }, 'B-g4': { letter: 'B', game: 'g4' } },
    });
    return root;
  }

  it('removes everything for one kid and nothing for anyone else', async () => {
    const root = await world();
    const removed = await forgetPlayer(root, 'A', ['A', 'A']);
    expect(removed.length).toBeGreaterThanOrEqual(5);
    expect(await exists(join(root, 'kids', 'A'))).toBe(false);
    expect(await exists(join(root, 'players', 'A'))).toBe(false);
    expect(await exists(join(root, 'a-g1-learn'))).toBe(false);
    expect(await exists(join(root, 'a-g4-check'))).toBe(false);
    expect(await exists(join(root, 'predictions', 'A-g4'))).toBe(false);
    expect(await exists(join(root, 'predictions', 'ref-g1__A'))).toBe(false);
    expect(await exists(join(root, 'group'))).toBe(false);   // pooled across kids: rebuilt without them
    expect(await exists(join(root, 'kids', 'B'))).toBe(true);
    expect(await exists(join(root, 'players', 'B', 'persona.json'))).toBe(true);
    expect(await exists(join(root, 'b-g1-learn'))).toBe(true);
    expect(await exists(join(root, 'ref-g1'))).toBe(true);
    expect(await exists(join(root, 'predictions', 'B-g4'))).toBe(true);
    const study = await loadStudy(root);
    expect(Object.keys(study.players)).toEqual(['B']);
    expect(Object.keys(study.frozen)).toEqual(['B-g4']);
  });

  it('deletes nothing unless the letter was typed twice the same, and refuses odd letters', async () => {
    const root = await world();
    await expect(forgetPlayer(root, 'A', ['A', 'B'])).rejects.toThrow(/typed twice/);
    await expect(forgetPlayer(root, 'A', ['B', 'B'])).rejects.toThrow(/typed twice/);
    await expect(forgetPlayer(root, '../x', ['../x', '../x'])).rejects.toThrow(/letter/);
    expect((await readdir(root)).sort()).toEqual(['a-g1-learn', 'a-g4-check', 'b-g1-learn', 'group', 'kids', 'players', 'predictions', 'ref-g1', 'study.json']);
  });
});

import { runCommand } from '../../src/predict/run.ts';

describe.skipIf(!venvAvailable())('runCommand (fake client, temp root)', () => {
  it('runs fingerprint, train, persona, predict, logo and freeze end to end and rejects bad input', async () => {
    const root = await tempRoot();
    for (const [i, g] of ['g1', 'g2', 'g3'].entries()) {
      const { events, moments } = failStream(i);
      await writeSession(root, `c-${g}-learn`, { kid: 'C', game: g, events, moments });
    }
    await writeSession(root, 'ref-g4', { kid: 'ref', game: 'g4', round: 'reference', events: [ev(0, 'progress', { level: 1 }), ev(500, 'attempt'), ev(900, 'fail')] });
    const lines: string[] = [];
    const deps = { root, client: recordingClient(), out: (l: string) => lines.push(l), commit: async () => {}, docFile: join(root, 'frozen.md') };
    for (const argv of [['fingerprint', 'c'], ['train', 'c'], ['persona', 'c'], ['predict', 'c', 'ref-g4'], ['logo', 'c'], ['freeze', 'c', 'ref-g4', 'check-1'], ['traits'], ['reaction'], ['predict', 'c', 'ref-g4']]) await runCommand(argv, deps);
    const text = lines.join('\n');
    expect(text).toMatch(/train C: \d+ rows/);
    expect(text).toMatch(/held out g1/);
    expect(text).toMatch(/frozen check-1/);
    expect(text).toMatch(/traits C: .*recovery/);
    expect(await exists(join(root, 'group', 'traits.json'))).toBe(true);
    expect(text).toMatch(/reaction: 3 leave-one-game-out folds/);
    expect(text).toMatch(/ traits +macro-F1/);
    expect(await exists(join(root, 'group', 'reaction', 'models.joblib'))).toBe(true);
    expect(await exists(join(root, 'predictions', 'ref-g4__C', 'model-traits.json'))).toBe(true);
    expect(await exists(join(root, 'players', 'C', 'fingerprint.json'))).toBe(true);
    expect(await exists(join(root, 'predictions', 'ref-g4__C', 'model.json'))).toBe(true);
    await expect(runCommand(['bogus'], deps)).rejects.toThrow(/unknown command/);
    await expect(runCommand(['train'], deps)).rejects.toThrow(/letter/);
    await expect(runCommand(['scoreboard'], deps)).rejects.toThrow(/no players/);
  }, 240_000);
});
