import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnyPredictor } from './predict.ts';

// study.json lives in recordings/ (git-ignored): it maps kids to sessions. Only scoring, freezing and forgetting read it.
export type Study = {
  players: Record<string, { learn: string[]; check: string; replay?: string }>;
  frozen: Record<string, Partial<Record<AnyPredictor, string>>>;
  checks?: Record<string, { letter: string; game: string; void?: string }>;   // void: frozen but never scored, and why
};

export const emptyStudy = (): Study => ({ players: {}, frozen: {}, checks: {} });

export async function loadStudy(root: string): Promise<Study> {
  try { return { ...emptyStudy(), ...JSON.parse(await readFile(join(root, 'study.json'), 'utf8')) }; } catch { return emptyStudy(); }
}
export async function saveStudy(root: string, study: Study): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'study.json'), JSON.stringify(study, null, 2));
}

export async function sha256File(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export type SessionInfo = { id: string; dir: string; kid: string; game: string; round: string };

export async function listSessions(root: string): Promise<SessionInfo[]> {
  let names: string[];
  try { names = await readdir(root); } catch { return []; }
  const out: SessionInfo[] = [];
  for (const id of names.sort()) {
    try {
      const meta = JSON.parse(await readFile(join(root, id, 'session.json'), 'utf8'));
      await readFile(join(root, id, 'aligned.json'));
      out.push({ id, dir: join(root, id), kid: String(meta.kid ?? ''), game: String(meta.game ?? ''), round: String(meta.round ?? '') });
    } catch { /* not a session folder */ }
  }
  return out;
}

export const sameKid = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function playerSessions(root: string, letter: string, round?: string): Promise<SessionInfo[]> {
  return (await listSessions(root)).filter(s => sameKid(s.kid, letter) && (!round || s.round === round));
}
