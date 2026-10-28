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

const DOC_HEADER = [
  '# Frozen predictions', '',
  'SHA-256 hashes of each predictor\'s output for a check round, committed before that check session is recorded. Hashes only: the predictions themselves stay in `recordings/`.', '',
  '| Check | Predictor | SHA-256 | Frozen at |', '| --- | --- | --- | --- |', '',
].join('\n');

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

  const target = join(root, targetSessionId);
  const game = (await loadSession(target)).meta.game;
  // the player-model variants are frozen with the rest once the group model exists
  const names: AnyPredictor[] = [...PREDICTORS, ...(existsSync(join(groupDir(o), 'reaction', 'models.joblib')) ? MODEL_VARIANTS : [])];
  const preds = await predictSession(letter, target, client, names, o);
  const files = await writePredictions(dir, preds);

  const hashes: Partial<Record<AnyPredictor, string>> = {};
  for (const f of files) hashes[f.split('/').pop()!.replace('.json', '') as AnyPredictor] = await sha256File(f);

  const at = (o.now ?? (() => new Date()))().toISOString();
  await mkdir(dirname(docFile), { recursive: true });
  if (!(await exists(docFile))) await writeFile(docFile, DOC_HEADER);
  else if (!(await readFile(docFile, 'utf8')).endsWith('\n')) await appendFile(docFile, '\n');
  await appendFile(docFile, names.map(p => `| ${label} | ${p} | ${hashes[p]} | ${at} |\n`).join(''));

  study.frozen[label] = hashes;
  (study.checks ??= {})[label] = { letter, game };
  await saveStudy(root, study);

  await (o.commit ?? gitCommitOnly)(docFile, `Freeze predictions for ${label}`);
  return { dir, hashes };
}
