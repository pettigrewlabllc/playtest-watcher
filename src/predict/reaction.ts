// The pooled reaction model (two variants, two baselines, leave-one-game-out). Python: analysis/reaction.py.
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
