import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sessionRows, writeRowsCsv } from './rows.ts';
import type { Row } from './rows.ts';
import { LABELS } from './inputs.ts';
import type { Label } from './inputs.ts';

const run = promisify(execFile);
const REPO = resolve(import.meta.dirname, '..', '..');
export const PYTHON = join(REPO, 'analysis', '.venv', 'bin', 'python');
export const venvAvailable = () => existsSync(PYTHON);

export type CvReport = {
  folds: { held_out_session: string; macro_f1: number; per_label: Record<string, number> }[];
  mean_macro_f1: number | null; chosen: 'hgb' | 'logreg'; logreg_mean_macro_f1: number | null; hgb_mean_macro_f1: number | null;
};
export type Importance = { feature: string; importance: number };
export type TrainResult = { modelDir: string; cv: CvReport; importances: Importance[]; rows: number; weakLabels: boolean };
export type RowProbs = { i: number; stage: string; p: Record<Label, number> };

// root: the recordings dir. dir: an explicit player output dir (leave-one-game-out folds use one so they never touch the real model).
export type Opts = { root?: string; dir?: string };
export const recordingsRoot = (o: Opts = {}) => o.root ?? join(REPO, 'recordings');
export const playerDir = (letter: string, o: Opts = {}) => o.dir ?? join(recordingsRoot(o), 'players', letter);

export async function python(script: string, args: string[]): Promise<void> {
  if (!venvAvailable()) throw new Error(`python venv missing at ${PYTHON}; run: uv venv analysis/.venv && uv pip install -p analysis/.venv -r analysis/requirements.txt`);
  try {
    await run(PYTHON, [join(REPO, 'analysis', script), ...args], { maxBuffer: 16 << 20 });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`${script} failed: ${(e.stderr || e.message).trim().split('\n').slice(-3).join(' | ')}`);
  }
}

export async function trainPlayer(letter: string, sessionDirs: string[], o: Opts = {}): Promise<TrainResult> {
  const dir = playerDir(letter, o);
  const modelDir = join(dir, 'model');
  await mkdir(modelDir, { recursive: true });
  const rows: Row[] = (await Promise.all(sessionDirs.map(sessionRows))).flat();
  const csv = join(dir, 'rows.csv');
  await writeRowsCsv(rows, csv);
  await python('train.py', ['--rows', csv, '--out', modelDir]);
  return {
    modelDir, rows: rows.length, weakLabels: rows.some(r => r.weak_labels === 1),
    cv: JSON.parse(await readFile(join(modelDir, 'cv.json'), 'utf8')),
    importances: JSON.parse(await readFile(join(modelDir, 'importances.json'), 'utf8')),
  };
}

export async function predictRows(letter: string, rowsCsv: string, o: Opts = {}): Promise<RowProbs[]> {
  const dir = playerDir(letter, o);
  const out = join(dir, `probs-${Date.now()}.csv`);
  await python('predict.py', ['--model', join(dir, 'model'), '--rows', rowsCsv, '--out', out]);
  const [header, ...lines] = (await readFile(out, 'utf8')).trim().split('\n');
  const cols = header.split(',');
  return lines.filter(Boolean).map(line => {
    const cells = line.split(',');
    const p = {} as Record<Label, number>;
    for (const l of LABELS) p[l] = Number(cells[cols.indexOf(`p_${l}`)]);
    return { i: Number(cells[cols.indexOf('i')]), stage: cells[cols.indexOf('stage')], p };
  });
}
