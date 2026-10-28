// The pooled reaction model (two variants, two baselines, leave-one-game-out). Python: analysis/reaction.py.
import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { python, recordingsRoot } from './model.ts';
import type { Opts } from './model.ts';
import { groupDir, learnSessionDirs, writeAllRows } from './traits.ts';

export type LabelMetrics = { n: number; macro_f1: number | null; kappa: number | null; auc: Record<string, number>; mix_tvd: number | null };
export type ReactionReport = {
  variants: string[]; baselines: string[]; weak_labels: boolean; label_counts: Record<string, number>;
  folds: { held_out_game: string; train_games: string[]; n_train: number; n_test: number; scores: Record<string, LabelMetrics> }[];
  pooled: Record<string, LabelMetrics>;
};

export const reactionDir = (o: Opts = {}) => join(groupDir(o), 'reaction');

export async function fitReaction(o: Opts = {}): Promise<ReactionReport> {
  const root = recordingsRoot(o);
  const dirs = await learnSessionDirs(root);
  if (!dirs.length) throw new Error(`no learn sessions in ${root}`);
  const out = reactionDir(o);
  await mkdir(out, { recursive: true });
  const rows = join(groupDir(o), 'all_rows.csv');
  await writeAllRows(dirs, rows);
  await python('reaction.py', ['--rows', rows, '--sessions', ...dirs, '--kids', join(root, 'kids.json'), '--out', out]);
  return JSON.parse(await readFile(join(out, 'reaction.json'), 'utf8'));
}

// A group model for one leave-one-game-out fold: every kid's learn sessions except that game, AFM (no bootstrap)
// and the two reaction variants fitted on everything else. Cached by game and training-session ids.
export async function foldGroupModel(root: string, exceptGame: string): Promise<string | null> {
  const dirs = await learnSessionDirs(root, exceptGame);
  if (!dirs.length) return null;
  const key = `${exceptGame}-${createHash('sha1').update(dirs.map(d => basename(d)).sort().join('|')).digest('hex').slice(0, 8)}`;
  const dir = join(groupDir({ root }), 'logo', key);
  if (existsSync(join(dir, 'reaction', 'models.joblib'))) return dir;
  await mkdir(join(dir, 'reaction'), { recursive: true });
  const rows = join(dir, 'all_rows.csv');
  await writeAllRows(dirs, rows);
  try { await python('afm.py', ['--rows', rows, '--out', join(dir, 'afm.json'), '--boot', '0']); }
  catch (e) { if (!/need resolved attempts/.test((e as Error).message)) throw e; }
  await python('reaction.py', ['--rows', rows, '--sessions', ...dirs, '--kids', join(root, 'kids.json'), '--out', join(dir, 'reaction'), '--final-only']);
  return dir;
}
