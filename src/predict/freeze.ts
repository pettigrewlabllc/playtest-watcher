import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { MetaClient } from '../meta/client.ts';
import { MODEL_VARIANTS, PREDICTORS, predictSession, writePredictions } from './predict.ts';
import type { AnyPredictor } from './predict.ts';
import { existsSync } from 'node:fs';
import { groupDir } from './traits.ts';
import { recordingsRoot } from './model.ts';
import type { Opts } from './model.ts';
import { loadStudy, saveStudy, sha256File } from './study.ts';
import { loadSession } from './inputs.ts';

const run = promisify(execFile);
const REPO = resolve(import.meta.dirname, '..', '..');
export const FROZEN_DOC = join(REPO, 'docs', 'frozen-predictions.md');

export const PREREG_HEADING = '## Pre-registered analysis';
export const PREREG = [
  PREREG_HEADING, '',
  'Written before any check session is scored (freeze adds it if it is missing, and refuses once a check score exists). It does not change after that.', '',
  '- **Primary metric:** stage-level Cohen\'s kappa on the check session, between each predictor\'s top label per stage and the most common real label per stage (`none` where a stage has none), at a matched budget: every predictor, `null` included, gives at most 2 reactions per stage. One number per predictor per check round; `null` is the floor.',
  '- **Presentation:** per check session, paired hit/miss counts per predictor over the same real moments (a hit is a predicted reaction that matches the moment), with the split against `null`: both hit, only this predictor, only `null`, neither.',
  '- **Read beside reliability:** the scoreboard prints the label reliability line first. Below kappa 0.6 between the hand labels and Muse\'s, no prediction score is taken as meaningful.',
  '- Everything else (recall, precision, mix, AUC, leave-one-game-out, traits transfer) is secondary.', '',
].join('\n');

const TABLE = ['| Check | Predictor | SHA-256 | Frozen at |', '| --- | --- | --- | --- |', ''].join('\n');
const DOC_HEADER = [
  '# Frozen predictions', '',
  'SHA-256 hashes of each predictor\'s output for a check round, committed before that check session is recorded. Hashes only: the predictions themselves stay in `recordings/`.', '',
  PREREG, TABLE,
].join('\n');

// A check score exists once a scoreboard has scored any check session.
async function anyCheckScore(root: string): Promise<boolean> {
  try {
    const sb = JSON.parse(await readFile(join(root, 'scoreboard.json'), 'utf8')) as { players?: Record<string, { predictors?: Record<string, { check?: unknown } | null> }> };
    return Object.values(sb.players ?? {}).some(p => Object.values(p.predictors ?? {}).some(r => r?.check));
  } catch { return false; }
}

// The pre-registration goes in before any check score exists; an older doc without it gets it above its table.
export async function ensurePreregistration(docFile: string, root: string): Promise<void> {
  await mkdir(dirname(docFile), { recursive: true });
  if (!(await exists(docFile))) {
    if (await anyCheckScore(root)) throw new Error('a check session has already been scored; the pre-registration must come before any check score');
    await writeFile(docFile, DOC_HEADER);
    return;
  }
  const doc = await readFile(docFile, 'utf8');
  if (doc.includes(PREREG_HEADING)) return;
  if (await anyCheckScore(root)) throw new Error('a check session has already been scored; the pre-registration must come before any check score');
  const at = doc.indexOf('| Check |');
  await writeFile(docFile, at >= 0 ? doc.slice(0, at) + PREREG + '\n' + doc.slice(at) : `${doc}${doc.endsWith('\n') ? '' : '\n'}\n${PREREG}\n${TABLE}`);
}

// Commits exactly one file. Injectable so tests never touch git.
export async function gitCommitOnly(file: string, message: string): Promise<void> {
  await run('git', ['add', '--', file], { cwd: REPO });
  await run('git', ['commit', '-m', message, '--', file], { cwd: REPO });
}

export type FreezeOpts = Opts & { docFile?: string; commit?: (file: string, message: string) => Promise<void>; now?: () => Date };

async function exists(p: string) { return stat(p).then(() => true, () => false); }

export async function freeze(
  letter: string, targetSessionId: string, label: string, client: MetaClient, o: FreezeOpts = {},
): Promise<{ dir: string; hashes: Partial<Record<AnyPredictor, string>> }> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(label)) throw new Error(`label must be letters, digits, dot, dash or underscore: "${label}"`);
  if (!/^[A-Za-z]$/.test(letter)) throw new Error(`player letter must be a single letter: "${letter}"`);
  const root = recordingsRoot(o);
  const docFile = o.docFile ?? FROZEN_DOC;
  const dir = join(root, 'predictions', label);
  const study = await loadStudy(root);
  if (study.frozen[label] || (await exists(dir))) throw new Error(`"${label}" is already frozen; pick a new label (a frozen check is never redone)`);

  await ensurePreregistration(docFile, root);   // before any prediction is written

  const target = join(root, targetSessionId);
  const game = (await loadSession(target)).meta.game;
  // the player-model variants are frozen with the rest once the group model exists
  const names: AnyPredictor[] = [...PREDICTORS, ...(existsSync(join(groupDir(o), 'reaction', 'models.joblib')) ? MODEL_VARIANTS : [])];
  const preds = await predictSession(letter, target, client, names, o);
  const files = await writePredictions(dir, preds);

  const hashes: Partial<Record<AnyPredictor, string>> = {};
  for (const f of files) hashes[f.split('/').pop()!.replace('.json', '') as AnyPredictor] = await sha256File(f);

  const at = (o.now ?? (() => new Date()))().toISOString();
  if (!(await readFile(docFile, 'utf8')).endsWith('\n')) await appendFile(docFile, '\n');
  await appendFile(docFile, names.map(p => `| ${label} | ${p} | ${hashes[p]} | ${at} |\n`).join(''));

  study.frozen[label] = hashes;
  (study.checks ??= {})[label] = { letter, game };
  await saveStudy(root, study);

  await (o.commit ?? gitCommitOnly)(docFile, `Freeze predictions for ${label}`);
  return { dir, hashes };
}
