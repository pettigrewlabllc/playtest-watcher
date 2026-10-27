// Input shapes written by Plans 1 and 2; the watch types are re-exported from src/watch.
import { readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import type { Aligned } from '../watch/align.ts';
import type { Moment } from '../watch/explain.ts';
import type { Transcript } from '../watch/transcribe.ts';

export { LABELS } from '../watch/explain.ts';
export type { Label, Moment } from '../watch/explain.ts';
export type { Aligned, AlignedEvent } from '../watch/align.ts';
export type { Transcript } from '../watch/transcribe.ts';

export type SessionMeta = { id?: string; kid: string; game: string; round: 'learn' | 'replay' | 'check' | 'reference' | string };
export type Questionnaire = { kid: string; answers: Record<string, string>; scores: Record<string, number | null> };

export type Session = {
  id: string; dir: string; meta: SessionMeta; aligned: Aligned;
  moments: Moment[] | null; transcript: Transcript | null;
};

async function readJson<T>(file: string): Promise<T | null> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; } catch { return null; }
}

// moments.json may be absent (events-only session); aligned.json is required.
export async function loadSession(dir: string): Promise<Session> {
  const aligned = await readJson<Aligned>(join(dir, 'aligned.json'));
  if (!aligned) throw new Error(`no aligned.json in ${dir}`);
  const meta = (await readJson<SessionMeta>(join(dir, 'session.json'))) ?? { kid: '?', game: 'unknown', round: 'learn' };
  const moments = await readJson<Moment[]>(join(dir, 'moments.json'));
  const transcript = await readJson<Transcript>(join(dir, 'transcript.json'));
  return { id: basename(dir), dir, meta, aligned, moments: Array.isArray(moments) ? moments : null, transcript };
}

// Session folders sit in <root>/<id>/, kid answers in <root>/kids/<letter>/.
export async function loadQuestionnaireAt(root: string, letter: string): Promise<Questionnaire | null> {
  const kids = join(root, 'kids');
  return (await readJson<Questionnaire>(join(kids, letter, 'questionnaire.json')))
    ?? (await readJson<Questionnaire>(join(kids, letter.toLowerCase(), 'questionnaire.json')));
}

export function loadQuestionnaire(sessionDir: string, letter: string): Promise<Questionnaire | null> {
  return loadQuestionnaireAt(dirname(sessionDir), letter);
}
