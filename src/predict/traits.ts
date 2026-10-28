// The group model: everyone's learn-session rows, the AFM (skill, learning rate) and the trait estimators. All Python.
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { python, recordingsRoot } from './model.ts';
import type { Opts } from './model.ts';
import { sessionRows, writeRowsCsv } from './rows.ts';
import type { Row } from './rows.ts';
import { listSessions } from './study.ts';

export type Trait = { value: number | null; lo: number | null; hi: number | null; n: number; games: string[]; adjusted: boolean; source: string; [extra: string]: unknown };
export type TraitEntry = Trait & { per_game: Record<string, Trait> };
export type KidTraits = {
  letter: string; age: number | null; sessions: string[]; games: string[];
  traits: Record<string, TraitEntry>;
  said: Record<string, number | null> & { fun?: Record<string, number> };
  gaps: { axis: string; trait: string; said: number; did: number; lo: number; hi: number; note: string }[];
  intents: { session: string; type: string; intent: string }[];
};
export type TraitsFile = { k: number; level: number; traits: Record<string, { n_unit: string; needs_moments: boolean; source: string }>; kids: Record<string, KidTraits> };

// Shared across kids, so it lives beside players/, not in one player's folder.
export const groupDir = (o: Opts = {}) => join(recordingsRoot(o), 'group');

export async function learnSessionDirs(root: string, exceptGame?: string): Promise<string[]> {
  return (await listSessions(root)).filter(s => s.round === 'learn' && s.game !== exceptGame).map(s => s.dir);
}

export async function writeAllRows(dirs: string[], file: string): Promise<Row[]> {
  const rows = (await Promise.all(dirs.map(sessionRows))).flat();
  await writeRowsCsv(rows, file);
  return rows;
}

export async function buildGroupModel(o: Opts & { boot?: number; exceptGame?: string; out?: string } = {}): Promise<{ dir: string; traits: TraitsFile; afm: unknown }> {
  const root = recordingsRoot(o);
  const dir = o.out ?? groupDir(o);
  await mkdir(dir, { recursive: true });
  const dirs = await learnSessionDirs(root, o.exceptGame);
  if (!dirs.length) throw new Error(`no learn sessions in ${root}`);
  const rowsCsv = join(dir, 'all_rows.csv');
  await writeAllRows(dirs, rowsCsv);
  const boot = ['--boot', String(o.boot ?? 200)];
  const afmFile = join(dir, 'afm.json');
  let afm: unknown = null;
  try {
    await python('afm.py', ['--rows', rowsCsv, '--out', afmFile, ...boot]);
    afm = JSON.parse(await readFile(afmFile, 'utf8'));
  } catch (e) {
    if (!/need resolved attempts/.test((e as Error).message)) throw e;
  }
  const traitsFile = join(dir, 'traits.json');
  await python('traits.py', ['--sessions', ...dirs, '--kids', join(root, 'kids.json'), ...(afm ? ['--afm', afmFile] : []), '--out', traitsFile, ...boot]);
  return { dir, afm, traits: JSON.parse(await readFile(traitsFile, 'utf8')) };
}

export async function loadTraits(o: Opts = {}): Promise<TraitsFile | null> {
  try { return JSON.parse(await readFile(join(groupDir(o), 'traits.json'), 'utf8')); } catch { return null; }
}

export function kidTraits(t: TraitsFile | null, letter: string): KidTraits | null {
  return t?.kids[letter.toUpperCase()] ?? null;
}
